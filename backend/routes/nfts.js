import express from "express";
const router = express.Router();
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { readOwnerCache, writeOwnerCache } from "../utils/ownerCache.js";
import { METADATA_JSON_DIR, FRONTEND_MAPPING_FILE } from "../paths.js";
import { RPC_URL, VKIN_CONTRACT_ADDRESS, VQLE_CONTRACT_ADDRESS, SCIONS_CONTRACT_ADDRESS, EVG_CONTRACT_ADDRESS } from "../config.js";
import { fetchOwnedTokenIds } from "../utils/nftUtils.js";
import VKIN_ABI from "../../src/abis/VKINABI.json" with { type: "json" };
import VQLE_ABI from "../../src/abis/VQLEABI.json" with { type: "json" };
import SCIONS_ABI from "../../src/abis/SCIONSABI.json" with { type: "json" };
import EVG_ABI from "../../src/abis/EVGABI.json" with { type: "json" };

const delay = ms => new Promise(r => setTimeout(r, ms));
const RETRY_COUNT = 3; 
const RETRY_DELAY_MS = 1000;
const refreshCooldowns = new Map();
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

// Retry wrapper
async function retryRpc(fn, retries = RETRY_COUNT, delayMs = RETRY_DELAY_MS) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      console.warn(`RPC attempt ${attempt} failed: ${err.message}`);
      if (attempt < retries) await delay(delayMs);
      else throw err;
    }
  }
}

function readMapping() {
  try {
    if (!fs.existsSync(FRONTEND_MAPPING_FILE)) {
      console.warn(`Mapping file missing: ${FRONTEND_MAPPING_FILE}`);
      return {};
    }

    return JSON.parse(fs.readFileSync(FRONTEND_MAPPING_FILE, "utf8"));
  } catch (err) {
    console.error("Failed to read frontend mapping:", err.message);
    return {};
  }
}

// Helper: enrich a single token with remapped data + real metadata
async function enrichToken(collection, tokenIdStr, nftAddress, liveMapping = {}) {
  const tokenId = String(tokenIdStr);
  const mapped = liveMapping?.[collection]?.[tokenId];

  let tokenURI = mapped?.token_uri || `${tokenId}.json`;

const COLLECTION_IMAGE_FORMATS = {
  EVG: "webp",
  VQLE: "png",
  SCIONS: "png",
  VKIN: "png",
};

const format = COLLECTION_IMAGE_FORMATS[collection] || "png";

let imageFile =
  mapped?.image_file ||
  tokenURI.replace(/\.json$/i, `.${format}`);
  
  let name = `${collection} #${tokenId}`;
  let background = "Unknown";

  const jsonPath = path.join(METADATA_JSON_DIR, collection, tokenURI);

  if (fs.existsSync(jsonPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

      name = meta.name || name;
      background =
        meta.background ||
        meta.attributes?.find(
          (a) => a.trait_type?.toLowerCase() === "background"
        )?.value ||
        background;
    } catch (e) {
      console.warn(
        `Failed to parse metadata for ${collection} #${tokenId} using ${tokenURI}: ${e.message}`
      );
    }
  } else {
    console.warn(`Missing metadata JSON: ${jsonPath}`);
  }

  return {
    collection,
    tokenId,
    tokenURI,
    nftAddress,
    name,
    background,
    imageFile,
  };
}

