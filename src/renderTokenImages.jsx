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

const normalizeTokenId = (id) =>
  String(id).trim().replace(/^0+/, "");

export const renderTokenImages = (input = [], mapping = {}) => {
  console.log("[renderTokenImages] Raw input:", input);
  console.log("[renderTokenImages] Live mapping loaded:", mapping);

  let tokens = [];

  // =========================
  // ARRAY INPUT MODE
  // =========================
  if (Array.isArray(input)) {
tokens = input.map((token) => {
  const rawCollection = token.collection || token.mappingKey || "VKIN";
  const collection = String(rawCollection).toUpperCase();

  const tokenId = normalizeTokenId(token.tokenId);

  const mapped = mapping?.[collection]?.[tokenId];

  const imageFile =
    mapped?.image_file ??
    `${tokenId}.${COLLECTION_IMAGE_FORMATS[collection] || "png"}`;

  return {
    collection,
    tokenId,
    imageFile,
  };
});
  }

  // =========================
  // CONTRACT INPUT MODE
  // =========================
  else if (input && typeof input === "object") {
    const { nftContracts = [], tokenIds = [], tokenURIs = [] } = input;

tokens = tokenIds.map((id, idx) => {
  const rawAddr = nftContracts[idx];
  const tokenURI = tokenURIs?.[idx];

  let addr = (rawAddr || "")
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "");

  addr = addr.length === 40 ? "0x" + addr : addr;

  let collection = addressToCollection[addr];

  if (!collection && addr.includes("8cfb")) {
    collection = "VQLE";
  }

  if (!collection) {
    collection = "VKIN";
  }

  const tokenId = normalizeTokenId(id);

  const mapped = mapping?.[collection]?.[tokenId];

  const imageFile =
    mapped?.image_file ??
    `${tokenId}.${COLLECTION_IMAGE_FORMATS[collection] || "png"}`;

  return {
    collection,
    tokenId,
    imageFile,
  };
});
  }

  if (!tokens.length) return null;

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
      {tokens.map((token, i) => {
        const { collection, tokenId, imageFile } = token;

        const src = `${BACKEND_URL}/images/${collection}/${imageFile}`;

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