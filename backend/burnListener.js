// backend/burnListener.js
import { ethers } from "ethers";
import { CORE_TOKEN_ADDRESS, RPC_URL } from "./config.js";
import ERC20ABI from "../src/abis/ERC20ABI.json" with { type: "json" };
import fs from "fs";
import path from "path";
import { sendZephyrosBurnMessage, formatTokenAmount } from "./utils/telegramBot.js";
import { BASE_DATA_DIR } from "./utils/dataDir.js";
import { queueR2Upload } from "./utils/r2Sync.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const POLL_INTERVAL_MS = 60000; // 1 minute
const MAX_BLOCK_RANGE = 500;

const INITIAL_SUPPLY = 1_000_000;

const STATE_DIR = path.join(BASE_DATA_DIR, "state");
const BURN_STATE_FILE = path.join(STATE_DIR, "lastBurnBlock.json");

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function loadLastBurnBlock() {
  try {
    if (!fs.existsSync(BURN_STATE_FILE)) return null;
    const raw = fs.readFileSync(BURN_STATE_FILE, "utf8");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.lastBlock ?? null;
  } catch (err) {
    console.error("[BurnListener] loadLastBurnBlock error:", err);
    return null;
  }
}

function saveLastBurnBlock(block) {
  try {
    ensureStateDir();
    const tempFile = `${BURN_STATE_FILE}.tmp`;
    fs.writeFileSync(
      tempFile,
      JSON.stringify({ lastBlock: block }, null, 2),
      "utf8"
    );
    fs.renameSync(tempFile, BURN_STATE_FILE);
    queueR2Upload(BURN_STATE_FILE);
  } catch (err) {
    console.error("[BurnListener] saveLastBurnBlock error:", err);
  }
}

function topicAddress(address) {
  return ethers.zeroPadValue(address, 32).toLowerCase();
}

let started = false;

export function startCoreBurnListener() {
  if (started) return;
  started = true;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const token = new ethers.Contract(CORE_TOKEN_ADDRESS, ERC20ABI, provider);

  let decimals = 18;
  let symbol = "CORE";
  let lastBlock = null;

  (async () => {
    try {
      try {
        decimals = await token.decimals();
      } catch {}

      try {
        symbol = await token.symbol();
      } catch {}

      const currentBlock = await provider.getBlockNumber();
      lastBlock = loadLastBurnBlock() ?? (currentBlock - MAX_BLOCK_RANGE);

      console.log(`[BurnListener] Watching ${symbol} burns from block ${lastBlock}`);
    } catch (err) {
      console.error("[BurnListener] startup error:", err);
    }
  })();

  setInterval(async () => {
    try {
      if (lastBlock == null) return;

      const currentBlock = await provider.getBlockNumber();
      if (currentBlock <= lastBlock) return;

      let fromBlock = lastBlock + 1;

      while (fromBlock <= currentBlock) {
        const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE - 1, currentBlock);

        console.log(`[BurnListener] Fetching burn logs ${fromBlock} -> ${toBlock}`);

        const logs = await provider.getLogs({
          address: CORE_TOKEN_ADDRESS,
          fromBlock,
          toBlock,
          topics: [
            TRANSFER_TOPIC,
            null,
            topicAddress(ZERO_ADDRESS),
          ],
        });

for (const log of logs) {
  try {
    const value = BigInt(log.data);

    const formatted = Number(ethers.formatUnits(value, decimals));
    const prettyAmount = formatted.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const totalSupplyRaw = await token.totalSupply();
    const totalSupplyFormatted = Number(
      ethers.formatUnits(totalSupplyRaw, decimals)
    );

    const totalBurnedRaw = INITIAL_SUPPLY - totalSupplyFormatted;
    const totalBurned = totalBurnedRaw.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const burnPercent = ((totalBurnedRaw / INITIAL_SUPPLY) * 100).toFixed(2);

    try {
      await sendZephyrosBurnMessage({
        symbol,
        burnAmount: prettyAmount,
        totalBurned,
        burnPercent,
        txHash: log.transactionHash,
      });

      console.log(
        `[BurnListener] Telegram sent for ${prettyAmount} ${symbol} burn in tx ${log.transactionHash}`
      );
    } catch (tgErr) {
      console.error("[BurnListener] Telegram send failed:", tgErr.message || tgErr);
    }
  } catch (logErr) {
    console.error("[BurnListener] Failed to process burn log:", logErr);
  }
}

        lastBlock = toBlock;
        saveLastBurnBlock(lastBlock);
        fromBlock = toBlock + 1;

        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      console.error("[BurnListener] poll error:", err.message || err);
    }
  }, POLL_INTERVAL_MS);
}