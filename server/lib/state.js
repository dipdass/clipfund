// Builds the public dashboard state from onchain events + balances and reconciles them.
import { publicClient, deployments, TREASURY_ABI, EXCHANGE_ABI, ERC20_ABI, USDC, MODE, EXPLORER, ROOT } from "./chain.js";
import { verifySettlement } from "./agent.js";
import { parseEventLogs } from "viem";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Public Base Sepolia RPC caps eth_getLogs at a 200-block range, so we scan in windows
// and cache the raw treasury logs on disk so restarts stay cheap.
const STEP = BigInt(process.env.LOGS_BLOCK_RANGE || 199);
const SEED = path.join(ROOT, "data", `logs-cache.${MODE}.json`);

function cacheDir() {
  if (process.env.CACHE_DIR) {
    fs.mkdirSync(process.env.CACHE_DIR, { recursive: true });
    return process.env.CACHE_DIR;
  }
  // Prefer a writable temp dir on hosted filesystems; fall back to the server root locally.
  const tmp = path.join(os.tmpdir(), "clipfund");
  try { fs.mkdirSync(tmp, { recursive: true }); return tmp; } catch { return ROOT; }
}

const CACHE = path.join(cacheDir(), `logs-cache.${MODE}.json`);
let cache = null;

function loadCache(D) {
  for (const p of [CACHE, SEED]) {
    try {
      const c = JSON.parse(fs.readFileSync(p, "utf8"));
      if (c && c.treasury === D.treasury && Array.isArray(c.logs) && c.next) return c;
    } catch {}
  }
  return { treasury: D.treasury, next: String(D.startBlock), logs: [] };
}

function saveCache() {
  try { fs.writeFileSync(CACHE, JSON.stringify(cache)); } catch (e) { console.log(`log cache write skipped: ${e.message}`); }
}

async function treasuryLogs(D) {
  if (!cache) cache = loadCache(D);
  // Load-balanced public RPC nodes can lag a few blocks, so only blocks older than TAIL are cached;
  // the newest TAIL blocks are re-read on every call and de-duplicated.
  const TAIL = 30n;
  const latest = await publicClient.getBlockNumber();
  const safe = latest > TAIL ? latest - TAIL : 0n;
  const get = async (from, to) => (await publicClient.getLogs({ address: D.treasury, fromBlock: from, toBlock: to }))
    .map((l) => ({ address: l.address, data: l.data, topics: l.topics, transactionHash: l.transactionHash, blockNumber: String(l.blockNumber), logIndex: l.logIndex }));
  let from = BigInt(cache.next);
  while (from <= safe) {
    const to = from + STEP > safe ? safe : from + STEP;
    cache.logs.push(...(await get(from, to)));
    from = to + 1n; cache.next = String(from);
    saveCache();
  }
  const tail = [];
  for (let f = from; f <= latest; f += STEP + 1n) tail.push(...(await get(f, f + STEP > latest ? latest : f + STEP)));
  const seen = new Set(); const all = [];
  for (const l of [...cache.logs, ...tail]) { const k = l.transactionHash + ":" + l.logIndex; if (!seen.has(k)) { seen.add(k); all.push(l); } }
  all.sort((x, y) => (BigInt(x.blockNumber) === BigInt(y.blockNumber) ? x.logIndex - y.logIndex : (BigInt(x.blockNumber) < BigInt(y.blockNumber) ? -1 : 1)));
  return all.map((l) => ({ ...l, blockNumber: BigInt(l.blockNumber) }));
}

const sum = (xs, f) => xs.reduce((a, x) => a + BigInt(f(x)), 0n);
const s = (v) => v.toString();

