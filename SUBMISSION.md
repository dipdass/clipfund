# ClipFund: the clipping agent that earns its own stock treasury

**Track:** Agentic Stock Finance, 2.1 "Agents that earn their stock treasury"
**Builder:** Dip Das (@Dipdas2001), crypto and trading content creator
**Network:** Base Sepolia testnet (84532)

## Problem
Crypto creators and streamers need short clips fast, and clipping is repetitive work that an agent can do. Most "AI agent" treasuries, though, are a black box. Nobody can see what the agent earned, what it kept for costs, or what it bought. Often the agent can also spend everything, so a bad decision or a leaked key can drain its operating money.

## What ClipFund does
ClipFund sells clipping as an API: `POST /clip` with a start, an end, and a headline returns a 9:16 headline clip. The endpoint is paywalled with **x402**, so any person or agent can pay **$0.50 USDC per clip** with a single signed authorization. No account and no API key are needed. The payment settles **straight into the ClipFund treasury contract**, and from there onchain rules decide where every cent goes.

## The loop
**Useful work → revenue → operating reserve → stock treasury**
1. **Work:** the agent cuts the clip with ffmpeg and returns it.
2. **Revenue:** the x402 settlement (EIP-3009 `transferWithAuthorization`) moves USDC from the buyer to the treasury.
3. **Reserve first:** `recordPayment` tops the operating reserve up to its target (1 USDC in the demo). The reserve pays operating costs (render and transcription minutes) to allowlisted payees only, and **it can never be invested**.
4. **Stock treasury:** of the surplus, the **owner-set share** (60% in the demo) goes to a stock budget, and the rest stays as USDC cash. The agent buys **allowlisted tokenized stocks** (sCOIN, sNVDA) from that budget only. Each stock is capped at **35% of treasury NAV**, and a buy that breaks the cap reverts.
5. **Public proof:** the dashboard rebuilds everything from onchain events and runs 12 reconciliation checks. For example, Σ payments equals Σ allocations, the reserve, budget, and cash each match their events, the USDC in the vault equals the buckets, the holdings equal Σ buys, every weight is under its cap, and **every payment is backed by a verified onchain x402 settlement**.

## What the judges asked for, and how ClipFund meets it
| Ask | ClipFund |
|---|---|
| A real payment funds a permitted stock purchase | An x402 USDC settlement into the treasury is booked, then `buyStock` on an allowlisted stock spends that payment's stock share, in the same flow (see `e2e-run.local.json`) |
| Clear allocation rules | Reserve first, then `investBps` of the surplus to stocks, the rest to cash. All of it is in one contract and emitted as `Allocated(ref, toReserve, toStocks, toCash)` |
| A reserve the agent can't invest | `buyStock` can only draw from `stockBudget`. The reserve moves only through `payOperatingCost` to allowlisted payees, and the agent key cannot change policy |

## Safety rules (enforced in the contract)
- Agent and owner roles are separate. Only the owner (Ownable2Step) sets the reserve target, the invest percentage, the stock allowlist, the max weights, and the opex payees, and only the owner can withdraw.
- No phantom revenue: a payment can't be booked for more USDC than actually arrived, and it can't be booked twice.
- Per-stock max weight is checked after every buy, and venue pull-limits are checked.
- Events cover every step: `PaymentRecorded`, `Allocated`, `OperatingCostPaid`, `StockPurchased`, `PolicySet`, `StockSet`, and the withdrawals.
- Testnet only, with throwaway keys.

## Demo steps (about 2 min video)
1. Run `./demo.sh`. It runs the contract tests (13 pass), forks Base Sepolia, deploys, and starts the agent.
2. Show `POST /clip` without payment returning **HTTP 402 Payment Required**.
3. The buyer pays over x402. Show the returned clip and the settlement tx hash.
4. Open the dashboard. Show payment 1 and 2 filling the 🔒 reserve, then payments 3+ splitting 60/40, the agent buying sCOIN and sNVDA under the 35% caps, and a 0.20 USDC operating cost coming out of the reserve, which the next payment refills first.
5. Scroll to the reconciliation report: **all 12 checks pass**.

## What is real and what is simulated
- **Real:** the x402 protocol flow (official `@x402/express`, `@x402/fetch`, `@x402/evm` v2.30), EIP-712/EIP-3009 signatures, the Base Sepolia test-USDC contract code (on a fork), the treasury contract and its rules, the ffmpeg clipping, and the onchain reconciliation.
- **Simulated (disclosed):** Coinbase tokenized stocks such as COINc and NVDAc exist on **Base mainnet** only, and none were found on Base Sepolia. So `sCOIN` and `sNVDA` are SIMULATED 8-decimal test tokens, minted by `SimStockExchange` at fixed demo prices of $250 and $160. They give **no rights in any company**, and they are not affiliated with Coinbase, NVIDIA, or any issuer. On mainnet, the `IStockVenue` adapter would swap to a real venue plus a Chainlink price feed, and the allowlist would point to the real token addresses.
- **Local fork:** the recorded run is on an anvil fork of Base Sepolia, because the faucets need a human sign-in. The steps to run on public Base Sepolia are in the README.
- **Demo source video:** a synthetic test pattern, so no third-party footage is used.

## Why it matters
Every paid job makes the agent's balance sheet a little stronger, publicly and by rule. For a creator, it doubles as build-in-public content: "this week ClipFund cut N clips, kept its reserve full, and now owns X sCOIN."

## Built during the quest period
All code in this repo (contracts, agent server, dashboard, scripts) was written in November 2026.
