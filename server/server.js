// ClipFund agent server: x402-paywalled clipping API whose revenue funds an onchain stock treasury.
import express from "express";
import path from "node:path";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme as ExactEvmServer } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactEvmScheme as ExactEvmFacilitator } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { MODE, NETWORK, ROOT, wallet, deployments } from "./lib/chain.js";
import { onPaid, payOpex, activity, idle } from "./lib/agent.js";
import { makeClip, CLIPS_DIR } from "./lib/clip.js";
import { buildState } from "./lib/state.js";

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
  })
  .onVerifyFailure(async (ctx) => { const m = `x402 verify failed: ${ctx.error?.message || JSON.stringify(ctx.result || {})}`; activity.push(m); console.log(m); })
  .onSettleFailure(async (ctx) => { const m = `x402 settle failed: ${ctx.error?.message || "unknown"}`; activity.push(m); console.log(m); });

const app = express();
app.use(express.json());
app.use("/clips", express.static(CLIPS_DIR));
app.use(express.static(path.join(ROOT, "public")));

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
  try { await idle(); res.json(await buildState(activity)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Demo-only admin hook (localhost) so the e2e script can show an operating cost paid from the reserve.
app.post("/admin/opex", async (req, res) => {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) return res.status(403).end();
  try { const h = await payOpex(req.body.amount, req.body.memo || "operating cost"); res.json({ ok: true, tx: h }); }
  catch (e) { res.status(400).json({ ok: false, error: e.shortMessage || e.message }); }
});

if (!process.env.AGENT_PK) {
  console.log("AGENT_PK is not set; the dashboard will still serve onchain state, but the agent cannot book payments or buy stocks.");
}

app.listen(PORT, HOST, () => console.log(`ClipFund agent on http://${HOST}:${PORT} (mode=${MODE}, treasury=${D.treasury}, price=${PRICE})`));