// Helper: fetch owned tokenIds (no metadata here yet)
router.post("/force-cache/:wallet", async (req, res) => {
  const wallet = req.params.wallet.toLowerCase();
  console.log(`Force cache requested for ${wallet}`);

  try {
    const cache = readOwnerCache();

const existing = cache[wallet] || {};
const complete =
  Array.isArray(existing.VKIN) &&
  Array.isArray(existing.VQLE) &&
  Array.isArray(existing.SCIONS) &&
  Array.isArray(existing.EVG);

if (complete) {
  console.log("Complete cache already exists — skipping scan");
  return res.json({ success: true, alreadyCached: true });
}

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const vkin = new ethers.Contract(VKIN_CONTRACT_ADDRESS, VKIN_ABI, provider);
    const vqle = new ethers.Contract(VQLE_CONTRACT_ADDRESS, VQLE_ABI, provider);
    const scions = new ethers.Contract(SCIONS_CONTRACT_ADDRESS, SCIONS_ABI, provider);
    const evg = new ethers.Contract(EVG_CONTRACT_ADDRESS, EVG_ABI, provider);


if (shouldScanVKIN) {
  console.log("Scanning VKIN...");
  updatedWalletCache.VKIN = await retryRpc(() =>
    fetchOwnedTokenIds(vkin, wallet, "VKIN")
  );
}

if (shouldScanVQLE) {
  console.log("Scanning VQLE...");
  updatedWalletCache.VQLE = await retryRpc(() =>
    fetchOwnedTokenIds(vqle, wallet, "VQLE")
  );
}

if (shouldScanSCIONS) {
  console.log("Scanning SCIONS...");
  updatedWalletCache.SCIONS = await retryRpc(() =>
    fetchOwnedTokenIds(scions, wallet, "SCIONS")
  );
}

if (shouldScanEVG) {
  console.log("Scanning EVG...");
  updatedWalletCache.EVG = await retryRpc(() =>
    fetchOwnedTokenIds(evg, wallet, "EVG")
  );
}

walletCache = updatedWalletCache;
cache[wallet] = walletCache;
writeOwnerCache(cache);

if (forceRefresh) {
  refreshCooldowns.set(wallet, Date.now());
}

    console.log(`Force cache filled: ${vkinIds.length} VKIN, ${vqleIds.length} VQLE, ${scionsIds.length} SCIONS, ${evgIds.length} EVG`);

    res.json({ success: true, tokens: { VKIN: vkinIds.length, VQLE: vqleIds.length, SCIONS: scionsIds.length, EVG: evgIds.length } });
  } catch (err) {
    console.error("Force cache failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /owned/:wallet
router.get("/owned/:wallet", async (req, res) => {
  const wallet = req.params.wallet.toLowerCase();
  const forceRefresh = req.query.refresh === "true";

if (forceRefresh) {
  const lastRefresh = refreshCooldowns.get(wallet) || 0;
  const now = Date.now();

  if (now - lastRefresh < REFRESH_COOLDOWN_MS) {
    return res.status(429).json({
      error: "NFT refresh is on cooldown. Please try again in a few minutes.",
      retryAfterMs: REFRESH_COOLDOWN_MS - (now - lastRefresh),
    });
  }

  refreshCooldowns.set(wallet, now);
}

  console.log("🔎 Owned NFTs request for:", wallet);

const cache = readOwnerCache();
let walletCache = cache[wallet] || {};

const hasCachedCollection = (collection) =>
  Object.prototype.hasOwnProperty.call(walletCache, collection) &&
  Array.isArray(walletCache[collection]);

const shouldScanVKIN = forceRefresh || !hasCachedCollection("VKIN");
const shouldScanVQLE = forceRefresh || !hasCachedCollection("VQLE");
const shouldScanSCIONS = forceRefresh || !hasCachedCollection("SCIONS");
const shouldScanEVG = forceRefresh || !hasCachedCollection("EVG");

if (shouldScanVKIN || shouldScanVQLE || shouldScanSCIONS || shouldScanEVG) {
  console.log("Partial cache — scanning missing collections for", wallet, {
    shouldScanVKIN,
    shouldScanVQLE,
    shouldScanSCIONS,
    shouldScanEVG,
  });

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const vkin = new ethers.Contract(VKIN_CONTRACT_ADDRESS, VKIN_ABI, provider);
    const vqle = new ethers.Contract(VQLE_CONTRACT_ADDRESS, VQLE_ABI, provider);
    const scions = new ethers.Contract(SCIONS_CONTRACT_ADDRESS, SCIONS_ABI, provider);
    const evg = new ethers.Contract(EVG_CONTRACT_ADDRESS, EVG_ABI, provider);

    const updatedWalletCache = { ...walletCache };

    if (shouldScanVKIN) {
      console.log("Scanning VKIN...");
      updatedWalletCache.VKIN = await fetchOwnedTokenIds(vkin, wallet, "VKIN");
    }

    if (shouldScanVQLE) {
      console.log("Scanning VQLE...");
      updatedWalletCache.VQLE = await fetchOwnedTokenIds(vqle, wallet, "VQLE");
    }

    if (shouldScanSCIONS) {
      console.log("Scanning SCIONS...");
      updatedWalletCache.SCIONS = await fetchOwnedTokenIds(scions, wallet, "SCIONS");
    }

    if (shouldScanEVG) {
      console.log("Scanning EVG...");
      updatedWalletCache.EVG = await fetchOwnedTokenIds(evg, wallet, "EVG");
    }

    walletCache = updatedWalletCache;
    cache[wallet] = walletCache;
    writeOwnerCache(cache);

if (forceRefresh) {
  refreshCooldowns.set(wallet, Date.now());
}

    console.log(
      `Cache updated: ${(walletCache.VKIN || []).length} VKIN, ${(walletCache.VQLE || []).length} VQLE, ${(walletCache.SCIONS || []).length} SCIONS, ${(walletCache.EVG || []).length} EVG`
    );
  } catch (err) {
    console.error("On-chain scan failed:", err.message);

    return res.status(503).json({
      error: "Ownership scan temporarily failed or was rate limited. Please try again shortly.",
      detail: err.message,
    });
  }
} else {
  console.log("Cache hit — using cached data");
}

  // Enrich and return (your existing code)
// After cache fill or cache hit
const liveMapping = readMapping();
const result = [];

for (const tokenId of walletCache.VKIN || []) {
  result.push(await enrichToken("VKIN", tokenId, VKIN_CONTRACT_ADDRESS, liveMapping));
}

for (const tokenId of walletCache.VQLE || []) {
  result.push(await enrichToken("VQLE", tokenId, VQLE_CONTRACT_ADDRESS, liveMapping));
}

for (const tokenId of walletCache.SCIONS || []) {
  result.push(await enrichToken("SCIONS", tokenId, SCIONS_CONTRACT_ADDRESS, liveMapping));
}

for (const tokenId of walletCache.EVG || []) {
  result.push(await enrichToken("EVG", tokenId, EVG_CONTRACT_ADDRESS, liveMapping));
}

res.json(result);
});

router.get("/mapping.json", (req, res) => {
  try {
    if (!fs.existsSync(FRONTEND_MAPPING_FILE)) {
      return res.status(404).json({
        error: "mapping.json not found",
      });
    }

    res.sendFile(FRONTEND_MAPPING_FILE);
  } catch (err) {
    console.error("Failed serving mapping.json:", err);

    res.status(500).json({
      error: "Failed to serve mapping.json",
    });
  }
});

router.get("/staked/:wallet", async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();

    const data = await loadStakes();

    res.json(data[wallet] || []);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

export default router;