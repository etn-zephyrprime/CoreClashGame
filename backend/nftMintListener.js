import { ethers } from "ethers";
import { RPC_URL } from "./config.js";
import { NFT_COLLECTIONS, NFT_COLLECTION_MAP } from "./nftConfig.js";
import { loadLastBlockLocked, saveLastBlockLocked } from "./utils/blockState.js";
import { sendTelegramNftMint } from "./utils/telegramBot.js";
import { resolveExistingNftImage } from "./utils/nftMedia.js";
import { generateMapping } from "./utils/generateMapping.js";

const provider = new ethers.JsonRpcProvider(RPC_URL);

const POLL_INTERVAL_MS = 60000;
const MAX_BLOCK_RANGE = 500;
const REORG_BUFFER_BLOCKS = 2;

const processingMintLogs = new Set();
const announcedMintLogs = new Set();

function mintLogKey(log) {
  return `${log.transactionHash}:${log.index ?? log.logIndex}`;
}

const ERC721_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
];

const ERC721_METADATA_ABI = [
  "function tokenURI(uint256 tokenId) view returns (string)"
];

const iface = new ethers.Interface(ERC721_ABI);
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForNftImage({
  contractAddress,
  tokenId,
  tokenURI,
  attempts = 4,
  delayMs = 3000,
}) {
  for (let i = 0; i < attempts; i++) {
    const image = resolveExistingNftImage({
      contractAddress,
      tokenId,
      tokenURI,
    });

    if (image.absolutePath) {
      return image;
    }

    if (i < attempts - 1) {
      await delay(delayMs);
    }
  }

  return null;
}

export async function startNftMintListener() {
  async function poll() {
    try {
const latest = await provider.getBlockNumber();
let fromBlockRaw = await loadLastBlockLocked("nft_mints");
let fromBlock = Number(fromBlockRaw);

if (!Number.isFinite(fromBlock) || fromBlock <= 0) {
  fromBlock = Math.max(0, latest - 100);
}

fromBlock = Math.max(0, fromBlock - REORG_BUFFER_BLOCKS);

const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE, latest);

if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock)) {
  throw new Error(
    `[NFT MINT] Invalid block range: fromBlock=${fromBlock} toBlock=${toBlock} raw=${fromBlockRaw}`
  );
}

      if (toBlock < fromBlock) return;

      const logs = await provider.getLogs({
        address: NFT_COLLECTIONS.map((c) => c.address),
        topics: [TRANSFER_TOPIC],
        fromBlock,
        toBlock,
      });

for (const log of logs) {
  const key = mintLogKey(log);

  if (announcedMintLogs.has(key) || processingMintLogs.has(key)) {
    continue;
  }

  processingMintLogs.add(key);

  try {
    const parsed = iface.parseLog(log);
    const from = String(parsed.args.from).toLowerCase();
    const to = String(parsed.args.to).toLowerCase();
    const tokenId = String(parsed.args.tokenId);
    const contractAddress = String(log.address).toLowerCase();

    if (from !== ethers.ZeroAddress.toLowerCase()) {
      processingMintLogs.delete(key);
      continue;
    }

    const collection = NFT_COLLECTION_MAP[contractAddress];
    if (!collection) {
      processingMintLogs.delete(key);
      continue;
    }

    let minter = to;

    try {
      const tx = await provider.getTransaction(log.transactionHash);
      if (tx?.from) {
        minter = String(tx.from).toLowerCase();
      }
    } catch (err) {
      console.warn(
        `[NFT MINT] Failed to fetch tx sender for ${log.transactionHash}:`,
        err.message || err
      );
    }

    let tokenURI = null;

    try {
      const nft = new ethers.Contract(
        contractAddress,
        ERC721_METADATA_ABI,
        provider
      );

      tokenURI = await nft.tokenURI(tokenId);
    } catch (err) {
      console.warn(
        `[NFT MINT] tokenURI lookup failed for ${contractAddress} #${tokenId}:`,
        err.message || err
      );
    }

    let image = null;

    for (let attempt = 1; attempt <= 6; attempt++) {
      await generateMapping(collection.key || collection.name);

      image = await waitForNftImage({
        contractAddress,
        tokenId,
        tokenURI,
        attempts: 1,
        delayMs: 0,
      });

      if (image?.absolutePath) {
        break;
      }

      console.warn(
        `[NFT MINT] Image not cached yet for ${collection.name} #${tokenId}, attempt ${attempt}/6`
      );

      await delay(5000);
    }

    if (!image?.absolutePath) {
      console.warn(
        `[NFT MINT] Skipping notification until image is cached for ${collection.name} #${tokenId}`
      );

      processingMintLogs.delete(key);
      continue;
    }

    await sendTelegramNftMint({
      collectionName: collection.name,
      contractAddress,
      tokenId,
      buyer: minter,
      txHash: log.transactionHash,
      tokenURI,
    });

    announcedMintLogs.add(key);
    processingMintLogs.delete(key);
  } catch (err) {
    processingMintLogs.delete(key);
    console.error("[NFT MINT] Failed to process log:", err);
  }
}

const nextBlock = Number(toBlock + 1);
if (!Number.isFinite(nextBlock)) {
  throw new Error(`[NFT MINTS] Refusing to save invalid next block: ${nextBlock}`);
}
await saveLastBlockLocked("nft_mints", nextBlock);
    } catch (err) {
      console.error("[NFT MINT] Poll failed:", err);
    }
  }

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}