/* ClipFund "Try it": connect your own wallet on Base Sepolia, buy a clip over x402, swap test USDC into a sim stock token.
   Plain EIP-1193, no libraries. Testnet only: the page refuses to act on any chain other than Base Sepolia (84532). */
(() => {
const API = (window.CLIPFUND_API || "").replace(/\/$/, "");
const api = (p) => API + p;
const media = (url) => (!url || /^https?:/i.test(url) ? url : API + url);
const dappPath = () => { const p = location.pathname.replace(/\/index\.html$/i, "/"); return p.endsWith("/") ? p : p + "/"; };
const CHAIN = 84532, CHAIN_HEX = "0x14a34";
const BASE_SEPOLIA = { chainId: CHAIN_HEX, chainName: "Base Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.base.org"], blockExplorerUrls: ["https://sepolia.basescan.org"] };
const EXPL = "https://sepolia.basescan.org";
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sh = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const txa = (h, label = "View on basescan") => `<a href="${EXPL}/tx/${h}" target="_blank" rel="noopener">${label} ↗</a>`;
const fmt = (v, dec, dp) => (Number(BigInt(v)) / 10 ** dec).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const msg = (id, html, kind = "") => { $(id).innerHTML = html ? `<div class="msg ${kind}">${html}</div>` : ""; };

let P = null, acct = null, W = null, pick = 0, busy = false;

/* ---------- provider discovery (EIP-6963 first, then window.ethereum) ---------- */
const announced = [];
window.addEventListener("eip6963:announceProvider", (e) => announced.push(e.detail));
window.dispatchEvent(new Event("eip6963:requestProvider"));
function provider() {
  const mm = announced.find((d) => /metamask/i.test(d.info?.rdns || d.info?.name || ""));
  return (mm || announced[0])?.provider || window.ethereum || null;
}
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/* ---------- tiny ABI helpers ---------- */
const pad = (h) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const u256 = (v) => pad(BigInt(v).toString(16));
const call = (sel, ...words) => sel + words.join("");
const SEL = { approve: "0x095ea7b3", buy: "0x3f60b633" };

async function rq(method, params) { return P.request(params ? { method, params } : { method }); }
async function chainOk() {
  const id = parseInt(await rq("eth_chainId"), 16);
  if (id === CHAIN) return true;
  try { await rq("wallet_switchEthereumChain", [{ chainId: CHAIN_HEX }]); }
  catch (e) {
    if (e.code === 4902 || /unrecognized|not added|unknown chain/i.test(e.message || "")) await rq("wallet_addEthereumChain", [BASE_SEPOLIA]);
    else throw e;
  }
  return parseInt(await rq("eth_chainId"), 16) === CHAIN;
}
function why(e) {
  if (e?.code === 4001 || /reject|denied|cancel/i.test(e?.message || "")) return "You cancelled it in your wallet. Nothing was sent.";
  return esc(e?.shortMessage || e?.data?.message || e?.message || String(e));
}
async function waitTx(hash) {
  for (let i = 0; i < 90; i++) {
    const r = await rq("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r) { if (r.status !== "0x1") throw new Error("Transaction reverted onchain"); return r; }
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  throw new Error("Still pending after a while; check it on basescan");
}
async function send(to, data) {
  if (!(await chainOk())) throw new Error("Please switch your wallet to Base Sepolia");
  return rq("eth_sendTransaction", [{ from: acct, to, data }]);
}

/* ---------- wallet card ---------- */
function noWallet() {
  const host = location.host;
  $("w-body").innerHTML = `<p class="sub" style="margin:8px 0 12px">No wallet found in this browser. ${isMobile
    ? "On your phone, open this page inside the MetaMask app's browser:" : "Install the MetaMask extension (or open this page on your phone in the MetaMask app):"}</p>
    <a class="btn full" href="https://metamask.app.link/dapp/${host}${dappPath()}#tryit">Open in MetaMask</a>
    ${isMobile ? "" : '<a class="btn sec full mt" href="https://metamask.io/download/" target="_blank" rel="noopener">Get MetaMask</a>'}`;
}
async function connect() {
  P = provider();
  if (!P) return noWallet();
  try {
    const a = await rq("eth_requestAccounts");
    acct = a[0];
    await chainOk().catch(() => {});
    P.on?.("accountsChanged", (x) => { acct = x[0] || null; acct ? refresh() : location.reload(); });
    P.on?.("chainChanged", () => refresh());
    await refresh();
  } catch (e) { $("w-body").insertAdjacentHTML("beforeend", `<div class="msg bad">${why(e)}</div>`); }
}
async function refresh() {
  if (!acct) return;
  let id = CHAIN;
  try { id = parseInt(await rq("eth_chainId"), 16); } catch {}
  $("w-net").innerHTML = id === CHAIN ? '<span class="ok">● Base Sepolia</span>' : '<span class="bad">● wrong network</span>';
  const r = await fetch(api(`/api/wallet/${acct}`), { cache: "no-store" });
  if (!r.ok) return;
  W = await r.json();
  const st = W.stocks;
  $("w-body").innerHTML = `<div class="wl" style="margin-top:8px"><a class="h" href="${EXPL}/address/${acct}" target="_blank" rel="noopener">${sh(acct)}</a>
    ${id === CHAIN ? "" : '<button class="btn sm" id="w-switch">Switch to Base Sepolia</button>'}</div>
   <div class="bals"><div><span class="sub">Test ETH (gas)</span><b>${fmt(W.eth, 18, 4)}</b></div><div><span class="sub">Test USDC</span><b>${fmt(W.usdcBalance, 6, 2)}</b></div>
   ${st.map((s) => `<div><span class="sub">${s.symbol} <span style="opacity:.7">(sim)</span></span><b>${fmt(s.balance, 8, 6)}</b></div>`).join("")}</div>
   <div class="chips">${st.map((s, i) => `<button data-add="${i}">+ Add ${s.symbol} to wallet</button>`).join("")}</div>
   ${BigInt(W.usdcBalance) === 0n ? '<div class="msg">You have no test USDC yet. Grab 10 free from <a href="https://faucet.circle.com" target="_blank" rel="noopener">faucet.circle.com</a> (choose Base Sepolia), then come back to this page.</div>' : ""}`;
  $("w-switch")?.addEventListener("click", () => chainOk().then(refresh).catch((e) => msg("s-msg", why(e), "bad")));
  $("w-body").querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
    const s = st[b.dataset.add];
    rq("wallet_watchAsset", { type: "ERC20", options: { address: s.address, symbol: s.symbol, decimals: 8 } }).catch(() => {});
  });
  $("s-pick").innerHTML = st.map((s, i) => `<button aria-pressed="${i === pick}" data-i="${i}">${s.symbol}</button>`).join("");
  $("s-pick").querySelectorAll("button").forEach((b) => b.onclick = () => { pick = Number(b.dataset.i); refresh(); });
  $("c-buy").disabled = busy;
  quote();
}

/* ---------- swap ---------- */
const amt6 = () => { const v = Number($("s-amt").value); return Number.isFinite(v) && v > 0 ? BigInt(Math.round(v * 1e6)) : 0n; };
function quote() {
  if (!W) return;
  const s = W.stocks[pick], a = amt6(), price = BigInt(s.price);
  const out = a * 100000000n / price;
  const enough = a > 0n && a <= BigInt(W.usdcBalance), gas = BigInt(W.eth) > 0n;
  const approved = a > 0n && BigInt(W.allowance) >= a;
  $("s-quote").innerHTML = a > 0n
    ? `You get about <b>${fmt(out, 8, 6)} ${s.symbol}</b> at the sim price <b>$${fmt(price, 6, 2)}</b> per share.${!enough ? ' <span class="bad">Not enough test USDC.</span>' : ""}${!gas ? ' <span class="bad">You need a little test ETH for gas.</span>' : ""}`
    : "Enter an amount.";
  $("s-approve").disabled = busy || !enough || !gas || approved;
  $("s-approve").textContent = approved ? "1. Approved ✓" : "1. Approve";
  $("s-swap").disabled = busy || !enough || !gas || !approved;
}
async function approve() {
  const a = amt6(); busy = true; quote();
  try {
    msg("s-msg", "Confirm the approval in your wallet. It lets the demo exchange take exactly this much test USDC.");
    const h = await send(W.usdc, call(SEL.approve, pad(W.exchange), u256(a)));
    msg("s-msg", `Approval sent, waiting for the block… ${txa(h)}`);
    await waitTx(h);
    msg("s-msg", `Approved. Now tap Swap. ${txa(h)}`, "ok");
  } catch (e) { msg("s-msg", why(e), "bad"); }
  busy = false; await refresh();
}
async function swap() {
  const s = W.stocks[pick], a = amt6(), out = a * 100000000n / BigInt(s.price), min = out * 99n / 100n;
  busy = true; quote();
  try {
    msg("s-msg", `Confirm the swap in your wallet: ${fmt(a, 6, 2)} test USDC → ~${fmt(out, 8, 6)} ${s.symbol}.`);
    const h = await send(W.exchange, call(SEL.buy, pad(s.address), u256(a), u256(min), pad(acct)));
    msg("s-msg", `Swap sent, waiting for the block… ${txa(h)}`);
    await waitTx(h);
    msg("s-msg", `Done! You swapped ${fmt(a, 6, 2)} test USDC for ${fmt(out, 8, 6)} ${s.symbol}. ${txa(h)}<br><span class="sub">Tap “+ Add ${s.symbol} to wallet” above to see it in MetaMask.</span>`, "ok");
  } catch (e) { msg("s-msg", why(e), "bad"); }
  busy = false; await refresh();
}

/* ---------- buy a clip over x402 ---------- */
const b64json = (h) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(h), (c) => c.charCodeAt(0))));
const tob64 = (o) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))));
function nonce() { const b = new Uint8Array(32); crypto.getRandomValues(b); return "0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); }
async function buyClip() {
  if (!acct) return connect();
  busy = true; $("c-buy").disabled = true; quote();
  const body = JSON.stringify({ start: 12, end: 27, headline: $("c-head").value.trim() || "CLIPFUND DEMO" });
  try {
    if (!(await chainOk())) throw new Error("Please switch your wallet to Base Sepolia");
    const r1 = await fetch(api("/clip"), { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body });
    const hdr = r1.headers.get("payment-required");
    if (r1.status !== 402 || !hdr) throw new Error(`Unexpected server reply (${r1.status})`);
    const pr = b64json(hdr), req = pr.accepts.find((a) => a.scheme === "exact" && a.network === `eip155:${CHAIN}`);
    if (!req) throw new Error("Server did not offer a Base Sepolia payment");
    if (W && BigInt(W.usdcBalance) < BigInt(req.amount)) throw new Error(`You need ${fmt(req.amount, 6, 2)} test USDC. Get some at faucet.circle.com (Base Sepolia).`);
    const auth = { from: acct, to: req.payTo, value: req.amount, validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + req.maxTimeoutSeconds), nonce: nonce() };
    const typed = {
      types: {
        EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
        TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }],
      },
      primaryType: "TransferWithAuthorization",
      domain: { name: req.extra.name, version: req.extra.version, chainId: CHAIN, verifyingContract: req.asset },
      message: auth,
    };
    msg("c-msg", `Sign in your wallet: it authorizes exactly <b>${fmt(req.amount, 6, 2)} test USDC</b> to the ClipFund treasury ${sh(req.payTo)}. No gas.`);
    const signature = await rq("eth_signTypedData_v4", [acct, JSON.stringify(typed)]);
    msg("c-msg", "Signed. Settling the payment onchain and cutting your clip…");
    const payload = { x402Version: pr.x402Version, payload: { authorization: auth, signature }, resource: pr.resource, accepted: req };
    const r2 = await fetch(api("/clip"), { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "PAYMENT-SIGNATURE": tob64(payload) }, body });
    const res = r2.headers.get("payment-response"), out = await r2.json().catch(() => ({}));
    const st = res ? b64json(res) : null;
    if (!r2.ok || !st?.success) throw new Error(out?.error || st?.errorReason || `Payment was not accepted (${r2.status})`);
    const c = out.clip || {};
    msg("c-msg", `Paid ${fmt(req.amount, 6, 2)} test USDC into the treasury. ${txa(st.transaction, "Settlement tx")}
      <br>Clip “${esc(c.headline || "")}” (${c.seconds || 15}s, 9:16) ${c.url ? `· <a href="${media(c.url)}" target="_blank" rel="noopener">watch ↗</a>` : "is booked."}
      <br><span class="sub">The agent books it onchain in a few seconds; it will show up under Payments.</span>`, "ok");
    setTimeout(() => window.cfReload?.(), 6000); setTimeout(() => window.cfReload?.(), 15000);
  } catch (e) { msg("c-msg", why(e), "bad"); }
  busy = false; await refresh(); $("c-buy").disabled = false;
}

/* ---------- wire up ---------- */
$("w-connect").onclick = connect;
$("c-buy").disabled = false;
$("c-buy").onclick = buyClip;
$("s-approve").onclick = approve;
$("s-swap").onclick = swap;
$("s-amt").addEventListener("input", quote);
$("s-chips").querySelectorAll("button").forEach((b) => b.onclick = () => {
  $("s-amt").value = b.dataset.v === "max" ? (W ? Math.floor(Number(W.usdcBalance) / 1e4) / 100 : 1) : b.dataset.v; quote();
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && acct && !busy) refresh(); });
// Reconnect silently if this site is already authorized in the wallet (no popup).
// On a phone browser without any wallet, show the "Open in MetaMask" link straight away.
setTimeout(async () => {
  P = provider(); if (!P) { if (isMobile) noWallet(); return; }
  try { const a = await rq("eth_accounts"); if (a?.[0]) { acct = a[0]; P.on?.("accountsChanged", (x) => { acct = x[0] || null; acct ? refresh() : location.reload(); }); P.on?.("chainChanged", () => refresh()); refresh(); } } catch {}
}, 50);
})();
