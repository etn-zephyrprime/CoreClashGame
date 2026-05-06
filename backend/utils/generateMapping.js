import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import axios from "axios";
import { fileURLToPath } from "url";

import {
  IPFS_GATEWAYS,
  VKIN_CONTRACT_ADDRESS,
  SCIONS_CONTRACT_ADDRESS,
  VQLE_IPFS_BASE,
  EVG_IPFS_BASE,
  RPC_URL,
} from "../config.js";

import {
  METADATA_JSON_DIR,
  METADATA_IMAGES_DIR,
  MAPPING_FILE,
  ensureDataPaths,
  loadMapping,
} from "../paths.js";

/* ---------------- Paths ---------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VKIN_JSON_DIR = path.join(METADATA_JSON_DIR, "VKIN");
const VKIN_IMAGE_DIR = path.join(METADATA_IMAGES_DIR, "VKIN");
const VQLE_JSON_DIR = path.join(METADATA_JSON_DIR, "VQLE");
const VQLE_IMAGE_DIR = path.join(METADATA_IMAGES_DIR, "VQLE");
const SCIONS_JSON_DIR = path.join(METADATA_JSON_DIR, "SCIONS");
const SCIONS_IMAGE_DIR = path.join(METADATA_IMAGES_DIR, "SCIONS");
const EVG_JSON_DIR = path.join(METADATA_JSON_DIR, "EVG");
const EVG_IMAGE_DIR = path.join(METADATA_IMAGES_DIR, "EVG");

/* ---------------- Fixed Supplies ---------------- */
const VKIN_MAX_SUPPLY = 474;
const VQLE_MAX_SUPPLY = 30;
const SCIONS_MAX_SUPPLY = 198;
const EVG_MAX_SUPPLY = 1000;

const VKIN_ABI = ["function tokenURI(uint256 tokenId) view returns (string)"];
const SCIONS_ABI = ["function tokenURI(uint256 tokenId) view returns (string)"];

/* ---------------- Helpers ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getMissingTokenIds(existingMap, collection, maxSupply) {
  const existing = existingMap[collection] || {};
  const missing = [];

  for (let tokenId = 1; tokenId <= maxSupply; tokenId++) {
    if (!existing[String(tokenId)]) {
      missing.push(tokenId);
    }
  }

  return missing;
}

function flattenExistingRows(existingMap, rows) {
  for (const [collection, tokens] of Object.entries(existingMap)) {
    for (const [tokenId, data] of Object.entries(tokens)) {
      rows.push(
        `${collection},${tokenId},${data.token_uri || ""},${data.image_file || ""}`
      );
    }
  }
}

async function fetchWithRetries(
  ipfsUri,
  retriesPerGateway = 3,
  retryDelayMs = 5000,
  responseType = "arraybuffer"
) {
  const cidPath = ipfsUri.replace("ipfs://", "");

  for (const gateway of IPFS_GATEWAYS) {
    const url = `${gateway}/${cidPath}`;
    console.log(`🌐 Trying: ${url}`);

    for (let attempt = 1; attempt <= retriesPerGateway; attempt++) {
      try {
        const res = await axios.get(url, { responseType, timeout: 30_000 });
        return res.data;
      } catch (err) {
        if (err.code === "ENOTFOUND") break;
        console.warn(
          `Attempt ${attempt}/${retriesPerGateway} failed for ${url}: ${err.message}`
        );
        if (attempt < retriesPerGateway) await sleep(retryDelayMs);
      }
    }
  }

  console.warn(`❌ All gateways failed for ${ipfsUri}`);
  return null;
}

const COLLECTION_IMAGE_FORMATS = {
  EVG: "webp",
  VQLE: "png",
  SCIONS: "png",
  VKIN: "png",
};

function defaultImageFile(collection, tokenId) {
  const format = COLLECTION_IMAGE_FORMATS[collection] || "png";
  return `${tokenId}.${format}`;
}


/* ---------------- VKIN ---------------- */
async function generateVKIN(rows, provider, existingMap) {
  ensureDir(VKIN_JSON_DIR);
  ensureDir(VKIN_IMAGE_DIR);

  const missingIds = getMissingTokenIds(existingMap, "VKIN", VKIN_MAX_SUPPLY);
  if (missingIds.length === 0) {
    console.log("✅ VKIN already fully cached");
    return;
  }

  console.log(`VKIN missing tokens: ${missingIds.length}`);

  const contract = new ethers.Contract(VKIN_CONTRACT_ADDRESS, VKIN_ABI, provider);

  for (const tokenId of missingIds) {
    let jsonFile = null;

    const COLLECTION_IMAGE_FORMATS = {
  EVG: "webp",
  VQLE: "png",
  SCIONS: "png",
  VKIN: "png",
};

const format = COLLECTION_IMAGE_FORMATS[collection] || "png";

let imageFile = defaultImageFile("VKIN", tokenId);

    try {
      const tokenURI = await contract.tokenURI(tokenId);
      if (!tokenURI?.startsWith("ipfs://")) {
        console.warn(`VKIN ${tokenId}: tokenURI not IPFS → skipping`);
        continue;
      }

      jsonFile = path.basename(tokenURI);
      const jsonPath = path.join(VKIN_JSON_DIR, jsonFile);

      let metadata;
      if (fs.existsSync(jsonPath)) {
        metadata = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      } else {
        const rawJson = await fetchWithRetries(tokenURI, 3, 5000, "arraybuffer");
        if (!rawJson) continue;

        metadata = JSON.parse(rawJson.toString());
        fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));
        console.log(`💾 Saved VKIN JSON ${jsonFile}`);
      }

      if (metadata.image?.startsWith("ipfs://")) {
        const downloadedImageFile = path.basename(metadata.image);
        const imagePath = path.join(VKIN_IMAGE_DIR, downloadedImageFile);

        if (!fs.existsSync(imagePath)) {
          const img = await fetchWithRetries(metadata.image, 3, 5000, "arraybuffer");
          if (img) {
            fs.writeFileSync(imagePath, img);
            console.log(`🖼️ Downloaded VKIN image ${downloadedImageFile}`);
          }
        }

        imageFile = downloadedImageFile;
      }

      rows.push(`VKIN,${tokenId},${jsonFile},${imageFile}`);
      console.log(`Added VKIN ${tokenId} → ${jsonFile} / ${imageFile}`);
    } catch (err) {
      console.warn(`⚠️ VKIN tokenId ${tokenId} skipped: ${err.message}`);
    }

    await sleep(100);
  }
}

