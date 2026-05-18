import fs from "fs";
import path from "path";
import {
  METADATA_IMAGES_DIR,
  loadMapping,
} from "../paths.js";
import {
  VKIN_CONTRACT_ADDRESS,
  VQLE_CONTRACT_ADDRESS,
  SCIONS_CONTRACT_ADDRESS,
  EVG_CONTRACT_ADDRESS,
} from "../config.js";

const addressToCollection = {
  [VKIN_CONTRACT_ADDRESS.toLowerCase()]: "VKIN",
  [VQLE_CONTRACT_ADDRESS.toLowerCase()]: "VQLE",
  [SCIONS_CONTRACT_ADDRESS.toLowerCase()]: "SCIONS",
  [EVG_CONTRACT_ADDRESS.toLowerCase()]: "EVG",
};

export function resolveCollectionFromAddress(rawAddr) {
  const addr = String(rawAddr || "").trim().toLowerCase();

  return (
    addressToCollection[addr] ||
      (addr.includes("8cfbb04c")
      ? "VQLE"
      : addr.includes("5c81a560")   // 👈 add this
      ? "EVG"
      : addr.includes("ac620b1a3de23f4eb0a69663613babf73f6c535d")
      ? "SCIONS"
      : "VKIN")
  );
}

export function resolveNftImageFile({
  contractAddress,
  tokenId,
  tokenURI,
}) {
  const collection = resolveCollectionFromAddress(contractAddress);
  const tokenIdStr = String(tokenId);

  const mapping = loadMapping();
  const mappedEntry = mapping?.[collection]?.[tokenIdStr];

  const COLLECTION_IMAGE_FORMATS = {
    EVG: "webp",
    VQLE: "png",
    SCIONS: "png",
    VKIN: "png",
  };

  const format = COLLECTION_IMAGE_FORMATS[collection] || "png";

  let imageFile = `${tokenIdStr}.${format}`;

  if (mappedEntry?.image_file) {
    imageFile = String(mappedEntry.image_file);
  } else if (mappedEntry?.token_uri) {
    imageFile = String(mappedEntry.token_uri).replace(/\.json$/i, `.${format}`);
  } else if (tokenURI) {
    imageFile = String(tokenURI).replace(/\.json$/i, `.${format}`);
  }

  return {
    collection,
    imageFile,
    absolutePath: path.join(METADATA_IMAGES_DIR, collection, imageFile),
  };
}

export function resolveExistingNftImage(args) {
  const resolved = resolveNftImageFile(args);

  if (fs.existsSync(resolved.absolutePath)) {
    return resolved;
  }

  return {
    ...resolved,
    absolutePath: null,
  };
}