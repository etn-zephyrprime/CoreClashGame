import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import VKIN_ABI_JSON from "../src/abis/VKINABI.json" with { type: "json" };
import VQLE_ABI_JSON from "../src/abis/VQLEABI.json" with { type: "json" };
import SCIONS_ABI_JSON from "../src/abis/SCIONSABI.json" with { type: "json" };
import EVG_ABI_JSON from "../src/abis/EVGABI.json" with { type: "json" };
import { RPC_URL } from "./config.js";
import { BASE_DATA_DIR } from "./utils/dataDir.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLLECTION_IMAGE_FORMATS = {
  EVG: "webp",
  VQLE: "png",
  SCIONS: "png",
  VKIN: "png",
};

export { BASE_DATA_DIR };

export const METADATA_JSON_DIR = path.join(
  BASE_DATA_DIR,
  "metadata-cache",
  "json"
);

export const METADATA_IMAGES_DIR = path.join(
  BASE_DATA_DIR,
  "metadata-cache",
  "images"
);

export const MAPPING_FILE = path.join(BASE_DATA_DIR, "mapping.csv");
export const FRONTEND_MAPPING_FILE = path.join(BASE_DATA_DIR, "mapping.json");
export const WEEKLY_LEADERBOARD_FILE = path.join(BASE_DATA_DIR, "weeklyLeaderboards.json");
export const REVEAL_DIR = path.join(BASE_DATA_DIR, "reveals");

export const VKIN_ABI = VKIN_ABI_JSON;
export const VQLE_ABI = VQLE_ABI_JSON;
export const SCIONS_ABI = SCIONS_ABI_JSON;
export const EVG_ABI = EVG_ABI_JSON;

export { RPC_URL };

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log("📁 Created directory:", dir);
  }
}

export function ensureDataPaths() {
  // BASE_DATA_DIR itself is guaranteed to exist by dataDir.js at import time
  // (it falls back to a local directory when there's no mounted disk), so
  // there's nothing to throw on here anymore — just make sure the subdirs
  // we read/write are there.
  ensureDir(METADATA_JSON_DIR);
  ensureDir(METADATA_IMAGES_DIR);
  ensureDir(REVEAL_DIR);
}

export function loadMapping() {
  if (!fs.existsSync(MAPPING_FILE)) {
    console.warn("mapping.csv not found → empty mapping");
    return {};
  }

  const csv = fs.readFileSync(MAPPING_FILE, "utf8");
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const map = {};

  for (const r of records) {
    const collection = r.collection?.toUpperCase();
    const tokenId = String(r.token_id);

    if (!collection || !tokenId) {
      console.warn("Invalid CSV row skipped:", r);
      continue;
    }

    if (!map[collection]) map[collection] = {};

const format = COLLECTION_IMAGE_FORMATS[collection] || "png";

map[collection][tokenId] = {
  token_uri: r.token_uri?.trim(),
  image_file:
    r.image_file?.trim() ||
    (r.token_uri
      ? r.token_uri.replace(/\.json$/i, `.${format}`)
      : `${tokenId}.${format}`),
};
}
  return map;
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