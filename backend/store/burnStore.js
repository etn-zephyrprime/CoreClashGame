import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { withLock } from "../utils/mutex.js";
import { BASE_DATA_DIR } from "../utils/dataDir.js";
import { queueR2Upload } from "../utils/r2Sync.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(BASE_DATA_DIR, "store");
const FILE = path.join(DATA_DIR, "burnTotal.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readBurnTotal() {
  try {
    if (!fs.existsSync(FILE)) return 0n;

    const raw = fs.readFileSync(FILE, "utf8");
    if (!raw) return 0n;

    const data = JSON.parse(raw);
    return BigInt(data?.totalBurnWei || "0");
  } catch (err) {
    console.error("readBurnTotal error:", err);
    return 0n;
  }
}

export function writeBurnTotal(totalWei) {
  try {
    ensureDir();

    const tempFile = FILE + ".tmp";

    fs.writeFileSync(
      tempFile,
      JSON.stringify({ totalBurnWei: totalWei.toString() }, null, 2),
      "utf8"
    );

    fs.renameSync(tempFile, FILE);
    queueR2Upload(FILE);
  } catch (err) {
    console.error("writeBurnTotal error:", err);
    throw err;
  }
}

/**
 * Safely read burn total under lock
 */
export async function readBurnTotalLocked() {
  return withLock(async () => {
    return readBurnTotal();
  });
}

/**
 * Safely overwrite burn total under lock
 */
export async function writeBurnTotalLocked(totalWei) {
  return withLock(async () => {
    writeBurnTotal(totalWei);
    return totalWei;
  });
}

/**
 * Safely add to burn total under lock
 */
export async function addBurnTotal(amountWei) {
  return withLock(async () => {
    const current = readBurnTotal();
    const updated = current + BigInt(amountWei);
    writeBurnTotal(updated);
    return updated;
  });
}