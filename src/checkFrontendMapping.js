import fs from "fs";
import {
  MAPPING_FILE,
  FRONTEND_MAPPING_FILE,
  ensureDataPaths,
} from "../backend/paths.js";
import { queueR2Upload } from "../backend/utils/r2Sync.js";

const COLLECTION_IMAGE_FORMATS = {
  EVG: "webp",
  VKIN: "png",
  VQLE: "png",
  SCIONS: "png",
};

function parseSimpleCSV(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row = {};
    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });
    return row;
  });
}

export async function checkFrontendMapping() {
  ensureDataPaths();

  if (!fs.existsSync(MAPPING_FILE)) {
    console.error(`mapping.csv not found: ${MAPPING_FILE}`);
    return;
  }

  const csvContent = fs.readFileSync(MAPPING_FILE, "utf8").trim();
  const records = parseSimpleCSV(csvContent);

  const mapping = {};

  for (const row of records) {
    const {
      collection,
      token_id: tokenId,
      token_uri: tokenURI,
      image_file: imageFile,
    } = row;

    if (!collection || !tokenId || !tokenURI) {
      console.warn("⚠️ Skipping invalid CSV row:", row);
      continue;
    }

    if (!mapping[collection]) mapping[collection] = {};

const collectionKey = collection.trim();

if (!mapping[collectionKey]) mapping[collectionKey] = {};

const format = COLLECTION_IMAGE_FORMATS[collectionKey] || "png";

mapping[collectionKey][tokenId] = {
  token_uri: tokenURI.trim(),
  image_file: (
    imageFile ||
    tokenURI.replace(/\.json$/i, `.${format}`)
  ).trim(),
};
}

  fs.writeFileSync(FRONTEND_MAPPING_FILE, JSON.stringify(mapping, null, 2));
  queueR2Upload(FRONTEND_MAPPING_FILE);
  console.log(`✅ Frontend mapping.json generated at ${FRONTEND_MAPPING_FILE}`);
  console.log(`Total collections: ${Object.keys(mapping).length}`);
  console.log(
    `Total tokens: ${Object.values(mapping).reduce(
      (sum, col) => sum + Object.keys(col).length,
      0
    )}`
  );
}

/* CLI support */
if (process.argv[1]?.endsWith("checkFrontendMapping.js")) {
  checkFrontendMapping().catch((err) => {
    console.error("❌ checkFrontendMapping failed:", err);
    process.exit(1);
  });
}