/* ---------------- VQLE ---------------- */
async function generateVQLE(rows, existingMap) {
  ensureDir(VQLE_JSON_DIR);
  ensureDir(VQLE_IMAGE_DIR);

  const missingIds = getMissingTokenIds(existingMap, "VQLE", VQLE_MAX_SUPPLY);
  if (missingIds.length === 0) {
    console.log("✅ VQLE already fully cached");
    return;
  }

  console.log(`VQLE missing tokens: ${missingIds.length}`);

  const baseCid = VQLE_IPFS_BASE.replace(/https?:\/\/[^/]+\//, "");

  for (const tokenId of missingIds) {
    const jsonFile = `${tokenId}.json`;
    const jsonPath = path.join(VQLE_JSON_DIR, jsonFile);
    let metadata;

    if (fs.existsSync(jsonPath)) {
      metadata = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } else {
      const jsonUri = `ipfs://${baseCid}${jsonFile}`;
      const rawJson = await fetchWithRetries(jsonUri, 3, 5000, "arraybuffer");
      if (!rawJson) continue;

      metadata = JSON.parse(rawJson.toString());
      fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));
      console.log(`💾 Saved VQLE JSON ${jsonFile}`);
    }

let imageFile = defaultImageFile("VQLE", tokenId);

    if (metadata.image?.startsWith("ipfs://")) {
      const downloadedImageFile = path.basename(metadata.image);
      const imagePath = path.join(VQLE_IMAGE_DIR, downloadedImageFile);

      if (!fs.existsSync(imagePath)) {
        const img = await fetchWithRetries(metadata.image, 3, 5000, "arraybuffer");
        if (img) {
          fs.writeFileSync(imagePath, img);
          console.log(`🖼️ Downloaded VQLE image ${downloadedImageFile}`);
        }
      }

      imageFile = downloadedImageFile;
    }

    rows.push(`VQLE,${tokenId},${jsonFile},${imageFile}`);
    console.log(`Added VQLE ${tokenId} → ${jsonFile} / ${imageFile}`);

    await sleep(100);
  }
}

