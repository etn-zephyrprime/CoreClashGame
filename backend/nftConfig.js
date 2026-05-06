import {
  VKIN_CONTRACT_ADDRESS,
  VQLE_CONTRACT_ADDRESS,
  SCIONS_CONTRACT_ADDRESS,
  EVG_CONTRACT_ADDRESS,
} from "./config.js";

export const NFT_COLLECTIONS = [
  {
    key: "VKIN",
    name: "Verdant Kin",
    address: VKIN_CONTRACT_ADDRESS.toLowerCase(),
  },
  {
    key: "VQLE",
    name: "Verdant Queen",
    address: VQLE_CONTRACT_ADDRESS.toLowerCase(),
  },
  {
    key: "SCIONS",
    name: "Aether Scions",
    address: SCIONS_CONTRACT_ADDRESS.toLowerCase(),
  },
  {
    key: "EVG",
    name: "Guardians of Erevos",
    address: EVG_CONTRACT_ADDRESS.toLowerCase(),
  },
];

export const NFT_COLLECTION_MAP = Object.fromEntries(
  NFT_COLLECTIONS.map((c) => [c.address, c])
);