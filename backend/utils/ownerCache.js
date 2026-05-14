import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = "/backend/data/cache";
const CACHE_FILE = path.join(CACHE_DIR, "owners.json");
if (!fs.existsSync("/backend/data")) {
  throw new Error("Persistent disk /backend/data is missing");
}
console.log("🔥 ownerCache.js LOADED FROM:", import.meta.url);

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  if (!fs.existsSync(CACHE_FILE)) {
    fs.writeFileSync(CACHE_FILE, "{}", "utf8");
  }
}

/**
 * Read owner cache from disk
 * Returns: { [wallet]: { VKIN: [], VQLE: [] } }
 */
// In readOwnerCache
export function readOwnerCache() {
  if (!fs.existsSync(CACHE_FILE)) {
    console.log("No owner cache found, starting fresh");
    return {};
  }

  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));

    const normalized = {};

    if (raw._meta) {
      normalized._meta = raw._meta;
    }

    for (const wallet in raw) {
      if (wallet === "_meta") continue;

      const lowerWallet = wallet.toLowerCase();
      normalized[lowerWallet] = raw[wallet];
    }

    console.log(
      `Loaded owner cache with ${Object.keys(normalized).filter((k) => k !== "_meta").length} wallets (normalized)`
    );

    return normalized;
  } catch (err) {
    console.error("Failed to read owner cache:", err.message);
    return {};
  }
}

// In writeOwnerCache — normalize key before writing
export function writeOwnerCache(cache) {
  ensureCacheDir();

  try {
    const normalizedCache = {};

    if (cache._meta) {
      normalizedCache._meta = cache._meta;
    }

    for (const wallet in cache) {
      if (wallet === "_meta") continue;

      const lowerWallet = wallet.toLowerCase();
      normalizedCache[lowerWallet] = cache[wallet];
    }

    console.log("💾 Writing cache to:", CACHE_FILE);

    const tempFile = `${CACHE_FILE}.tmp`;

    fs.writeFileSync(
      tempFile,
      JSON.stringify(normalizedCache, null, 2),
      "utf8"
    );

    fs.renameSync(tempFile, CACHE_FILE);

    console.log(
      `💾 Owner cache written (${Object.keys(normalizedCache).filter((k) => k !== "_meta").length} wallets, all lowercase)`
    );
  } catch (err) {
    console.error("Failed to write owner cache:", err.message);
  }
}

/**
 * Delete cached ownership data for a wallet address
 */
export function deleteCache(wallet) {
  if (!fs.existsSync(CACHE_FILE)) return;

  try {
    const cache = readOwnerCache();
    const key = wallet.toLowerCase();

    if (cache[key]) {
      delete cache[key];
      writeOwnerCache(cache);
      console.log(`🗑️ Cache deleted for wallet: ${key}`);
    }
  } catch (err) {
    console.error("Failed to delete cache for wallet:", wallet, err.message);
  }
}