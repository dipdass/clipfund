# ClipFund: the clipping agent that earns its own stock treasury

**Track:** Agentic Stock Finance, 2.1 "Agents that earn their stock treasury"
**Builder:** Dip Das (@Dipdas2001), crypto and trading content creator
**Network:** live on the public Base Sepolia testnet (84532). Treasury: https://sepolia.basescan.org/address/0xf4e808d0159d13f9b6e75674c9247ae3c078d3d5

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

## Live on Base Sepolia testnet

ClipFund is deployed on the public Base Sepolia testnet (chain 84532). Payments go through the public x402 facilitator (`https://x402.org/facilitator`). Eight paid clip jobs have run end to end: $4.00 in test USDC came in, $1.00 sits in the reserve, and a $0.20 operating cost was paid from it. The agent made 12 stock buys worth $1.68, and $1.12 stayed as cash. All 12 reconciliation checks pass. Full run record: `e2e-run.base-sepolia.json`.

| Contract | Address |
|---|---|
| ClipFundTreasury | [0xf4e808d0159d13f9b6e75674c9247ae3c078d3d5](https://sepolia.basescan.org/address/0xf4e808d0159d13f9b6e75674c9247ae3c078d3d5) |
| SimStockExchange (mock venue and price feed) | [0x18a776641516ecb570d6f9656661984254761cc8](https://sepolia.basescan.org/address/0x18a776641516ecb570d6f9656661984254761cc8) |
| sCOIN (simulated test stock) | [0xea190a2661b2d12ba29a552287c5825db5e5a1c5](https://sepolia.basescan.org/token/0xea190a2661b2d12ba29a552287c5825db5e5a1c5) |
| sNVDA (simulated test stock) | [0xf469a6092a8543169bcf7c75cd9a433b86bcbdb8](https://sepolia.basescan.org/token/0xf469a6092a8543169bcf7c75cd9a433b86bcbdb8) |
| Test USDC (Circle) | [0x036CbD53842c5426634e7929541eC2318f3dCF7e](https://sepolia.basescan.org/token/0x036CbD53842c5426634e7929541eC2318f3dCF7e) |

One payment, traced through every step:
- x402 settlement (0.50 USDC, buyer to treasury): [0x734156fb…de2b6d](https://sepolia.basescan.org/tx/0x734156fbe9296c675b7f930b68f22da2c1812646214792663e81bb7205de2b6d)
- `recordPayment`, which splits it by the rules: [0x0a332a75…5e257d9f](https://sepolia.basescan.org/tx/0x0a332a75b0b86e647c5dfd111396f9ba3cee713a7d14b7a6a43ebcc55e257d9f)
- First stock buy (0.15 USDC to sCOIN, from the stock budget only): [0xf9703636…ed4b4754](https://sepolia.basescan.org/tx/0xf9703636fc17584cfe75049cb389163387fd872fd744761f814c3305ed4b4754)
- Operating cost paid from the reserve (0.20 USDC): [0xf74644fe…16903a](https://sepolia.basescan.org/tx/0xf74644fef1437de66ce5f0baa220723cd62fbf78e2c9fe46a307126cb916903a)

The stock tokens are still simulated. sCOIN and sNVDA are test tokens with fixed mock prices, because Coinbase's tokenized stocks are on Base mainnet only. They carry no rights in any company.

## Verified source
All four contracts have verified source code (exact match, solc 0.8.26, 200 optimizer runs), so anyone can read the rules the agent runs under:

| Contract | Blockscout | Sourcify |
|---|---|---|
| ClipFundTreasury | [Blockscout](https://base-sepolia.blockscout.com/address/0xf4e808d0159d13f9b6e75674c9247ae3c078d3d5?tab=contract) | [Sourcify](https://repo.sourcify.dev/84532/0xf4e808d0159d13f9b6e75674c9247ae3c078d3d5) |
| SimStockExchange | [Blockscout](https://base-sepolia.blockscout.com/address/0x18a776641516ecb570d6f9656661984254761cc8?tab=contract) | [Sourcify](https://repo.sourcify.dev/84532/0x18a776641516ecb570d6f9656661984254761cc8) |
| sCOIN (SimStockToken) | [Blockscout](https://base-sepolia.blockscout.com/address/0xea190a2661b2d12ba29a552287c5825db5e5a1c5?tab=contract) | [Sourcify](https://repo.sourcify.dev/84532/0xea190a2661b2d12ba29a552287c5825db5e5a1c5) |
| sNVDA (SimStockToken) | [Blockscout](https://base-sepolia.blockscout.com/address/0xf469a6092a8543169bcf7c75cd9a433b86bcbdb8?tab=contract) | [Sourcify](https://repo.sourcify.dev/84532/0xf469a6092a8543169bcf7c75cd9a433b86bcbdb8) |

## What the judges asked for, and how ClipFund meets it
| Ask | ClipFund |
|---|---|
| A real payment funds a permitted stock purchase | An x402 USDC settlement into the treasury is booked, then `buyStock` on an allowlisted stock spends that payment's stock share, in the same flow. Live example: settlement [0x734156fb…](https://sepolia.basescan.org/tx/0x734156fbe9296c675b7f930b68f22da2c1812646214792663e81bb7205de2b6d), then a stock buy [0xf9703636…](https://sepolia.basescan.org/tx/0xf9703636fc17584cfe75049cb389163387fd872fd744761f814c3305ed4b4754) |
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
- **Real:** the x402 protocol flow (official `@x402/express`, `@x402/fetch`, `@x402/evm` v2.30), EIP-712/EIP-3009 signatures, test USDC on the public Base Sepolia testnet, settled through the public x402 facilitator, the treasury contract and its rules, the ffmpeg clipping, and the onchain reconciliation.
- **Simulated (disclosed):** Coinbase tokenized stocks such as COINc and NVDAc exist on **Base mainnet** only, and none were found on Base Sepolia. So `sCOIN` and `sNVDA` are SIMULATED 8-decimal test tokens, minted by `SimStockExchange` at fixed demo prices of $250 and $160. They give **no rights in any company**, and they are not affiliated with Coinbase, NVIDIA, or any issuer. On mainnet, the `IStockVenue` adapter would swap to a real venue plus a Chainlink price feed, and the allowlist would point to the real token addresses.
- **Testnet only:** everything runs on Base Sepolia with test USDC and throwaway keys, so there's no real money. The demo video was recorded on the live Base Sepolia testnet. `./demo.sh` still runs the local-fork version with an in-process facilitator.
- **Demo source video:** a synthetic test pattern, so no third-party footage is used.

## Why it matters
Every paid job makes the agent's balance sheet a little stronger, publicly and by rule. For a creator, it doubles as build-in-public content: "this week ClipFund cut N clips, kept its reserve full, and now owns X sCOIN."

## Built during the quest period
All code in this repo (contracts, agent server, dashboard, scripts) was written in November 2026.