/* ---------------- SCIONS ---------------- */
async function generateSCIONS(rows, provider, existingMap) {
  ensureDir(SCIONS_JSON_DIR);
  ensureDir(SCIONS_IMAGE_DIR);

  const missingIds = getMissingTokenIds(existingMap, "SCIONS", SCIONS_MAX_SUPPLY);
  if (missingIds.length === 0) {
    console.log("✅ SCIONS already fully cached");
    return;
  }

  console.log(`SCIONS missing tokens: ${missingIds.length}`);

  const contract = new ethers.Contract(SCIONS_CONTRACT_ADDRESS, SCIONS_ABI, provider);

  for (const tokenId of missingIds) {
    let jsonFile = null;

let imageFile = defaultImageFile("SCIONS", tokenId);

    try {
      const tokenURI = await contract.tokenURI(tokenId);
      if (!tokenURI?.startsWith("ipfs://")) {
        console.warn(`SCIONS ${tokenId}: tokenURI not IPFS → skipping`);
        continue;
      }

      jsonFile = path.basename(tokenURI);
      const jsonPath = path.join(SCIONS_JSON_DIR, jsonFile);

      let metadata;
      if (fs.existsSync(jsonPath)) {
        metadata = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      } else {
        const rawJson = await fetchWithRetries(tokenURI, 3, 5000, "arraybuffer");
        if (!rawJson) continue;

        metadata = JSON.parse(rawJson.toString());
        fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));
        console.log(`💾 Saved SCIONS JSON ${jsonFile}`);
      }

      if (metadata.image?.startsWith("ipfs://")) {
        const downloadedImageFile = path.basename(metadata.image);
        const imagePath = path.join(SCIONS_IMAGE_DIR, downloadedImageFile);

        if (!fs.existsSync(imagePath)) {
          const img = await fetchWithRetries(metadata.image, 3, 5000, "arraybuffer");
          if (img) {
            fs.writeFileSync(imagePath, img);
            console.log(`🖼️ Downloaded SCIONS image ${downloadedImageFile}`);
          }
        }

        imageFile = downloadedImageFile;
      }

      rows.push(`SCIONS,${tokenId},${jsonFile},${imageFile}`);
      console.log(`Added SCIONS ${tokenId} → ${jsonFile} / ${imageFile}`);
    } catch (err) {
      console.warn(`⚠️ SCIONS tokenId ${tokenId} skipped: ${err.message}`);
    }

    await sleep(100);
  }
}

/* ---------------- EVG ---------------- */
async function generateEVG(rows, existingMap) {
  ensureDir(EVG_JSON_DIR);
  ensureDir(EVG_IMAGE_DIR);

  const missingIds = getMissingTokenIds(existingMap, "EVG", EVG_MAX_SUPPLY);
  if (missingIds.length === 0) {
    console.log("✅ EVG already fully cached");
    return;
  }

  console.log(`EVG missing tokens: ${missingIds.length}`);

  const baseCid = EVG_IPFS_BASE.replace(/https?:\/\/[^/]+\//, "");

  for (const tokenId of missingIds) {
    const jsonFile = `${tokenId}.json`;
    const jsonPath = path.join(EVG_JSON_DIR, jsonFile);
    let metadata;

    if (fs.existsSync(jsonPath)) {
      metadata = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } else {
      const jsonUri = `ipfs://${baseCid}${jsonFile}`;
      const rawJson = await fetchWithRetries(jsonUri, 3, 5000, "arraybuffer");
      if (!rawJson) continue;

      metadata = JSON.parse(rawJson.toString());
      fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));
      console.log(`💾 Saved EVG JSON ${jsonFile}`);
    }

let imageFile = defaultImageFile("EVG", tokenId);

if (metadata.image?.startsWith("ipfs://")) {
      const downloadedImageFile = path.basename(metadata.image);
      const imagePath = path.join(EVG_IMAGE_DIR, downloadedImageFile);

      if (!fs.existsSync(imagePath)) {
        const img = await fetchWithRetries(metadata.image, 3, 5000, "arraybuffer");
        if (img) {
          fs.writeFileSync(imagePath, img);
          console.log(`🖼️ Downloaded EVG image ${downloadedImageFile}`);
        }
      }

      imageFile = downloadedImageFile;
    }

    rows.push(`EVG,${tokenId},${jsonFile},${imageFile}`);
    console.log(`Added EVG ${tokenId} → ${jsonFile} / ${imageFile}`);

    await sleep(100);
  }
}

/* ---------------- Main ---------------- */
export async function generateMapping(mode = "ALL") {
  ensureDataPaths();

  const existingMap = loadMapping();
  const rows = ["collection,token_id,token_uri,image_file"];

  // preserve existing rows first
  flattenExistingRows(existingMap, rows);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const selected = String(mode).toUpperCase();

  if (selected === "VKIN" || selected === "ALL") {
    await generateVKIN(rows, provider, existingMap);
  }

  if (selected === "SCIONS" || selected === "ALL") {
    await generateSCIONS(rows, provider, existingMap);
  }

  if (selected === "VQLE" || selected === "ALL") {
    await generateVQLE(rows, existingMap);
  }

  if (selected === "EVG" || selected === "ALL") {
    await generateEVG(rows, existingMap);
  }

  fs.writeFileSync(MAPPING_FILE, rows.join("\n"));
  console.log(`✅ mapping.csv complete for mode=${selected}`);
}

/* ---------------- CLI ---------------- */
if (process.argv[1]?.endsWith("generateMapping.js")) {
  const mode = process.env.MAPPING_MODE || process.argv[2] || "ALL";
  generateMapping(mode).catch(console.error);
}