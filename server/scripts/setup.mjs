// Generates throwaway TEST keys (never printed) and deploys ClipFund contracts.
// local: funds keys on the anvil fork (fake ETH + test USDC moved from an existing fork holder).
// base-sepolia: needs DEPLOYER/AGENT/FACILITATOR funded with Base Sepolia ETH and BUYER with test USDC (faucet).
import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseEther } from "viem";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const envPath = path.join(ROOT, ".env");
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "# ClipFund throwaway TESTNET keys. Never use on mainnet. Never commit.\nCHAIN_MODE=local\n";
for (const k of ["DEPLOYER_PK", "AGENT_PK", "FACILITATOR_PK", "BUYER_PK", "VENDOR_PK"]) {
  if (!new RegExp(`^${k}=`, "m").test(env)) env += `${k}=${generatePrivateKey()}\n`;
}
fs.writeFileSync(envPath, env, { mode: 0o600 });
fs.chmodSync(envPath, 0o600);

const { MODE, publicClient, wallet, artifact, USDC, DEPLOY_FILE, ERC20_ABI, TREASURY_ABI, EXCHANGE_ABI, RPC_URL } = await import("../lib/chain.js");
const addr = (k) => privateKeyToAccount(process.env[k]).address;
const A = { deployer: addr("DEPLOYER_PK"), agent: addr("AGENT_PK"), facilitator: addr("FACILITATOR_PK"), buyer: addr("BUYER_PK"), vendor: addr("VENDOR_PK") };
console.log(`mode=${MODE} rpc=${RPC_URL}`);
console.log("addresses (public):", A);

const chainId = await publicClient.getChainId();
if (chainId !== 84532) throw new Error(`Refusing: chainId ${chainId} is not Base Sepolia (84532)`);

const rpc = (method, params) => fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then(r => r.json());

if (MODE === "local") {
  for (const a of [A.deployer, A.agent, A.facilitator, A.buyer]) await rpc("anvil_setBalance", [a, "0x" + parseEther("10").toString(16)]);
  // move 25 test USDC to the buyer from an address that already holds Base Sepolia test USDC on the fork
  const holder = process.env.FORK_USDC_HOLDER || "0x1111111111111111111111111111111111111111";
  await rpc("anvil_impersonateAccount", [holder]);
  await rpc("anvil_setBalance", [holder, "0x" + parseEther("1").toString(16)]);
  const { encodeFunctionData } = await import("viem");
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [A.buyer, 25_000_000n] });
  const r = await rpc("eth_sendTransaction", [{ from: holder, to: USDC, data }]);
  await publicClient.waitForTransactionReceipt({ hash: r.result });
  await rpc("anvil_stopImpersonatingAccount", [holder]);
}

const dep = wallet("DEPLOYER_PK");
async function deploy(file, name, args) {
  const { abi, bytecode } = artifact(file, name);
  const hash = await dep.deployContract({ abi, bytecode, args });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`deployed ${name} ${rc.contractAddress} tx ${hash}`);
  return { address: rc.contractAddress, tx: hash, block: Number(rc.blockNumber) };
}
const send = async (address, abi, functionName, args) => {
  const hash = await dep.writeContract({ address, abi, functionName, args });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
};

const startBlock = Number(await publicClient.getBlockNumber());
const exchange = await deploy("SimStock.sol", "SimStockExchange", [USDC]);
const sCOIN = await deploy("SimStock.sol", "SimStockToken", ["Coinbase Global (SIMULATED test stock)", "sCOIN", exchange.address]);
const sNVDA = await deploy("SimStock.sol", "SimStockToken", ["NVIDIA (SIMULATED test stock)", "sNVDA", exchange.address]);
// Policy: reserve target 1 USDC, 60% of surplus to stocks, each stock capped at 35% of treasury NAV
const POLICY = { reserveTarget: 1_000_000n, investBps: 6000, caps: { sCOIN: 3500, sNVDA: 3500 } };
const treasury = await deploy("ClipFundTreasury.sol", "ClipFundTreasury", [USDC, exchange.address, A.agent, POLICY.reserveTarget, POLICY.investBps]);
// Simulated reference prices (USDC per share). Disclosed simulation; not live quotes.
await send(exchange.address, EXCHANGE_ABI, "setPrice", [sCOIN.address, 250_000_000n]);
await send(exchange.address, EXCHANGE_ABI, "setPrice", [sNVDA.address, 160_000_000n]);
await send(treasury.address, TREASURY_ABI, "setStock", [sCOIN.address, true, POLICY.caps.sCOIN]);
await send(treasury.address, TREASURY_ABI, "setStock", [sNVDA.address, true, POLICY.caps.sNVDA]);
await send(treasury.address, TREASURY_ABI, "setOpexPayee", [A.vendor, true]);

const out = {
  mode: MODE, chainId, network: "eip155:84532", usdc: USDC, startBlock,
  owner: A.deployer, agent: A.agent, facilitator: A.facilitator, buyer: A.buyer, opexVendor: A.vendor,
  exchange: exchange.address, treasury: treasury.address,
  stocks: [{ symbol: "sCOIN", mirrors: "COINc", address: sCOIN.address }, { symbol: "sNVDA", mirrors: "NVDAc", address: sNVDA.address }],
  policy: { reserveTargetUSDC: 1, investBps: POLICY.investBps, maxWeightBps: POLICY.caps },
  deployTxs: { exchange: exchange.tx, sCOIN: sCOIN.tx, sNVDA: sNVDA.tx, treasury: treasury.tx },
};
fs.writeFileSync(DEPLOY_FILE, JSON.stringify(out, null, 2));
console.log(`wrote ${DEPLOY_FILE}`);
