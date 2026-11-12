// Captures REAL output of the running ClipFund demo, step by step, for the video.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";
import { buyClip } from "../server/scripts/buyer.mjs";

const A = "/workspace/clipfund/video/assets";
const BASE = "http://localhost:4021";
const save = (f, s) => fs.writeFileSync(`${A}/${f}`, s);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

async function shots(tag) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.getElementById("payments").innerHTML.length > 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${A}/${tag}-full.png`, fullPage: true });
  const card = (id) => page.locator(`#${id}`).locator("xpath=..");
  await page.locator("header").screenshot({ path: `${A}/${tag}-header.png` });
  await page.locator("#flow").screenshot({ path: `${A}/${tag}-flow.png` });
  await page.locator("#kpis").screenshot({ path: `${A}/${tag}-kpis.png` });
  for (const id of ["payments", "buys", "opex", "recon", "holdings", "policy"]) await card(id).screenshot({ path: `${A}/${tag}-${id}.png` });
}

// 1) unpaid request
const r0 = await fetch(`${BASE}/clip`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ start: 5, end: 20, headline: "BASE STOCKS MAXXING" }) });
const pr = JSON.parse(Buffer.from(r0.headers.get("payment-required"), "base64").toString());
const acc = pr.accepts[0];
save("t-402.txt", [`$ curl -i -X POST localhost:4021/clip -d '{"start":5,"end":20,"headline":"BASE STOCKS MAXXING"}'`,
  `HTTP/1.1 ${r0.status} Payment Required`, `payment-required: (base64, decoded below)`,
  `  x402Version: ${pr.x402Version}`, `  scheme:  ${acc.scheme}`, `  network: ${acc.network}   (Base Sepolia)`,
  `  asset:   ${acc.asset}   (test USDC)`, `  amount:  ${acc.amount}   (= 0.50 USDC)`, `  payTo:   ${acc.payTo}   (ClipFund treasury contract)`,
  `  resource: ${pr.resource?.description || ""}`].join("\n"));

const lines = [];
const logLen = () => fs.readFileSync("/tmp/clipfund-server.log", "utf8").split("\n").length;
let mark = logLen();
const agentLog = () => { const l = fs.readFileSync("/tmp/clipfund-server.log", "utf8").split("\n"); const out = l.slice(mark - 1).filter((x) => x.startsWith("[agent")).map((x) => x.replace(/^\[agent [^\]]+\] /, "agent> ")); mark = l.length; return out; };
const heads = ["BASE STOCKS MAXXING", "AGENT BUYS COIN", "NVDA ON BASE", "x402 PAID CLIP", "TREASURY UPDATE", "BUILD IN PUBLIC"];
async function pay(i) {
  const r = await buyClip({ start: 5 + i * 10, end: 20 + i * 10, headline: heads[i] });
  await new Promise((s) => setTimeout(s, 300));
  await fetch(`${BASE}/api/state?fresh=1`);
  const out = [`$ npm run buy   # paying client #${i + 1}: 402 -> sign EIP-3009 USDC authorization -> retry`,
    `HTTP ${r.status}  clip ${r.body.clip.url}  (${r.body.clip.seconds}s, ${r.body.clip.format})`,
    `x402 settlement: success=${r.settle.success}  tx ${r.settle.transaction}`, `payer ${r.settle.payer}`, ...agentLog()];
  return { r, out };
}
const p1 = await pay(0); const p2 = await pay(1);
save("t-pay12.txt", [...p1.out, "", ...p2.out].join("\n"));
await shots("s1");
const p3 = await pay(2); const p4 = await pay(3);
save("t-pay34.txt", [...p3.out, "", ...p4.out].join("\n"));
await shots("s2");
const ox = await fetch(`${BASE}/admin/opex`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: "200000", memo: "transcription + render minutes" }) }).then((r) => r.json());
await fetch(`${BASE}/api/state?fresh=1`);
const opexLog = agentLog();
const p5 = await pay(4); const p6 = await pay(5);
save("t-opex.txt", [`$ agent pays an operating cost (0.20 USDC) -> payOperatingCost(vendor)`, ...opexLog, "", ...p5.out, "", ...p6.out].join("\n"));
await shots("s3");
// try to break the rules: agent buys more than its stock budget / a non-allowlisted token
const st = await fetch(`${BASE}/api/state?fresh=1`).then((r) => r.json());
save("state-final.json", JSON.stringify(st, null, 2));
save("clip-file.txt", p1.r.body.clip.url);
await browser.close();
console.log("captured", fs.readdirSync(A).length, "files");
