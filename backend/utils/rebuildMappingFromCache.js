import fs from "fs";
import path from "path";
import { METADATA_JSON_DIR, MAPPING_FILE } from "../paths.js";
import { queueR2Upload } from "./r2Sync.js";

const VKIN_DIR = path.join(METADATA_JSON_DIR, "VKIN");
const VQLE_DIR = path.join(METADATA_JSON_DIR, "VQLE");
const SCIONS_DIR = path.join(METADATA_JSON_DIR, "SCIONS");

/* ------------------ Helpers ------------------ */
function readExistingVKIN() {
  if (!fs.existsSync(MAPPING_FILE)) return [];

  return fs
    .readFileSync(MAPPING_FILE, "utf8")
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .filter(row => row.startsWith("VKIN,"));
}

function readExistingSCIONS() {
  if (!fs.existsSync(MAPPING_FILE)) return [];

  return fs
    .readFileSync(MAPPING_FILE, "utf8")
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .filter(row => row.startsWith("SCIONS,"));
}


/* ------------------ Rebuild ------------------ */
function rebuildMapping() {
  const rows = ["collection,token_id,token_uri"];

  // Preserve VKIN mapping
  const vkinRows = readExistingVKIN();
  rows.push(...vkinRows);

    // Preserve SCIONS mapping
  const scionsRows = readExistingSCIONS();
  rows.push(...scionsRows);

  // Rebuild VQLE from cache
  const vqleFiles = fs
    .readdirSync(VQLE_DIR)
    .filter(f => f.endsWith(".json"))
    .sort((a, b) => Number(a) - Number(b));

  for (const file of vqleFiles) {
    const tokenId = path.basename(file, ".json");
    rows.push(`VQLE,${tokenId},${file}`);
  }

  fs.writeFileSync(MAPPING_FILE, rows.join("\n"));
  queueR2Upload(MAPPING_FILE);
  console.log("✅ mapping.csv rebuilt from cache");
}

rebuildMapping();
