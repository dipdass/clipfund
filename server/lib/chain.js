// Shared chain config for ClipFund. TESTNET ONLY: local Base Sepolia fork or Base Sepolia (84532).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createPublicClient, createWalletClient, http, publicActions, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

export const MODE = process.env.CHAIN_MODE || "local"; // "local" | "base-sepolia"
if (!["local", "base-sepolia"].includes(MODE)) throw new Error("CHAIN_MODE must be local or base-sepolia (testnet only)");
export const RPC_URL = process.env.RPC_URL || (MODE === "local" ? "http://127.0.0.1:8545" : "https://sepolia.base.org");
export const NETWORK = "eip155:84532"; // Base Sepolia CAIP-2
export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Circle test USDC on Base Sepolia
export const EXPLORER = MODE === "base-sepolia" ? "https://sepolia.basescan.org" : null;

export const chain = MODE === "local"
  ? defineChain({ ...baseSepolia, name: "Base Sepolia (local anvil fork)", rpcUrls: { default: { http: [RPC_URL] } } })
  : baseSepolia;

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

export function wallet(envKey) {
  const pk = process.env[envKey];
  if (!pk) throw new Error(`${envKey} missing in the environment (local: server/.env; hosted: the service env vars)`);
  const account = privateKeyToAccount(pk);
  return createWalletClient({ account, chain, transport: http(RPC_URL) }).extend(publicActions);
}

export function artifact(file, name) {
  const p = path.join(ROOT, "..", "contracts", "out", file, `${name}.json`);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

function loadAbi(shippedName, artifactFile, artifactName) {
  const shipped = path.join(ROOT, "abi", `${shippedName}.json`);
  if (fs.existsSync(shipped)) return JSON.parse(fs.readFileSync(shipped, "utf8")).abi;
  return artifact(artifactFile, artifactName).abi;
}

export const DEPLOY_FILE = process.env.DEPLOYMENTS_FILE || path.join(ROOT, `deployments.${MODE}.json`);
export function deployments() {
  if (!fs.existsSync(DEPLOY_FILE)) throw new Error(`No ${DEPLOY_FILE}; run npm run setup, or commit deployments.${MODE}.json`);
  return JSON.parse(fs.readFileSync(DEPLOY_FILE, "utf8"));
}

export const TREASURY_ABI = loadAbi("ClipFundTreasury", "ClipFundTreasury.sol", "ClipFundTreasury");
export const EXCHANGE_ABI = loadAbi("SimStockExchange", "SimStock.sol", "SimStockExchange");
export const STOCK_ABI = loadAbi("SimStockToken", "SimStock.sol", "SimStockToken");
export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "event", name: "Transfer", inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false }] },
];
export const fmt6 = (v) => (Number(v) / 1e6).toFixed(6).replace(/0{1,4}$/, "");