export async function buildState(activity = []) {
  const D = deployments();
  const parsed = parseEventLogs({ abi: TREASURY_ABI, logs: await treasuryLogs(D) });
  const ev = async (eventName) => parsed.filter((l) => l.eventName === eventName)
    .map((l) => ({ ...l.args, tx: l.transactionHash, block: Number(l.blockNumber) }));
  const read = (functionName, args = []) => publicClient.readContract({ address: D.treasury, abi: TREASURY_ABI, functionName, args });

  const [payments, allocs, opex, buys, cashW, resW, stockW] = await Promise.all(
    ["PaymentRecorded", "Allocated", "OperatingCostPaid", "StockPurchased", "CashWithdrawn", "ReserveWithdrawn", "StockWithdrawn"].map(ev));
  const [reserveBalance, stockBudget, cashBalance, totalRevenue, totalOpex, totalInvested, reserveTarget, investBps, nav, unaccounted] =
    await Promise.all(["reserveBalance", "stockBudget", "cashBalance", "totalRevenue", "totalOpex", "totalInvested", "reserveTarget", "investBps", "nav", "unaccounted"].map((f) => read(f)));
  const usdcBal = await publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [D.treasury] });

  const holdings = [];
  for (const st of D.stocks) {
    const [allowed, maxWeightBps] = await read("stocks", [st.address]);
    const balance = await publicClient.readContract({ address: st.address, abi: ERC20_ABI, functionName: "balanceOf", args: [D.treasury] });
    const value = await read("stockValue", [st.address]);
    const weightBps = await read("weightBps", [st.address]);
    const price = await publicClient.readContract({ address: D.exchange, abi: EXCHANGE_ABI, functionName: "priceUsdc6", args: [st.address] });
    const mine = buys.filter((b) => b.stock.toLowerCase() === st.address.toLowerCase());
    const out = stockW.filter((w) => w.stock.toLowerCase() === st.address.toLowerCase());
    holdings.push({ ...st, allowed, maxWeightBps: Number(maxWeightBps), balance: s(balance), value: s(value), weightBps: Number(weightBps), price: s(price),
      bought: s(sum(mine, (b) => b.stockOut)), withdrawn: s(sum(out, (w) => w.amount)), costBasis: s(sum(mine, (b) => b.usdcIn)) });
  }

  // Per-payment settlement proof: the payment ref is the x402 settlement tx; check its USDC Transfer to the treasury.
  const payRows = [];
  for (const p of payments) {
    const a = allocs.find((x) => x.paymentRef === p.paymentRef) || {};
    payRows.push({ ref: p.paymentRef, payer: p.payer, amount: s(p.amount), job: p.job, bookedTx: p.tx, block: p.block,
      toReserve: s(a.toReserve ?? 0n), toStocks: s(a.toStocks ?? 0n), toCash: s(a.toCash ?? 0n),
      settlementVerified: await verifySettlement(p.paymentRef, p.payer, p.amount).catch(() => false) });
  }

  const R = {
    paid: sum(payments, (p) => p.amount), toReserve: sum(allocs, (a) => a.toReserve), toStocks: sum(allocs, (a) => a.toStocks), toCash: sum(allocs, (a) => a.toCash),
    opex: sum(opex, (o) => o.amount), bought: sum(buys, (b) => b.usdcIn), cashOut: sum(cashW, (c) => c.amount), resOut: sum(resW, (c) => c.amount),
  };
  const check = (name, lhs, rhs, detail) => ({ name, ok: lhs === rhs, lhs: s(lhs), rhs: s(rhs), detail });
  const checks = [
    check("Every payment fully allocated", R.toReserve + R.toStocks + R.toCash, R.paid, "Σ(reserve+stocks+cash) == Σ payments"),
    check("Payments match contract revenue", R.paid, totalRevenue, "Σ PaymentRecorded == totalRevenue()"),
    check("Reserve reconciles", R.toReserve - R.opex - R.resOut, reserveBalance, "Σ toReserve − Σ opex − owner withdrawals == reserveBalance"),
    check("Stock budget reconciles", R.toStocks - R.bought, stockBudget, "Σ toStocks − Σ stock buys == stockBudget"),
    check("Cash reconciles", R.toCash - R.cashOut, cashBalance, "Σ toCash − Σ owner withdrawals == cashBalance"),
    check("USDC in vault == buckets", usdcBal, reserveBalance + stockBudget + cashBalance + unaccounted, "balanceOf(treasury) == reserve + budget + cash + unbooked"),
    check("Stock buys came only from stock budget", R.bought, totalInvested, "Σ StockPurchased.usdcIn == totalInvested() ≤ Σ toStocks"),
    ...holdings.map((h) => check(`${h.symbol} holdings reconcile`, BigInt(h.bought) - BigInt(h.withdrawn), BigInt(h.balance), "Σ bought − withdrawn == token balance")),
    ...holdings.map((h) => ({ name: `${h.symbol} under weight cap`, ok: h.weightBps <= h.maxWeightBps, lhs: String(h.weightBps), rhs: String(h.maxWeightBps), detail: "weight bps ≤ max weight bps" })),
    { name: "Every payment backed by an onchain x402 settlement", ok: payRows.every((p) => p.settlementVerified), lhs: String(payRows.filter((p) => p.settlementVerified).length), rhs: String(payRows.length), detail: "USDC Transfer(payer → treasury, amount) found in each settlement tx" },
  ];

  return {
    mode: MODE, explorer: EXPLORER, network: D.network, chainId: D.chainId, contracts: { treasury: D.treasury, exchange: D.exchange, usdc: D.usdc, owner: D.owner, agent: D.agent },
    policy: { reserveTarget: s(reserveTarget), investBps: Number(investBps) },
    buckets: { reserveBalance: s(reserveBalance), stockBudget: s(stockBudget), cashBalance: s(cashBalance), unaccounted: s(unaccounted), usdcBalance: s(usdcBal), nav: s(nav) },
    totals: { revenue: s(totalRevenue), opex: s(totalOpex), invested: s(totalInvested), payments: payments.length },
    payments: payRows, opex: opex.map((o) => ({ ...o, amount: s(o.amount) })),
    buys: buys.map((b) => ({ ...b, usdcIn: s(b.usdcIn), stockOut: s(b.stockOut), weightBpsAfter: s(b.weightBpsAfter), symbol: D.stocks.find((x) => x.address.toLowerCase() === b.stock.toLowerCase())?.symbol })),
    holdings, reconciliation: { allOk: checks.every((c) => c.ok), checks }, activity: activity.slice(-30), generatedAt: new Date().toISOString(),
  };
}
