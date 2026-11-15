// ERC-8021 Builder Code attribution for every onchain tx ClipFund sends.
// Docs: https://docs.base.org/specifications/builder-codes/for-app-developers
//
// Configure with either env var (BUILDER_CODE_SUFFIX wins if both are set):
//   BUILDER_CODE=bc_msc4nf2y
//     Official path: Attribution.toDataSuffix({ codes: ["bc_msc4nf2y"] }) from ox/erc8021.
//   BUILDER_CODE_SUFFIX=0x…
//     Encoded String from Base Dashboard → Settings → Encoded String
//     (starts 0x62635f…, ends with the 8021-repeating marker). This value is public, not a secret.
// If neither is set, ClipFund's public Builder Code bc_msc4nf2y is used.
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Attribution } from "ox/erc8021";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

const ERC8021_MARKER = "80218021802180218021802180218021";
export const DEFAULT_BUILDER_CODE = "bc_msc4nf2y";

export function normalizeSuffix(raw) {
  const v = String(raw).trim().toLowerCase();
  if (!v) return undefined;
  if (/^bc_/i.test(v) || !v.startsWith("0x")) {
    throw new Error("BUILDER_CODE_SUFFIX must be the 0x-prefixed Encoded String from Base Dashboard → Settings → Encoded String (not the short bc_… code; put that in BUILDER_CODE)");
  }
  if (!/^0x[0-9a-f]+$/.test(v) || (v.length - 2) % 2 !== 0) {
    throw new Error("BUILDER_CODE_SUFFIX must be even-length hex");
  }
  if (!v.endsWith(ERC8021_MARKER)) {
    throw new Error("BUILDER_CODE_SUFFIX must end with the ERC-8021 marker (8021 repeating)");
  }
  if ((v.length - 2) / 2 < 18) {
    throw new Error("BUILDER_CODE_SUFFIX is too short to be a valid ERC-8021 suffix");
  }
  return v;
}

export function suffixFromBuilderCode(code) {
  const c = String(code || "").trim();
  if (!c) return undefined;
  if (/^0x[0-9a-f]+$/i.test(c)) {
    throw new Error("BUILDER_CODE looks like an encoded hex suffix; put that in BUILDER_CODE_SUFFIX instead");
  }
  return Attribution.toDataSuffix({ codes: [c] });
}

export function resolveDataSuffix({
  encoded = process.env.BUILDER_CODE_SUFFIX,
  code = process.env.BUILDER_CODE,
} = {}) {
  if (encoded && String(encoded).trim()) return normalizeSuffix(encoded);
  if (code && String(code).trim()) return suffixFromBuilderCode(code);
  return suffixFromBuilderCode(DEFAULT_BUILDER_CODE);
}

export const BUILDER_CODE = (process.env.BUILDER_CODE && String(process.env.BUILDER_CODE).trim()) || DEFAULT_BUILDER_CODE;
export const DATA_SUFFIX = resolveDataSuffix();

/** Append an ERC-8021 suffix to calldata, skipping a second copy if it is already there. */
export function appendDataSuffix(data, suffix = DATA_SUFFIX) {
  if (!suffix) return data && data !== "" ? data : "0x";
  const body = !data || data === "0x" ? "0x" : data;
  const s = suffix.slice(2);
  if (body.toLowerCase().endsWith(s.toLowerCase())) return body;
  return (body === "0x" ? "0x" : body) + s;
}
