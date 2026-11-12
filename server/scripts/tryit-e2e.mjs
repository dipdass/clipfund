// E2E for the "Try it" tab: a headless phone browser with an injected EIP-1193 test wallet (BUYER_PK, testnet only)
// connects, buys a clip over x402 (EIP-3009 signature), approves + swaps test USDC into a sim stock, and checks balances.
// Usage: CLIPFUND_URL=http://localhost:4021 SHOTS=../handoff node scripts/tryit-e2e.mjs
import { createRequire } from "node:module";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { publicClient } from "../lib/chain.js"; // loads .env
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "/workspace/clipfund/video/node_modules/playwright-core");

const BASE = process.env.CLIPFUND_URL || "http://localhost:4021";
const API = process.env.CLIPFUND_API || (/github\.io/.test(BASE) ? "https://clipfund-szbe.onrender.com" : BASE); // Pages is static; the API lives on Render
const SHOTS = process.env.SHOTS || "../handoff";
const account = privateKeyToAccount(process.env.BUYER_PK);
const wc = createWalletClient({ account, chain: baseSepolia, transport: http(process.env.RPC_URL || "https://sepolia.base.org") });
let chain = "0x1"; // start on the "wrong" network so the switch/add path is exercised
let added = false;
let authorized = false;
const log = [];

async function rpc(method, params = []) {
  log.push(method);
  switch (method) {
    case "eth_requestAccounts": authorized = true; return [account.address];
    case "eth_accounts": return authorized ? [account.address] : []; // like MetaMask: empty until the site is approved
    case "eth_chainId": return chain;
    case "wallet_switchEthereumChain":
      if (!added) return { __err: { code: 4902, message: "Unrecognized chain ID" } };
      chain = params[0].chainId; return null;
    case "wallet_addEthereumChain": added = true; chain = params[0].chainId; return null;
    case "wallet_watchAsset": return true;
    case "eth_signTypedData_v4": {
      const t = JSON.parse(params[1]); const { EIP712Domain, ...types } = t.types;
      return account.signTypedData({ domain: t.domain, types, primaryType: t.primaryType, message: t.message });
    }
    case "eth_sendTransaction": return wc.sendTransaction({ to: params[0].to, data: params[0].data });
    default: return publicClient.request({ method, params });
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 MetaMaskMobile" });
await ctx.exposeFunction("__rpc", async (m, p) => { try { const r = await rpc(m, p); return JSON.stringify(r ?? null); } catch (e) { return JSON.stringify({ __err: { code: -32000, message: e.shortMessage || e.message } }); } });
await ctx.addInitScript(() => {
  window.ethereum = { isMetaMask: true, on() {}, removeListener() {},
    async request({ method, params }) { const r = JSON.parse(await window.__rpc(method, params || [])); if (r && r.__err) { const e = new Error(r.__err.message); e.code = r.__err.code; throw e; } return r; } };
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
const shot = (n) => page.screenshot({ path: `${SHOTS}/tryit-${n}.png`, fullPage: true });
const until = (sel, re, ms = 120000) => page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.innerText || ""), [sel, re], { timeout: ms, polling: 500 })
  .catch(async (e) => { console.log("timeout on", sel, "text:", (await page.innerText(sel).catch(() => "")).replace(/\s+/g, " "), "rpc:", log.slice(-8).join(",")); await shot("fail"); throw e; });
const bal = async () => (await (await fetch(`${API}/api/wallet/${account.address}`)).json());

const before = await bal();
// a plain phone browser with no wallet gets the "Open in MetaMask" deep link
{
  const plain = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });
  const p2 = await plain.newPage();
  await p2.goto(`${BASE}/#tryit`, { waitUntil: "networkidle" }); await p2.waitForTimeout(600);
  await p2.waitForSelector("#w-body a.btn");
  console.log("no-wallet link:", await p2.$eval("#w-body a.btn", (a) => a.href));
  await p2.screenshot({ path: `${SHOTS}/tryit-0-no-wallet.png` });
  await plain.close();
}
await page.goto(`${BASE}/#tryit`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/tryit-1-start.png` });
if (process.env.ONLY_START) { await browser.close(); process.exit(0); }
await page.click("#w-connect");
await until("#w-body", "Test USDC");
await shot("2-connected");
console.log("connected; chain after switch/add:", chain);

if (!process.env.SKIP_CLIP) {
await page.click("#c-buy");
await until("#c-msg", "Paid|cancel|need|not|Unexpected|error", 180000);
const clipMsg = await page.innerText("#c-msg");
const settle = await page.$eval("#c-msg a", (a) => a.href).catch(() => null);
console.log("clip:", clipMsg.replace(/\s+/g, " "), settle);
await shot("3-clip-paid");
}

await page.click('#s-chips button[data-v="1"]');
await page.waitForTimeout(500);
if (await page.$eval("#s-approve", (b) => b.disabled)) console.log("allowance already covers $1, skipping approve");
else { await page.click("#s-approve");
await until("#s-msg", "Approved|cancel|revert|error", 180000); }
const approveTx = await page.$eval("#s-msg a", (a) => a.href).catch(() => null);
console.log("approve:", (await page.innerText("#s-msg")).replace(/\s+/g, " "), approveTx);
await page.waitForFunction(() => !document.getElementById("s-swap").disabled, null, { timeout: 30000 });
await shot("4-approved");
await page.click("#s-swap");
await until("#s-msg", "Done|cancel|revert|error", 180000);
const swapTx = await page.$eval("#s-msg a", (a) => a.href).catch(() => null);
console.log("swap:", (await page.innerText("#s-msg")).replace(/\s+/g, " "), swapTx);
await page.click('[data-add="0"]');
await page.waitForTimeout(800);
await shot("5-swapped");

const after = await bal();
console.log("USDC", before.usdcBalance, "->", after.usdcBalance, "| sCOIN", before.stocks[0].balance, "->", after.stocks[0].balance, "| ETH", before.eth, "->", after.eth);
// let the agent book the payment, then check the Payments tab + reconciliation
await new Promise((r) => setTimeout(r, 12000));
const st = await (await fetch(`${API}/api/state?fresh=1`)).json();
console.log("payments:", st.totals.payments, "recon allOk:", st.reconciliation.allOk, st.reconciliation.checks.filter((c) => !c.ok).map((c) => c.name));
await page.goto(`${BASE}/#payments`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/tryit-6-payments.png` });
console.log("rpc methods used:", [...new Set(log)].join(", "));
await browser.close();
