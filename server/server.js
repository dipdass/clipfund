// ClipFund agent server: x402-paywalled clipping API whose revenue funds an onchain stock treasury.
import express from "express";
import path from "node:path";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme as ExactEvmServer } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactEvmScheme as ExactEvmFacilitator } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { MODE, NETWORK, ROOT, wallet, deployments, publicClient, ERC20_ABI, EXCHANGE_ABI, USDC, EXPLORER } from "./lib/chain.js";
import { isAddress, getAddress } from "viem";
import { onPaid, payOpex, activity, idle } from "./lib/agent.js";
import { makeClip, CLIPS_DIR } from "./lib/clip.js";
import fs from "node:fs";
import { currentState, refreshState, invalidateState } from "./lib/state.js";

const D = deployments();
const PORT = Number(process.env.PORT || 4021);
const HOST = process.env.HOST || "0.0.0.0";
const PRICE = process.env.CLIP_PRICE || "$0.50";

function localFacilitator() {
  // In local mode we run the standard x402 facilitator logic in-process against the anvil fork
  // (same EIP-3009 transferWithAuthorization on the real Base Sepolia USDC contract code).
  const c = wallet("FACILITATOR_PK");
  const signer = toFacilitatorEvmSigner({
    address: c.account.address,
    getCode: (a) => c.getCode(a),
    readContract: (a) => c.readContract({ ...a, args: a.args || [] }),
    verifyTypedData: (a) => c.verifyTypedData(a),
    writeContract: (a) => c.writeContract({ ...a, args: a.args || [] }),
    sendTransaction: (a) => c.sendTransaction(a),
    waitForTransactionReceipt: (a) => c.waitForTransactionReceipt(a),
  });
  const f = new x402Facilitator().register(NETWORK, new ExactEvmFacilitator(signer, { eip6492AllowedFactories: [] }));
  return { verify: (p, r) => f.verify(p, r), settle: (p, r) => f.settle(p, r), getSupported: async () => f.getSupported() };
}

const facilitator = MODE === "local" && !process.env.FACILITATOR_URL
  ? localFacilitator()
  : new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL || "https://x402.org/facilitator" });

const resourceServer = new x402ResourceServer(facilitator)
  .register(NETWORK, new ExactEvmServer())
  .onAfterSettle(async (ctx) => {
    const { result, requirements } = ctx;
    if (!result?.success) return;
    await onPaid({ txHash: result.transaction, payer: result.payer, amount: requirements.amount, job: "clip" });
    invalidateState();
  })
  .onVerifyFailure(async (ctx) => { const m = `x402 verify failed: ${ctx.error?.message || JSON.stringify(ctx.result || {})}`; activity.push(m); console.log(m); })
  .onSettleFailure(async (ctx) => { const m = `x402 settle failed: ${ctx.error?.message || "unknown"}`; activity.push(m); console.log(m); });

const app = express();
app.use(express.json());
app.use("/clips", express.static(CLIPS_DIR));

// The dashboard HTML ships with the last known report inlined, so a phone paints real numbers
// on the first response instead of waiting for a chain scan.
const INDEX = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
const inline = (st) => JSON.stringify(st).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
app.get(["/", "/index.html"], async (_req, res) => {
  let st = null;
  try { st = await Promise.race([currentState(activity), new Promise((r) => setTimeout(() => r(null), 1500))]); } catch {}
  res.set("Cache-Control", "no-cache").type("html")
    .send(INDEX.replace("/*__STATE__*/null", st ? inline(st) : "null"));
});
app.use(express.static(path.join(ROOT, "public"), { maxAge: "1h" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mode: MODE, network: NETWORK, treasury: D.treasury });
});

app.use(paymentMiddleware({
  "POST /clip": {
    accepts: { scheme: "exact", price: PRICE, network: NETWORK, payTo: D.treasury }, // paid straight into the treasury contract
    description: "ClipFund: cut a 9:16 headline clip from a crypto stream",
    mimeType: "application/json",
  },
}, resourceServer));

app.post("/clip", (req, res) => {
  try {
    const clip = makeClip(req.body || {});
    res.json({ ok: true, service: "ClipFund", clip, treasury: D.treasury, note: "Payment is booked onchain by the treasury rules after settlement." });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get("/api/state", async (_req, res) => {
  // Default: answer at once from the last good report (refreshed in the background every ~20 s).
  // ?fresh=1 waits for the agent queue and a full onchain rebuild (used by the e2e/capture scripts).
  const fresh = "fresh" in _req.query;
  try {
    if (fresh) await idle();
    res.set("Cache-Control", "no-store").json(await currentState(activity, { fresh }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// "Try it" tab: balances + live prices for a visitor's own wallet (read-only, no keys involved).
const ALLOWANCE_ABI = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] }];
app.get("/api/wallet/:addr", async (req, res) => {
  if (!isAddress(req.params.addr)) return res.status(400).json({ error: "bad address" });
  const a = getAddress(req.params.addr);
  const bal = (token) => publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [a] });
  try {
    const [eth, usdc, allowance, stocks] = await Promise.all([
      publicClient.getBalance({ address: a }), bal(USDC),
      publicClient.readContract({ address: USDC, abi: ALLOWANCE_ABI, functionName: "allowance", args: [a, D.exchange] }),
      Promise.all(D.stocks.map(async (st) => {
        const [balance, price] = await Promise.all([bal(st.address),
          publicClient.readContract({ address: D.exchange, abi: EXCHANGE_ABI, functionName: "priceUsdc6", args: [st.address] })]);
        return { symbol: st.symbol, mirrors: st.mirrors, address: st.address, balance: balance.toString(), price: price.toString() };
      })),
    ]);
    res.set("Cache-Control", "no-store").json({ address: a, chainId: D.chainId, explorer: EXPLORER, usdc: USDC, exchange: D.exchange, treasury: D.treasury,
      eth: eth.toString(), usdcBalance: usdc.toString(), allowance: allowance.toString(), stocks });
  } catch (e) { res.status(502).json({ error: e.shortMessage || e.message }); }
});

// Demo-only admin hook (localhost) so the e2e script can show an operating cost paid from the reserve.
app.post("/admin/opex", async (req, res) => {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) return res.status(403).end();
  try { const h = await payOpex(req.body.amount, req.body.memo || "operating cost"); invalidateState(); res.json({ ok: true, tx: h }); }
  catch (e) { res.status(400).json({ ok: false, error: e.shortMessage || e.message }); }
});

if (!process.env.AGENT_PK) {
  console.log("AGENT_PK is not set; the dashboard will still serve onchain state, but the agent cannot book payments or buy stocks.");
}

app.listen(PORT, HOST, () => {
  console.log(`ClipFund agent on http://${HOST}:${PORT} (mode=${MODE}, treasury=${D.treasury}, price=${PRICE})`);
  refreshState(activity).catch(() => {}); // warm the report right after boot
});
