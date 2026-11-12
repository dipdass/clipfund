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
const SCAN_PARALLEL = Number(process.env.LOGS_PARALLEL || 6);
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
  // Fetch windows a few at a time instead of one-by-one: a cold start can be thousands of blocks behind.
  const windows = (start, end) => { const w = []; for (let f = start; f <= end; f += STEP + 1n) w.push([f, f + STEP > end ? end : f + STEP]); return w; };
  const fetchAll = async (ws) => {
    const out = [];
    for (let i = 0; i < ws.length; i += SCAN_PARALLEL) out.push(...(await Promise.all(ws.slice(i, i + SCAN_PARALLEL).map(([a, b]) => get(a, b)))).flat());
    return out;
  };
  let from = BigInt(cache.next);
  if (from <= safe) {
    const ws = windows(from, safe);
    for (let i = 0; i < ws.length; i += SCAN_PARALLEL * 4) {
      const chunk = ws.slice(i, i + SCAN_PARALLEL * 4);
      cache.logs.push(...(await fetchAll(chunk)));
      from = chunk[chunk.length - 1][1] + 1n; cache.next = String(from);
    }
    saveCache();
  }
  const tail = await fetchAll(windows(from, latest));
  const seen = new Set(); const all = [];
  for (const l of [...cache.logs, ...tail]) { const k = l.transactionHash + ":" + l.logIndex; if (!seen.has(k)) { seen.add(k); all.push(l); } }
  all.sort((x, y) => (BigInt(x.blockNumber) === BigInt(y.blockNumber) ? x.logIndex - y.logIndex : (BigInt(x.blockNumber) < BigInt(y.blockNumber) ? -1 : 1)));
  return all.map((l) => ({ ...l, blockNumber: BigInt(l.blockNumber) }));
}

const proven = new Set();
async function provenSettlement(ref, payer, amount) {
  const k = `${ref}:${payer}:${amount}`.toLowerCase();
  if (proven.has(k)) return true;
  const ok = await verifySettlement(ref, payer, amount).catch(() => false);
  if (ok) proven.add(k);
  return ok;
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

  const holdings = await Promise.all(D.stocks.map(async (st) => {
    const [[allowed, maxWeightBps], balance, value, weightBps, price] = await Promise.all([
      read("stocks", [st.address]),
      publicClient.readContract({ address: st.address, abi: ERC20_ABI, functionName: "balanceOf", args: [D.treasury] }),
      read("stockValue", [st.address]),
      read("weightBps", [st.address]),
      publicClient.readContract({ address: D.exchange, abi: EXCHANGE_ABI, functionName: "priceUsdc6", args: [st.address] }),
    ]);
    const mine = buys.filter((b) => b.stock.toLowerCase() === st.address.toLowerCase());
    const out = stockW.filter((w) => w.stock.toLowerCase() === st.address.toLowerCase());
    return { ...st, allowed, maxWeightBps: Number(maxWeightBps), balance: s(balance), value: s(value), weightBps: Number(weightBps), price: s(price),
      bought: s(sum(mine, (b) => b.stockOut)), withdrawn: s(sum(out, (w) => w.amount)), costBasis: s(sum(mine, (b) => b.usdcIn)) };
  }));

  // Per-payment settlement proof: the payment ref is the x402 settlement tx; check its USDC Transfer to the treasury.
  // A settlement tx is immutable once mined, so a positive proof is remembered for the life of the process.
  const payRows = await Promise.all(payments.map(async (p) => {
    const a = allocs.find((x) => x.paymentRef === p.paymentRef) || {};
    return { ref: p.paymentRef, payer: p.payer, amount: s(p.amount), job: p.job, bookedTx: p.tx, block: p.block,
      toReserve: s(a.toReserve ?? 0n), toStocks: s(a.toStocks ?? 0n), toCash: s(a.toCash ?? 0n),
      settlementVerified: await provenSettlement(p.paymentRef, p.payer, p.amount) };
  }));

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

// ---- Served state: answer instantly from the last good report, rebuild in the background. ----
// Order of preference on a request: in-memory report → on-disk report from this instance → the
// snapshot committed in server/data (so even a cold Render boot paints real numbers at once).
const SNAP_SEED = path.join(ROOT, "data", `state-snapshot.${MODE}.json`);
const SNAP = path.join(cacheDir(), `state-snapshot.${MODE}.json`);
const MAX_AGE_MS = Number(process.env.STATE_MAX_AGE_MS || 20_000);
let served = null; let builtAt = 0; let building = null; let dirty = false; let lastError = null;

function loadSnapshot() {
  const D = deployments();
  for (const p of [SNAP, SNAP_SEED]) {
    try { const j = JSON.parse(fs.readFileSync(p, "utf8")); if (j?.contracts?.treasury === D.treasury) return j; } catch {}
  }
  return null;
}

export function refreshState(activity) {
  if (building) return building;
  dirty = false;
  const t0 = Date.now();
  building = buildState(activity)
    .then((st) => {
      served = st; builtAt = Date.now(); lastError = null;
      try { fs.writeFileSync(SNAP, JSON.stringify(st)); } catch {}
      console.log(`state rebuilt in ${Date.now() - t0} ms`);
      return st;
    })
    .catch((e) => { lastError = e.shortMessage || e.message; console.log(`state rebuild failed: ${lastError}`); throw e; })
    .finally(() => { building = null; });
  return building;
}

/** Mark the report stale (after the agent books a payment or pays opex). */
export function invalidateState() { dirty = true; }

const withMeta = (st, extra) => ({ ...st, ...extra, activity: extra.activity ?? st.activity });

/** The report to send right now. `fresh` waits for a rebuild (used by scripts, not by the dashboard). */
export async function currentState(activity, { fresh = false } = {}) {
  if (fresh || dirty) return withMeta(await refreshState(activity), { live: true, ageMs: 0 });
  if (!served) {
    const snap = loadSnapshot();
    const job = refreshState(activity).catch(() => null);
    if (!snap) {
      const st = await job;
      if (!st) throw new Error(lastError || "state unavailable");
      return withMeta(st, { live: true, ageMs: 0 });
    }
    return withMeta(snap, { live: false, snapshot: true, refreshing: true, activity: activity.slice(-30) });
  }
  const age = Date.now() - builtAt;
  if (age > MAX_AGE_MS) refreshState(activity).catch(() => {});
  return withMeta(served, { live: true, ageMs: age, refreshing: Boolean(building), activity: activity.slice(-30) });
}
