import React from "react";
import { StableImage } from "./gameCard";
import { BACKEND_URL } from "./config.js";

// Mapping (lowercase + checksummed)
const addressToCollection = {
  "0x3fc7665b1f6033ff901405cddf31c2e04b8a2ab4": "VKIN",
  "0x3FC7665B1F6033FF901405CdDF31C2E04B8A2AB4": "VKIN",
  "0x8cfbb04c54d35e2e8471ad9040d40d73c08136f0": "VQLE",
  "0x8cFBB04c54d35e2e8471Ad9040D40D73C08136f0": "VQLE",
  "0xac620b1a3de23f4eb0a69663613babf73f6c535d": "SCIONS",
  "0xAc620b1A3dE23F4EB0A69663613baBf73F6C535D": "SCIONS",
  "0x5C81a5609EaeEF7962F1D089D6343F9790387901": "EVG",
  "0x5c81a5609eaeef7962f1d089d6343f9790387901": "EVG",
};

const COLLECTION_IMAGE_FORMATS = {
  EVG: "webp",
  SCIONS: "png",
  VQLE: "png",
  VKIN: "png",
};

export const renderTokenImages = (input = [], mapping = {}) => {
  console.log("[renderTokenImages] Raw input:", JSON.stringify(input, null, 2));
  console.log("[renderTokenImages] Live mapping loaded:", mapping);

  let tokens = [];

  if (Array.isArray(input)) {
    tokens = input.map((token) => {
      const rawCollection = token.collection || token.mappingKey || "VKIN";
      const collection = String(rawCollection).toUpperCase();
      const tokenId = String(token.tokenId ?? "");
const format = COLLECTION_IMAGE_FORMATS[collection] || "png";

const imageFile = token.imageFile || `${tokenId}.${format}`;

      return {
        collection,
        mappingKey: collection,
        tokenId,
        imageFile,
      };
    });
  } else if (input && typeof input === "object") {
    const { nftContracts = [], tokenIds = [], tokenURIs = [] } = input;

    tokens = tokenIds.map((id, idx) => {
      const rawAddr = nftContracts[idx];
      let addr = (rawAddr || "").toString().trim();

      console.log(`Slot ${idx} raw type:`, typeof rawAddr, "length:", rawAddr?.length || "N/A");

      const charCodes = addr.split("").map((c) => c.charCodeAt(0)).join(", ");
      console.log(`Slot ${idx} char codes:`, charCodes);

      addr = addr.replace(/[^0-9a-fA-F]/gi, "").toLowerCase();

      if (addr && !addr.startsWith("0x")) {
        addr = "0x" + addr;
      }

      let collection = addressToCollection[addr];

      if (!collection && (addr.includes("8cfb") || addr.includes("8cfbb04c"))) {
        console.log(`Slot ${idx} VQLE pattern match → forcing VQLE`);
        collection = "VQLE";
      }

      if (!collection) {
        console.warn(
          `Slot ${idx} NO MATCH for cleaned addr "${addr}" (raw: "${rawAddr}") — defaulting to VKIN`
        );
        collection = "VKIN";
      }

      const mappingKey = collection;
      const tokenId = String(id);
      const imageFile = tokenId.imageFile || `${tokenId}.${format}`;
      const mapped = mapping?.[mappingKey]?.[tokenId];

      console.log(`Slot ${idx} final:`, {
        rawAddr,
        cleanedAddr: addr,
        collection,
        mappingKey,
        tokenId,
        tokenURI: tokenURIs[idx] || "none",
        mapped,
      });

      // Priority 1: explicit tokenURI from backend
// Priority 1: live mapping.json
const format = COLLECTION_IMAGE_FORMATS[collection] || "png";

if (mapped) {
  imageFile =
    mapped?.image_file ??
    mapped?.token_uri?.replace(/\.json$/i, `.${format}`) ??
    `${tokenId}.${format}`;

  console.log(`Slot ${idx}: live mapping → ${imageFile}`);
}
// Priority 2: explicit tokenURI from backend
else if (tokenURIs[idx]) {
  imageFile = tokenURIs[idx].replace(/\.json$/i, `.${format}`);

  console.log(
    `Slot ${idx}: backend tokenURI → ${imageFile} (collection: ${collection}, mappingKey: ${mappingKey})`
  );
}
      // Priority 2: live mapping.json from backend
else if (mapped) {
  const format = COLLECTION_IMAGE_FORMATS[collection] || "png";

  imageFile =
    mapped?.image_file ??
    mapped?.token_uri?.replace(/\.json$/i, `.${format}`) ??
    `${tokenId}.${format}`;

        console.log(`Slot ${idx}: live mapping → ${imageFile}`);
      } else {
        console.warn(
          `Slot ${idx}: no live mapping found for ${mappingKey} #${tokenId}, defaulting to ${imageFile}`
        );
      }

      console.log(`Slot ${idx} final imageFile: ${imageFile}`);

      return {
        collection,
        mappingKey,
        tokenId,
        imageFile,
      };
    });
  }

  if (!tokens.length) return null;

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
      {tokens.map((token, i) => {
        const { collection, mappingKey, tokenId, imageFile } = token;

        let finalImageFile = imageFile;

const mapped = mapping?.[mappingKey]?.[String(tokenId)];

if (mapped) {
  const format = COLLECTION_IMAGE_FORMATS[collection] || "png";

  finalImageFile =
    mapped?.image_file ??
    mapped?.token_uri?.replace(/\.json$/i, `.${format}`) ??
    `${tokenId}.${format}`;
}

        const src = `${BACKEND_URL}/images/${collection}/${finalImageFile}`;

        console.log(`Rendering slot ${i}: ${src}`);

        return (
          <StableImage
            key={`${collection}-${tokenId}-${i}`}
            src={src}
            alt={`${collection} #${tokenId}`}
          />
        );
      })}
    </div>
  );
};