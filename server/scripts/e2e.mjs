// End-to-end demo: 6 paid clip jobs + 1 operating cost, then print the reconciled treasury.
import fs from "node:fs";
import path from "node:path";
import { buyClip } from "./buyer.mjs";
import { ROOT, fmt6, MODE } from "../lib/chain.js";

const BASE = process.env.CLIPFUND_URL || "http://localhost:4021";
const heads = ["BASE STOCKS MAXXING", "AGENT BUYS COIN", "NVDA ON BASE", "x402 PAID CLIP", "TREASURY UPDATE", "BUILD IN PUBLIC"];
const log = [];
const unpaid = await fetch(`${BASE}/clip`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
log.push({ step: "unpaid request", status: unpaid.status, paymentRequired: !!unpaid.headers.get("payment-required") });
console.log(`unpaid POST /clip -> HTTP ${unpaid.status}`);
const JOBS = Number(process.env.E2E_JOBS || 6);
for (let i = 0; i < JOBS; i++) {
  if (i === 4) {
    const r = await fetch(`${BASE}/admin/opex`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: "200000", memo: "transcription + render minutes" }) }).then((r) => r.json());
    console.log(`opex 0.20 USDC from reserve -> ${r.tx}`); log.push({ step: "opex", ...r });
  }
  let r = await buyClip({ start: 5 + i * 10, end: 20 + i * 10, headline: heads[i] });
  if (r.status !== 200) { // public facilitator occasionally rejects; nothing is charged in that case, so retry once with a fresh authorization
    console.log(`paid clip ${i + 1}: HTTP ${r.status} (${JSON.stringify(r.body).slice(0, 160)}), retrying once`);
    log.push({ step: `paid clip ${i + 1} first attempt`, status: r.status, body: r.body });
    r = await buyClip({ start: 5 + i * 10, end: 20 + i * 10, headline: heads[i] });
  }
  console.log(`paid clip ${i + 1}: HTTP ${r.status} settle tx ${r.settle?.transaction} clip ${r.body.clip?.url}`);
  log.push({ step: `paid clip ${i + 1}`, status: r.status, settlement: r.settle, clip: r.body.clip });
}
const st = await fetch(`${BASE}/api/state`).then((r) => r.json());
console.log(`\nrevenue ${fmt6(st.totals.revenue)} | reserve ${fmt6(st.buckets.reserveBalance)} | stock budget ${fmt6(st.buckets.stockBudget)} | cash ${fmt6(st.buckets.cashBalance)} | NAV ${fmt6(st.buckets.nav)}`);
for (const h of st.holdings) console.log(`${h.symbol}: ${(Number(h.balance) / 1e8).toFixed(6)} sh, $${fmt6(h.value)}, weight ${h.weightBps / 100}% (cap ${h.maxWeightBps / 100}%)`);
for (const c of st.reconciliation.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
const outFile = path.join(ROOT, "..", `e2e-run.${MODE}.json`);
fs.writeFileSync(outFile, JSON.stringify({ ranAt: new Date().toISOString(), mode: MODE, steps: log, state: st }, null, 2));
console.log(`\nwrote ${outFile}`);
if (!st.reconciliation.allOk) process.exit(1);
