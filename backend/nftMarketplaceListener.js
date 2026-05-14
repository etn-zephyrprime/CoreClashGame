import { ethers } from "ethers";
import { RPC_URL } from "./config.js";
import { NFT_COLLECTION_MAP } from "./nftConfig.js";
import { loadLastBlockLocked, saveLastBlockLocked } from "./utils/blockState.js";
import { sendTelegramNftSale } from "./utils/telegramBot.js";
import { hasSeenNftEvent, markSeenNftEvent } from "./utils/nftEventState.js";

const provider = new ethers.JsonRpcProvider(RPC_URL);

const SEAPORT_ADDRESS = "0x678748317e7fD5B7699D07e666087608B401cbFd".toLowerCase();

const POLL_INTERVAL_MS = 60000;
const MAX_BLOCK_RANGE = 100;
const REORG_BUFFER_BLOCKS = 2;

const SEAPORT_ABI = [
  "event OrderFulfilled(bytes32 orderHash, address indexed offerer, address indexed zone, address recipient, tuple(uint8 itemType,address token,uint256 identifier,uint256 amount)[] offer, tuple(uint8 itemType,address token,uint256 identifier,uint256 amount,address recipient)[] consideration)"
];

const iface = new ethers.Interface(SEAPORT_ABI);
const ORDER_FULFILLED_TOPIC = ethers.id(
  "OrderFulfilled(bytes32,address,address,address,(uint8,address,uint256,uint256)[],(uint8,address,uint256,uint256,address)[])"
);

const ERC20_MIN_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

const ITEM_TYPE_NATIVE = 0;
const ITEM_TYPE_ERC20 = 1;
const ITEM_TYPE_ERC721 = 2;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let isPolling = false;
let rateLimitedUntil = 0;

function isRateLimitError(err) {
  const msg = JSON.stringify(err);

  return (
    err?.code === "BAD_DATA" ||
    msg.includes("Too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("call rate limit exhausted") ||
    msg.includes("-32090")
  );
}

async function rpcCall(label, fn, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt === retries) {
        throw err;
      }

      const waitMs = Math.min(10_000 * attempt, 60_000);
      rateLimitedUntil = Date.now() + waitMs;

      console.warn(
        `[RPC RATE LIMIT] ${label} failed. Retrying in ${waitMs / 1000}s...`
      );

      await delay(waitMs);
    }
  }
}

function findTrackedErc721OfferItem(items) {
  for (const item of items || []) {
    if (Number(item.itemType) !== ITEM_TYPE_ERC721) continue;

    const token = String(item.token).toLowerCase();
    if (NFT_COLLECTION_MAP[token]) {
      return {
        contractAddress: token,
        tokenId: String(item.identifier),
      };
    }
  }
  return null;
}

function findTrackedErc721ConsiderationItem(items) {
  for (const item of items || []) {
    if (Number(item.itemType) !== ITEM_TYPE_ERC721) continue;

    const token = String(item.token).toLowerCase();
    if (NFT_COLLECTION_MAP[token]) {
      return {
        contractAddress: token,
        tokenId: String(item.identifier),
        recipient: String(item.recipient).toLowerCase(),
      };
    }
  }
  return null;
}

function sumFungibleItems(items) {
  let total = 0n;
  let paymentToken = null;
  let paymentItemType = null;

  for (const item of items || []) {
    const itemType = Number(item.itemType);

    if (itemType !== ITEM_TYPE_NATIVE && itemType !== ITEM_TYPE_ERC20) continue;

    total += BigInt(item.amount);

    if (paymentToken == null) {
      paymentToken = String(item.token || "").toLowerCase();
      paymentItemType = itemType;
    }
  }

  return {
    amountRaw: total,
    paymentToken,
    paymentItemType,
  };
}

async function resolveCurrencyMeta(paymentToken, paymentItemType) {
  if (paymentItemType === ITEM_TYPE_NATIVE) {
    return { symbol: "ETN", decimals: 18 };
  }

  if (!paymentToken || paymentToken === ethers.ZeroAddress.toLowerCase()) {
    return { symbol: "TOKEN", decimals: 18 };
  }

  try {
    const token = new ethers.Contract(paymentToken, ERC20_MIN_ABI, provider);
const symbol = await rpcCall(`ERC20.symbol(${paymentToken})`, () =>
  token.symbol()
);

const decimals = await rpcCall(`ERC20.decimals(${paymentToken})`, () =>
  token.decimals()
);

    return {
      symbol: String(symbol),
      decimals: Number(decimals),
    };
  } catch (err) {
    console.error("[NFT MARKET] Failed to resolve token metadata:", err.message || err);
    return { symbol: "TOKEN", decimals: 18 };
  }
}

