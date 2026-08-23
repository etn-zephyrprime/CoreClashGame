// backend/swapListener.js
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { RPC_URL } from "./config.js";
import { TRACKED_TOKENS, TOKEN_SYMBOL_MAP  } from "./swapsConfig.js";
import { sendZephyrosCoreSwapMessage } from "./utils/telegramBot.js"; //sendSwapMessage,
import { buildPriceEngine } from "./utils/priceEngine.js";
import { BASE_DATA_DIR } from "./utils/dataDir.js";
import { queueR2Upload } from "./utils/r2Sync.js";
const POLL_INTERVAL_MS = 60000;
const MAX_BLOCK_RANGE = 500;
const REORG_BUFFER_BLOCKS = 2;

const ERC20_MIN_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

const UNIV2_PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)"
];

const UNIV3_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)"
];

const ERC20_TRANSFER_IFACE = new ethers.Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)"
]);

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

function getActualTaxedTokenAmountFromReceipt({
  receipt,
  tokenAddress,
  trader,
  side,
}) {
  const tokenLc = tokenAddress.toLowerCase();
  const traderLc = trader.toLowerCase();

  let actual = 0n;

  for (const log of receipt.logs || []) {
    if (String(log.address).toLowerCase() !== tokenLc) continue;
    if (log.topics?.[0] !== TRANSFER_TOPIC) continue;

    try {
      const parsed = ERC20_TRANSFER_IFACE.parseLog(log);
      const from = String(parsed.args.from).toLowerCase();
      const to = String(parsed.args.to).toLowerCase();
      const value = BigInt(parsed.args.value);

      // BUY: actual amount received by buyer after tax
      if (side === "BUY" && to === traderLc) {
        actual += value;
      }

      // SELL: actual amount sent by seller into pair/router
      if (side === "SELL" && from === traderLc) {
        actual += value;
      }
    } catch {
      // ignore unrelated/bad logs
    }
  }

  return actual > 0n ? actual : null;
}

function shortAddr(address) {
  if (!address) return "Unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUnitsSafe(value, decimals) {
  try {
    const num = Number(ethers.formatUnits(value, decimals));
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  } catch {
    return value.toString();
  }
}

async function safeRead(contract, method, fallback) {
  try {
    return await contract[method]();
  } catch {
    return fallback;
  }
}

function getPoolAbi(dex) {
  if (dex === "UNIV2") return UNIV2_PAIR_ABI;
  if (dex === "ELECTROV3") return UNIV3_POOL_ABI;
  throw new Error(`Unsupported dex type: ${dex}`);
}

function getPoolInterface(dex) {
  return new ethers.Interface(getPoolAbi(dex));
}

function knownSymbol(address, fallback) {
  const key = address?.toLowerCase();
  return TOKEN_SYMBOL_MAP[key] || fallback || shortAddr(address);
}

function isPreferredQuote(symbol) {
  return ["WETN", "ETN", "USDT", "USDC"].includes(String(symbol).toUpperCase());
}

function getAggregateKey(txHash, tokenAddress, side) {
  return `${txHash}:${tokenAddress.toLowerCase()}:${side}`;
}

function addToAggregate(map, key, fragment) {
  const existing = map.get(key);

  if (!existing) {
    map.set(key, {
      ...fragment,
      preferredQuoteSymbol: fragment.quoteSymbol,
      preferredQuoteAmountRaw: fragment.quoteAmountRaw,
      preferredQuoteDecimals: fragment.quoteDecimals,
    });
    return;
  }

  existing.baseAmountRaw += fragment.baseAmountRaw;
  existing.quoteAmountRaw += fragment.quoteAmountRaw;

  if (fragment.usdValue != null) {
    existing.usdValue = (existing.usdValue || 0) + fragment.usdValue;
  }

  if (existing.quoteSymbol !== fragment.quoteSymbol) {
    existing.quoteSymbol = "MULTI";
  }

// Keep accumulating the originally preferred quote token for display.
  if (fragment.quoteSymbol === existing.preferredQuoteSymbol) {
    existing.preferredQuoteAmountRaw += fragment.quoteAmountRaw;
  }
}

