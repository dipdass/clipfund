// The ClipFund agent's treasury logic. The onchain contract enforces the rules;
// this file only decides WHEN to book a payment and WHAT to buy within those rules.
import { publicClient, wallet, deployments, TREASURY_ABI, ERC20_ABI, USDC, fmt6 } from "./chain.js";
import { decodeEventLog } from "viem";

const D = deployments();
const agent = wallet("AGENT_PK");
let queue = Promise.resolve();
export const activity = [];
const log = (m) => { const line = `[agent ${new Date().toISOString()}] ${m}`; activity.push(line); console.log(line); };

const read = (functionName, args = []) => publicClient.readContract({ address: D.treasury, abi: TREASURY_ABI, functionName, args });
async function write(functionName, args) {
  const hash = await agent.writeContract({ address: D.treasury, abi: TREASURY_ABI, functionName, args });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${functionName} reverted ${hash}`);
  return hash;
}

/** Confirm onchain that the x402 settlement tx really moved `amount` USDC from payer to the treasury. */
export async function verifySettlement(txHash, payer, amount) {
  const rc = await publicClient.getTransactionReceipt({ hash: txHash });
  for (const l of rc.logs) {
    if (l.address.toLowerCase() !== USDC.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: ERC20_ABI, data: l.data, topics: l.topics });
      if (ev.eventName === "Transfer" && ev.args.to.toLowerCase() === D.treasury.toLowerCase()
        && (!payer || ev.args.from.toLowerCase() === payer.toLowerCase()) && ev.args.value === BigInt(amount)) return true;
    } catch {}
  }
  return false;
}

/** Called from the x402 afterSettle hook. Serialised so nonces never collide. */
export function onPaid({ txHash, payer, amount, job }) {
  queue = queue.then(() => handlePaid({ txHash, payer, amount, job })).catch((e) => log(`ERROR ${e.shortMessage || e.message}`));
  return queue;
}

async function handlePaid({ txHash, payer, amount, job }) {
  if (!(await verifySettlement(txHash, payer, amount))) throw new Error(`settlement ${txHash} not found onchain`);
  const h = await write("recordPayment", [txHash, payer, BigInt(amount), job]);
  log(`booked payment ${fmt6(amount)} USDC from ${payer} (settle ${txHash}) -> recordPayment ${h}`);
  await rebalance();
}

/** Spend the stock budget on the most under-weight allowlisted stock, never above its cap. */
export async function rebalance() {
  const MIN_BUY = 100_000n; // 0.10 USDC
  let budget = await read("stockBudget");
  for (let i = 0; i < 4 && budget >= MIN_BUY; i++) {
    const nav = await read("nav");
    const cands = [];
    for (const s of D.stocks) {
      const [allowed, maxW] = await read("stocks", [s.address]);
      if (!allowed) continue;
      const value = await read("stockValue", [s.address]);
      const room = (nav * BigInt(maxW)) / 10000n - value;
      cands.push({ ...s, value, room: room > 0n ? (room * 99n) / 100n : 0n });
    }
    cands.sort((a, b) => (a.value < b.value ? -1 : 1));
    const pick = cands.find((c) => c.room >= MIN_BUY);
    if (!pick) { log(`stock budget ${fmt6(budget)} USDC waiting: every stock at its weight cap`); return; }
    const n = cands.filter((c) => c.room >= MIN_BUY).length;
    let amt = budget / BigInt(n);
    if (amt < MIN_BUY) amt = budget;
    if (amt > pick.room) amt = pick.room;
    const h = await write("buyStock", [pick.address, amt, 0n]);
    log(`bought ${pick.symbol} for ${fmt6(amt)} USDC (stock budget only) -> ${h}`);
    budget = await read("stockBudget");
  }
}

/** Operating costs (e.g. GPU/transcription minutes) are paid from the reserve only. */
export function payOpex(amount, memo) {
  queue = queue.then(async () => {
    const h = await write("payOperatingCost", [D.opexVendor, BigInt(amount), memo]);
    log(`paid operating cost ${fmt6(amount)} USDC "${memo}" from reserve -> ${h}`);
    return h;
  });
  return queue;
}

export const idle = () => queue;