export async function startNftMarketplaceListener() {
async function poll() {
  if (isPolling) {
    console.warn("[NFT MARKET] Previous poll still running, skipping tick");
    return;
  }

  if (Date.now() < rateLimitedUntil) {
    return;
  }

  isPolling = true;

  try {
    const latest = await rpcCall("NFT MARKET getBlockNumber", () =>
      provider.getBlockNumber()
    );
      let fromBlockRaw = await loadLastBlockLocked("nft_market");
      let fromBlock = Number(fromBlockRaw);

      if (!Number.isFinite(fromBlock) || fromBlock <= 0) {
        fromBlock = Math.max(0, latest - 100);
      }

      fromBlock = Math.max(0, fromBlock - REORG_BUFFER_BLOCKS);
      const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE, latest);

      if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock)) {
        throw new Error(
          `[NFT MARKET] Invalid block range: fromBlock=${fromBlock} toBlock=${toBlock} raw=${fromBlockRaw}`
        );
      }

      if (toBlock < fromBlock) return;

const logs = await rpcCall("NFT MARKET getLogs", () =>
  provider.getLogs({
    address: SEAPORT_ADDRESS,
    topics: [ORDER_FULFILLED_TOPIC],
    fromBlock,
    toBlock,
  })
);

      for (const log of logs) {
        try {
          const parsed = iface.parseLog(log);
          const offerer = String(parsed.args.offerer).toLowerCase();
          const recipient = String(parsed.args.recipient).toLowerCase();

          const nftInOffer = findTrackedErc721OfferItem(parsed.args.offer);
          const nftInConsideration = findTrackedErc721ConsiderationItem(parsed.args.consideration);

// Case 1: standard listing fill
if (nftInOffer) {
  const eventKey = `sale:${log.transactionHash}:${log.index ?? log.logIndex ?? 0}`;

  if (await hasSeenNftEvent(eventKey)) {
    continue;
  }

  const contractAddress = nftInOffer.contractAddress;
  const collection = NFT_COLLECTION_MAP[contractAddress];
  if (!collection) continue;

  const payment = sumFungibleItems(parsed.args.consideration);
  if (payment.amountRaw <= 0n) continue;

  const { symbol, decimals } = await resolveCurrencyMeta(
    payment.paymentToken,
    payment.paymentItemType
  );

  await sendTelegramNftSale({
    collectionName: collection.name,
    contractAddress,
    tokenId: nftInOffer.tokenId,
    seller: offerer,
    buyer: recipient,
    price: ethers.formatUnits(payment.amountRaw, decimals),
    currencySymbol: symbol,
    txHash: log.transactionHash,
  });

  await markSeenNftEvent(eventKey);
  continue;
}

// Case 2: accepted bid
if (nftInConsideration) {
  const eventKey = `sale:${log.transactionHash}:${log.index ?? log.logIndex ?? 0}`;

  if (await hasSeenNftEvent(eventKey)) {
    continue;
  }

  const contractAddress = nftInConsideration.contractAddress;
  const collection = NFT_COLLECTION_MAP[contractAddress];
  if (!collection) continue;

  const payment = sumFungibleItems(parsed.args.offer);
  if (payment.amountRaw <= 0n) continue;

  const { symbol, decimals } = await resolveCurrencyMeta(
    payment.paymentToken,
    payment.paymentItemType
  );

  await sendTelegramNftSale({
    collectionName: collection.name,
    contractAddress,
    tokenId: nftInConsideration.tokenId,
    seller: recipient,
    buyer: offerer,
    price: ethers.formatUnits(payment.amountRaw, decimals),
    currencySymbol: symbol,
    txHash: log.transactionHash,
  });

  await markSeenNftEvent(eventKey);
  continue;
}
        } catch (err) {
          console.error("[NFT MARKET] Failed processing log:", err);
        }
      }

      await saveLastBlockLocked("nft_market", toBlock + 1);
} catch (err) {
  if (isRateLimitError(err)) {
    rateLimitedUntil = Date.now() + 10_000;
    console.warn("[NFT MARKET] Poll rate limited. Pausing for 10s.");
  } else {
    console.error("[NFT MARKET] Poll failed:", err);
  }
} finally {
  isPolling = false;
}
  }

await poll();

setInterval(() => {
  poll().catch((err) => {
    console.error("[NFT MARKET] Unhandled poll error:", err);
  });
}, POLL_INTERVAL_MS);
}