async function callWithRetry(fn, label, retries = 3, delayMs = 10000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err?.info?.error?.message || err?.message || "";
      const isRateLimit =
        msg.includes("Too many requests") ||
        msg.includes("rate limit") ||
        msg.includes("-32090");

      if (!isRateLimit || attempt === retries) {
        throw err;
      }

      console.warn(
        `[SwapListener] ${label} rate-limited, retrying in ${delayMs / 1000}s (attempt ${attempt}/${retries})`
      );

      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function buildRuntimePoolMap(provider) {
  const poolMap = new Map();
  const allWatchedPoolAddresses = new Set();

  for (const tracked of TRACKED_TOKENS) {
    if (!tracked?.address) {
      console.warn(`[SwapListener] Skipping token with missing address: ${tracked?.symbol || "UNKNOWN"}`);
      continue;
    }

    const trackedTokenAddress = ethers.getAddress(tracked.address);
    const trackedFallbackSymbol = tracked.symbol || shortAddr(trackedTokenAddress);

    for (const poolCfg of tracked.pools || []) {
      if (!poolCfg?.address || !poolCfg?.dex) {
        console.warn(`[SwapListener] Skipping invalid pool config for ${trackedFallbackSymbol}`);
        continue;
      }

      const poolAddress = ethers.getAddress(poolCfg.address);
      const abi = getPoolAbi(poolCfg.dex);
      const iface = new ethers.Interface(abi);
      const pool = new ethers.Contract(poolAddress, abi, provider);

      let token0;
      let token1;

      try {
[token0, token1] = await Promise.all([
  callWithRetry(() => pool.token0(), `token0() for ${poolAddress}`),
  callWithRetry(() => pool.token1(), `token1() for ${poolAddress}`),
]);
        token0 = ethers.getAddress(token0);
        token1 = ethers.getAddress(token1);
      } catch (err) {
        const msg = err?.info?.error?.message || err?.message || "";

        if (msg.includes("Too many requests") || msg.includes("rate limit")) {
          console.warn(
            `[SwapListener] Rate-limited while loading token0/token1 for pool ${poolAddress}.`
          );
        } else {
          console.error(
            `[SwapListener] Failed loading token0/token1 for pool ${poolAddress}:`,
            err
          );
        }

        continue;
      }

if (trackedTokenAddress !== token0 && trackedTokenAddress !== token1) {
  console.warn(
    `[SwapListener] Token ${trackedFallbackSymbol} (${trackedTokenAddress}) is not in pool ${poolAddress}. token0=${token0}, token1=${token1}`
  );
  continue;
}

const baseTokenAddress = trackedTokenAddress;
const quoteTokenAddress = baseTokenAddress === token0 ? token1 : token0;

      const baseTokenContract = new ethers.Contract(baseTokenAddress, ERC20_MIN_ABI, provider);
      const quoteTokenContract = new ethers.Contract(quoteTokenAddress, ERC20_MIN_ABI, provider);

const [baseSymbol, baseDecimals, quoteSymbol, quoteDecimals] = await Promise.all([
  safeRead(baseTokenContract, "symbol", trackedFallbackSymbol),
  safeRead(baseTokenContract, "decimals", 18),
  safeRead(quoteTokenContract, "symbol", shortAddr(quoteTokenAddress)),
  safeRead(quoteTokenContract, "decimals", 18),
]);

const displayQuoteSymbol = knownSymbol(
  quoteTokenAddress,
  quoteSymbol || shortAddr(quoteTokenAddress)
);

      const existing = poolMap.get(poolAddress.toLowerCase()) || {
        poolAddress,
        dex: poolCfg.dex,
        iface,
        pool,
        token0,
        token1,
        trackedTokens: [],
      };

existing.trackedTokens.push({
  symbol: baseSymbol || trackedFallbackSymbol,
  address: baseTokenAddress,
  decimals: Number(baseDecimals),
  quoteSymbol: displayQuoteSymbol,
  quoteAddress: quoteTokenAddress,
  quoteDecimals: Number(quoteDecimals),
  trackedIsToken0: baseTokenAddress.toLowerCase() === token0.toLowerCase(),
  imageFileId: tracked.imageFileId || null,
  image: tracked.image || null,
  animationUrl: tracked.animationUrl || null,
  animationFileId: tracked.animationFileId || null,
  zephyrosAnimationFileId:
  tracked.zephyrosAnimationFileId || null,
});

      poolMap.set(poolAddress.toLowerCase(), existing);
      allWatchedPoolAddresses.add(poolAddress);

console.log(
  `[SwapListener] Registered ${baseSymbol}/${displayQuoteSymbol} on ${poolCfg.dex} pool ${poolAddress}`
);
    }
  }

  return {
    poolMap,
    watchedPoolAddresses: [...allWatchedPoolAddresses],
  };
}

function decodeUniv2Swap(parsedArgs, trackedMeta) {
  const { sender, to, amount0In, amount1In, amount0Out, amount1Out } = parsedArgs;

  const trackedIn = trackedMeta.trackedIsToken0 ? BigInt(amount0In) : BigInt(amount1In);
  const trackedOut = trackedMeta.trackedIsToken0 ? BigInt(amount0Out) : BigInt(amount1Out);
  const quoteIn = trackedMeta.trackedIsToken0 ? BigInt(amount1In) : BigInt(amount0In);
  const quoteOut = trackedMeta.trackedIsToken0 ? BigInt(amount1Out) : BigInt(amount0Out);

  if (trackedOut > 0n) {
    return {
      side: "BUY",
      trader: to,
      baseAmountRaw: trackedOut,
      quoteAmountRaw: quoteIn,
    };
  }

  if (trackedIn > 0n) {
    return {
      side: "SELL",
      trader: sender,
      baseAmountRaw: trackedIn,
      quoteAmountRaw: quoteOut,
    };
  }

  return null;
}

function decodeV3Swap(parsedArgs, trackedMeta) {
  const { sender, recipient, amount0, amount1 } = parsedArgs;

  const amt0 = BigInt(amount0);
  const amt1 = BigInt(amount1);

  const trackedDelta = trackedMeta.trackedIsToken0 ? amt0 : amt1;
  const quoteDelta = trackedMeta.trackedIsToken0 ? amt1 : amt0;

  // V3 convention:
  // positive = sent into pool
  // negative = sent out of pool
  if (trackedDelta < 0n) {
    return {
      side: "BUY",
      trader: recipient,
      baseAmountRaw: -trackedDelta,
      quoteAmountRaw: quoteDelta > 0n ? quoteDelta : 0n,
    };
  }

  if (trackedDelta > 0n) {
    return {
      side: "SELL",
      trader: sender,
      baseAmountRaw: trackedDelta,
      quoteAmountRaw: quoteDelta < 0n ? -quoteDelta : 0n,
    };
  }

  return null;
}

function decodeSwap(parsed, poolMeta, trackedMeta) {
  if (poolMeta.dex === "UNIV2") {
    return decodeUniv2Swap(parsed.args, trackedMeta);
  }

  if (poolMeta.dex === "ELECTROV3") {
    return decodeV3Swap(parsed.args, trackedMeta);
  }

  return null;
}

let started = false;

const STATE_DIR = path.join(BASE_DATA_DIR, "state");
const SWAP_STATE_FILE = path.join(STATE_DIR, "lastSwapBlock.json");

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function loadLastSwapBlock() {
  try {
    if (!fs.existsSync(SWAP_STATE_FILE)) return null;

    const raw = fs.readFileSync(SWAP_STATE_FILE, "utf8");
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed?.lastBlock ?? null;
  } catch (err) {
    console.error("[SwapListener] loadLastSwapBlock error:", err);
    return null;
  }
}

function saveLastSwapBlock(block) {
  try {
    ensureStateDir();

    const tempFile = `${SWAP_STATE_FILE}.tmp`;
    fs.writeFileSync(
      tempFile,
      JSON.stringify({ lastBlock: block }, null, 2),
      "utf8"
    );
    fs.renameSync(tempFile, SWAP_STATE_FILE);
    queueR2Upload(SWAP_STATE_FILE);
  } catch (err) {
    console.error("[SwapListener] saveLastSwapBlock error:", err);
    throw err;
  }
}

export async function startSwapListener() {
  if (started) return;
  started = true;

  const provider = new ethers.JsonRpcProvider(RPC_URL);

let priceEngine;
try {
  priceEngine = await buildPriceEngine(provider, TRACKED_TOKENS);
} catch (err) {
  console.error("[SwapListener] Failed to initialize price engine:", err);
  throw err;
}

let lastPriceRefreshMs = 0;
const PRICE_REFRESH_MS = 300000; // 5 minutes

  let runtime;
try {
  runtime = await buildRuntimePoolMap(provider);
} catch (err) {
  console.error("[SwapListener] Failed during startup:", err);
  throw err;
}
  const { poolMap, watchedPoolAddresses } = runtime;

  if (!watchedPoolAddresses.length) {
    console.warn("[SwapListener] No valid pools to watch.");
    return;
  }

let chainTip;
try {
  chainTip = await getBlockNumberWithRetry(provider);
} catch (err) {
  console.error("[SwapListener] Failed to fetch chain tip:", err);
  throw err;
}

let lastBlock = loadLastSwapBlock();
if (lastBlock == null) {
  lastBlock = Math.max(0, chainTip - MAX_BLOCK_RANGE);
  saveLastSwapBlock(lastBlock);
}

  console.log(
    `[SwapListener] Watching ${watchedPoolAddresses.length} unique pools from block ${lastBlock}`
  );

  // Initial price refresh to populate token metadata
function estimateSwapUsdValue(priceEngine, trackedMeta, swap) {
  const baseUsd = priceEngine.estimateUsdFromTokenAmount(
    trackedMeta.address,
    swap.baseAmountRaw
  );

  const quoteUsd = priceEngine.estimateUsdFromTokenAmount(
    trackedMeta.quoteAddress,
    swap.quoteAmountRaw
  );

  const validBase =
    baseUsd != null && Number.isFinite(baseUsd) && baseUsd > 0
      ? baseUsd
      : null;

  const validQuote =
    quoteUsd != null && Number.isFinite(quoteUsd) && quoteUsd > 0
      ? quoteUsd
      : null;

  if (validQuote != null) return validQuote;
  if (validBase != null) return validBase;

  return null;
}

async function getBlockNumberWithRetry(provider, retries = 3, delayMs = 10000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await provider.getBlockNumber();
    } catch (err) {
      const msg = err?.message || "";
      const isRateLimit =
        msg.includes("Too many requests") ||
        msg.includes("rate limit") ||
        msg.includes("-32090");

      if (!isRateLimit || attempt === retries) {
        throw err;
      }

      console.warn(`[SwapListener] getBlockNumber rate-limited, retrying in ${delayMs / 1000}s (attempt ${attempt}/${retries})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// Polling Loop
const v2PoolAddresses = [];
const v3PoolAddresses = [];

for (const addr of watchedPoolAddresses) {
  const meta = poolMap.get(addr.toLowerCase());
  if (!meta) continue;

  if (meta.dex === "UNIV2") v2PoolAddresses.push(addr);
  if (meta.dex === "ELECTROV3") v3PoolAddresses.push(addr);
}

const v2SwapTopic = new ethers.Interface(UNIV2_PAIR_ABI).getEvent("Swap").topicHash;
const v3SwapTopic = new ethers.Interface(UNIV3_POOL_ABI).getEvent("Swap").topicHash;

async function getLogsWithRetry(provider, filter, label, retries = 3, delayMs = 10000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await provider.getLogs(filter);
    } catch (err) {
      const msg = err?.info?.error?.message || err?.message || "";
      const isRateLimit =
        msg.includes("Too many requests") ||
        msg.includes("rate limit") ||
        msg.includes("-32090");

      if (!isRateLimit || attempt === retries) throw err;

      console.warn(
        `[SwapListener] ${label} rate-limited, retrying in ${delayMs / 1000}s (attempt ${attempt}/${retries})`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

setInterval(async () => {
  try {
    const currentBlock = await getBlockNumberWithRetry(provider);
    const safeBlock = Math.max(0, currentBlock - REORG_BUFFER_BLOCKS);

    if (safeBlock <= lastBlock) return;

    let fromBlock = lastBlock + 1;

    while (fromBlock <= safeBlock) {
      const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE - 1, safeBlock);

      console.log(`[SwapListener] Fetching logs ${fromBlock} -> ${toBlock}`);

      const aggregatedSwaps = new Map();
      const txCache = new Map();
      const groupedLogs = [];

      if (v2PoolAddresses.length) {
        const logs = await getLogsWithRetry(
          provider,
          {
            address: v2PoolAddresses,
            fromBlock,
            toBlock,
            topics: [v2SwapTopic],
          },
          "UNIV2 getLogs"
        );
        groupedLogs.push(...logs);
      }

      if (v3PoolAddresses.length) {
        const logs = await getLogsWithRetry(
          provider,
          {
            address: v3PoolAddresses,
            fromBlock,
            toBlock,
            topics: [v3SwapTopic],
          },
          "ELECTROV3 getLogs"
        );
        groupedLogs.push(...logs);
      }

      for (const log of groupedLogs) {
        const poolMeta = poolMap.get(log.address.toLowerCase());
        if (!poolMeta) continue;

        let parsed;
        try {
          parsed = poolMeta.iface.parseLog(log);
          if (!parsed) continue;
        } catch (err) {
          console.error("[SwapListener] Failed to parse log:", err);
          continue;
        }

        for (const trackedMeta of poolMeta.trackedTokens) {
          try {
            const swap = decodeSwap(parsed, poolMeta, trackedMeta);
            if (!swap || swap.baseAmountRaw <= 0n) continue;

let tx;
let receipt;

if (txCache.has(log.transactionHash)) {
  const cached = txCache.get(log.transactionHash);
  tx = cached.tx;
  receipt = cached.receipt;
} else {
  tx = await provider.getTransaction(log.transactionHash);
  receipt = await provider.getTransactionReceipt(log.transactionHash);

  txCache.set(log.transactionHash, {
    tx,
    receipt,
  });
}

const traderAddress = tx?.from || swap.trader;

let actualBaseAmountRaw = swap.baseAmountRaw;

const isCoreToken =
  String(trackedMeta.symbol || "").toUpperCase() === "CORE";

if (isCoreToken && receipt) {
  const actualTaxedAmount = getActualTaxedTokenAmountFromReceipt({
    receipt,
    tokenAddress: trackedMeta.address,
    trader: traderAddress,
    side: swap.side,
  });

  if (actualTaxedAmount != null) {
    actualBaseAmountRaw = actualTaxedAmount;
  }
}

const usdValue = estimateSwapUsdValue(priceEngine, trackedMeta, {
  ...swap,
  baseAmountRaw: actualBaseAmountRaw,
});

            const aggregateKey = getAggregateKey(
              log.transactionHash,
              trackedMeta.address,
              swap.side
            );

addToAggregate(aggregatedSwaps, aggregateKey, {
  txHash: log.transactionHash,
  logIndex: log.index ?? log.logIndex ?? 0,
  symbol: trackedMeta.symbol,
  side: swap.side,
  tokenAddress: trackedMeta.address,
  baseAmountRaw: actualBaseAmountRaw,
  baseDecimals: trackedMeta.decimals,
  quoteAmountRaw: swap.quoteAmountRaw,
  quoteDecimals: trackedMeta.quoteDecimals,
  quoteSymbol: trackedMeta.quoteSymbol,
  trader: traderAddress,
  usdValue: usdValue ?? null,
  imageFileId: trackedMeta.imageFileId || null,
  image: trackedMeta.image || null,
  animationUrl: trackedMeta.animationUrl || null,
  animationFileId: trackedMeta.animationFileId || null,
  zephyrosAnimationFileId: trackedMeta.zephyrosAnimationFileId || null,
});
          } catch (err) {
            console.error("[SwapListener] Failed processing tracked token swap:", err);
          }
        }
      }

const swapsToSend = [...aggregatedSwaps.values()];

const byTx = new Map();

for (const swap of swapsToSend) {
  const list = byTx.get(swap.txHash) || [];
  list.push(swap);
  byTx.set(swap.txHash, list);
}

const dedupedSwaps = [];

for (const swaps of byTx.values()) {
  if (swaps.length === 1) {
    dedupedSwaps.push(swaps[0]);
    continue;
  }

  swaps.sort((a, b) => {
    const aPreferred = a.side === "BUY" && isPreferredQuote(a.preferredQuoteSymbol || a.quoteSymbol);
    const bPreferred = b.side === "BUY" && isPreferredQuote(b.preferredQuoteSymbol || b.quoteSymbol);

    if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;

    const aUsd = a.usdValue || 0;
    const bUsd = b.usdValue || 0;
    if (aUsd !== bUsd) return bUsd - aUsd;

    return (a.logIndex || 0) - (b.logIndex || 0);
  });

  dedupedSwaps.push(swaps[0]);
}

for (const aggregated of dedupedSwaps) {
          try {
          if (aggregated.baseAmountRaw <= 0n) continue;

          const baseAmount = formatUnitsSafe(
            aggregated.baseAmountRaw,
            aggregated.baseDecimals
          );

          let finalUsdValue = aggregated.usdValue ?? null;
          if ((finalUsdValue == null || finalUsdValue < 8) && aggregated.tokenAddress) {
            const tokenPrice = priceEngine.getTokenUsd(aggregated.tokenAddress);
            if (tokenPrice != null && Number.isFinite(tokenPrice)) {
              finalUsdValue =
                Number(ethers.formatUnits(aggregated.baseAmountRaw, aggregated.baseDecimals)) *
                tokenPrice;
            }
          }

          if (finalUsdValue == null) continue;

          const isSell = aggregated.side === "SELL";
          const minUsdThreshold = isSell ? 250 : 20;

          let quoteAmountStr = "-";
          let displayQuoteSymbol =
            aggregated.quoteSymbol === "MULTI" ? "multi-hop" : aggregated.quoteSymbol;

          if (
            aggregated.preferredQuoteSymbol &&
            aggregated.preferredQuoteAmountRaw > 0n
          ) {
            quoteAmountStr = formatUnitsSafe(
              aggregated.preferredQuoteAmountRaw,
              aggregated.preferredQuoteDecimals
            );
            displayQuoteSymbol = aggregated.preferredQuoteSymbol;
          } else if (aggregated.quoteAmountRaw > 0n) {
            quoteAmountStr = formatUnitsSafe(
              aggregated.quoteAmountRaw,
              aggregated.quoteDecimals
            );
          }

          const tokenPriceUsd = priceEngine.getTokenUsd(aggregated.tokenAddress) || null;

// Determine if this swap should be sent to the main Zephyros general channel
const isCore =
  String(aggregated.symbol || "").toUpperCase() === "CORE";

const shouldSendToZephyrosGeneral =
  isCore &&
  (
    (aggregated.side === "BUY" &&
      finalUsdValue > 5 &&
      finalUsdValue < 50) ||

    (aggregated.side === "SELL" &&
      finalUsdValue > 20)
  );

if (shouldSendToZephyrosGeneral) {
  await sendZephyrosCoreSwapMessage({
    side: isSell ? "SELL" : "BUY",
    baseAmount,
    quoteAmount: quoteAmountStr,
    quoteSymbol: displayQuoteSymbol,
    trader: aggregated.trader,
    txHash: aggregated.txHash,
    usdValue: finalUsdValue,
    tokenPriceUsd,
    animationFileId: isSell
      ? null
      : (
    aggregated.zephyrosAnimationFileId ||
    aggregated.animationFileId
    ),
    animationUrl: isSell ? null : aggregated.animationUrl,
  });
}

// ✅ ALWAYS send to "all swaps" group
// 🔴 Small swaps → ALL_SWAPS
//if (finalUsdValue < minUsdThreshold) { COMMENT THIS IN TO FILTER SMALL SWAPS IN ENTIRELY
  await sendSwapMessage({
    symbol: aggregated.symbol,
    side: isSell ? "SELL" : "BUY",
    baseAmount,
    quoteAmount: quoteAmountStr,
    quoteSymbol: displayQuoteSymbol,
    trader: aggregated.trader,
    txHash: aggregated.txHash,
    usdValue: finalUsdValue,
    tokenPriceUsd,
    imageFileId: aggregated.imageFileId || null,
    image: aggregated.image || null,
    animationUrl: aggregated.animationUrl || null,
    animationFileId: aggregated.animationFileId || null,
    destination: "ALL_SWAPS",
  });
//} COMMENT THIS IN TO FILTER SMALL SWAPS IN ENTIRELY

// ✅ Only send to main alerts if above threshold
if (finalUsdValue >= minUsdThreshold) {
  await sendSwapMessage({
    symbol: aggregated.symbol,
    side: isSell ? "SELL" : "BUY",
    baseAmount,
    quoteAmount: quoteAmountStr,
    quoteSymbol: displayQuoteSymbol,
    trader: aggregated.trader,
    txHash: aggregated.txHash,
    usdValue: finalUsdValue,
    tokenPriceUsd,
    imageFileId: aggregated.imageFileId || null,
    image: aggregated.image || null,
    animationUrl: aggregated.animationUrl || null,
    animationFileId: aggregated.animationFileId || null,
    destination: "MAIN_ALERTS",
  });
} else {
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[SwapListener] Routed to ALL_SWAPS → ${aggregated.symbol} ~$${finalUsdValue.toFixed(2)}`
    );
  }
}
          console.log(
            `[SwapListener] ${aggregated.symbol} ${isSell ? "SELL" : "BUY"} ${baseAmount} | $${finalUsdValue.toFixed(2)}`
          );


} catch (err) {
          console.error("[SwapListener] Failed sending swap message:", err);
        }
      }

      lastBlock = toBlock;
        saveLastSwapBlock(lastBlock);
      fromBlock = toBlock + 1;

      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  } catch (err) {
    console.error("[SwapListener] poll error:", err.message || err);
  }

  const now = Date.now();
  if (now - lastPriceRefreshMs > PRICE_REFRESH_MS) {
    try {
      await priceEngine.refreshPrices();
      lastPriceRefreshMs = now;
    } catch (err) {
      console.error("[SwapListener] Price refresh failed:", err.message || err);
    }
  }
}, POLL_INTERVAL_MS);
}