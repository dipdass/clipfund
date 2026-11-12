// A paying customer: calls POST /clip, gets HTTP 402, signs an x402 USDC payment (EIP-3009) with a TEST key, retries.
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import "../lib/chain.js"; // loads .env

const BASE = process.env.CLIPFUND_URL || "http://localhost:4021";
export async function buyClip(body) {
  const client = new x402Client();
  client.setSpendControls?.({ maxAmountPerPayment: "$1" });
  client.register("eip155:*", new ExactEvmScheme(privateKeyToAccount(process.env.BUYER_PK)));
  const pay = wrapFetchWithPayment(fetch, client);
  const res = await pay(`${BASE}/clip`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const settle = new x402HTTPClient(client).getPaymentSettleResponse((n) => res.headers.get(n));
  return { status: res.status, body: await res.json(), settle };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const unpaid = await fetch(`${BASE}/clip`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  console.log("without payment ->", unpaid.status);
  const r = await buyClip({ start: 12, end: 27, headline: process.argv[2] || "HOW HE MADE $200K" });
  console.log(JSON.stringify(r, null, 2));
}
