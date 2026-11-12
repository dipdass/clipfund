// Builds the public dashboard state from onchain events + balances and reconciles them.
import { publicClient, deployments, TREASURY_ABI, EXCHANGE_ABI, ERC20_ABI, USDC, MODE, EXPLORER } from "./chain.js";
import { verifySettlement } from "./agent.js";

const sum = (xs, f) => xs.reduce((a, x) => a + BigInt(f(x)), 0n);
const s = (v) => v.toString();

export async function buildState(activity = []) {
  const D = deployments();
  const fromBlock = BigInt(D.startBlock);
  const ev = async (eventName) => (await publicClient.getContractEvents({ address: D.treasury, abi: TREASURY_ABI, eventName, fromBlock }))
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
