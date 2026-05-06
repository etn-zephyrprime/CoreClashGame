import { ethers } from "ethers";
import GameABI from "../src/abis/GameABI.json" with { type: "json" };
import VKINABI from "../src/abis/VKINABI.json" with { type: "json" };
import VQLEABI from "../src/abis/VQLEABI.json" with { type: "json" };
import SCIONSABI from "../src/abis/SCIONSABI.json" with { type: "json" };
import EVGABI from "../src/abis/SCIONSABI.json" with { type: "json" };
import {
  GAME_ADDRESS,
  RPC_URL,
  VKIN_CONTRACT_ADDRESS,
  VQLE_CONTRACT_ADDRESS,
  SCIONS_CONTRACT_ADDRESS,
  EVG_CONTRACT_ADDRESS
} from "./config.js";
import { loadLastBlock, saveLastBlock } from "./utils/blockState.js";
import { readOwnerCache, writeOwnerCache } from "./utils/ownerCache.js";
import { reconcileActiveGamesScheduled } from "./reconcile.js";
import { fetchOwnedTokenIds } from "./utils/nftUtils.js";
import { readGames, writeGames } from "./store/gamesStore.js";
import { readBurnTotal, writeBurnTotal } from "./store/burnStore.js";

const provider = new ethers.JsonRpcProvider(RPC_URL);
const gameContract = new ethers.Contract(GAME_ADDRESS, GameABI, provider);
const vkinContract = new ethers.Contract(VKIN_CONTRACT_ADDRESS, VKINABI, provider);
const vqleContract = new ethers.Contract(VQLE_CONTRACT_ADDRESS, VQLEABI, provider);
const scionsContract = new ethers.Contract(SCIONS_CONTRACT_ADDRESS, SCIONSABI, provider);
const evgContract = new ethers.Contract(EVG_CONTRACT_ADDRESS, EVGABI, provider);

const POLL_INTERVAL_MS = 6000;
const MAX_BLOCK_RANGE = 500; // safe range for RPC
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const EVENT_LISTENER_BLOCK_KEY = "event_listener";

const gameInterface = new ethers.Interface(GameABI);
const GAME_CREATED_TOPIC = gameInterface.getEvent("GameCreated").topic;
const GAME_JOINED_TOPIC = gameInterface.getEvent("GameJoined").topic;
const GAME_SETTLED_TOPIC = gameInterface.getEvent("GameSettled").topic;

console.log("📡 CoreClash event indexer starting…");

let savedBlock = Number(loadLastBlock(EVENT_LISTENER_BLOCK_KEY));

let lastBlock = Number.isFinite(savedBlock) && savedBlock > 0
  ? savedBlock
  : ((await provider.getBlockNumber()) - 500);
  
  console.log("▶ Starting from block", lastBlock);

async function handleGameCreated(id) {
  const games = readGames();
  if (games.find(g => g.id === id)) return; // already exists

  const onChain = await gameContract.games(id);
  games.push({
    id,
    player1: onChain.player1,
    player2: onChain.player2,
    stakeAmount: onChain.stakeAmount.toString(),
    stakeToken: onChain.stakeToken,
    settled: onChain.settled,
    winner: ethers.ZeroAddress.toLowerCase(),
    cancelled: false,
  });

  writeGames(games);
  console.log(`[EVENT] GameCreated #${id} added to games.json`);
}

/**
 * Auto-update owner cache for a wallet
 */
async function updateMultipleWalletCaches(wallets, collection) {
  const uniqueWallets = [
    ...new Set(wallets.filter(Boolean).map((w) => w.toLowerCase())),
  ];

  if (uniqueWallets.length === 0) return;

  if (!["VKIN", "VQLE", "SCIONS", "EVG"].includes(collection)) {
    console.error(`[AUTO-CACHE] Unknown collection for refresh: ${collection}`);
    return;
  }

  console.log(
    `[AUTO-CACHE] Updating ${collection} cache for ${uniqueWallets.length} wallet(s): ${uniqueWallets.join(", ")}`
  );

  const cache = readOwnerCache();

  const contractMap = {
    VKIN: vkinContract,
    VQLE: vqleContract,
    SCIONS: scionsContract,
    EVG: evgContract,
  };

  const contractInstance = contractMap[collection];

  for (const wallet of uniqueWallets) {
    try {
      const existing = cache[wallet] || { VKIN: [], VQLE: [], SCIONS: [], EVG: [] };

      const refreshedTokenIds = await fetchOwnedTokenIds(
        contractInstance,
        wallet,
        collection
      );

      cache[wallet] = {
        ...existing,
        [collection]: refreshedTokenIds,
      };

      console.log(
        `[AUTO-CACHE] Prepared ${wallet}: ${collection}=${refreshedTokenIds.length}`
      );
    } catch (err) {
      console.error(
        `[AUTO-CACHE] Failed preparing ${collection} cache for ${wallet}:`,
        err.message || err
      );
    }
  }

  writeOwnerCache(cache);
  console.log(`[AUTO-CACHE] Batch ${collection} cache write complete`);
}

// ── POLLING LOOP ──
let isCatchingUp = true; // startup flag
setInterval(async () => {
  try {
    const currentBlock = await provider.getBlockNumber();
    if (currentBlock <= lastBlock) return;

    let fromBlock = lastBlock + 1;

    while (fromBlock <= currentBlock) {
      const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE - 1, currentBlock);
      console.log(`🔍 Fetching logs ${fromBlock} → ${toBlock}`);

      // ----- GameCreated events -----
      const createdLogs = await provider.getLogs({
        address: GAME_ADDRESS,
        topics: [GAME_CREATED_TOPIC],
        fromBlock,
        toBlock,
      });

      if (createdLogs.length > 0) {
        console.log(`🆕 ${createdLogs.length} GameCreated event(s)`);
        await reconcileActiveGamesScheduled(); // authoritative sync
      }

      for (const log of createdLogs) {
        const parsed = gameInterface.parseLog(log);
      await handleGameCreated(Number(parsed.args.gameId));
      }

      // ----- GameJoined events -----
      const joinedLogs = await provider.getLogs({
        address: GAME_ADDRESS,
        topics: [GAME_JOINED_TOPIC],
        fromBlock,
        toBlock,
      });

      if (joinedLogs.length > 0) {
        console.log(`🆕 ${joinedLogs.length} GameJoined event(s)`);
        await reconcileActiveGamesScheduled();
      }
      
// ----- GameSettled events -----
const settledLogs = await provider.getLogs({
  address: GAME_ADDRESS,
  topics: [GAME_SETTLED_TOPIC],
  fromBlock,
  toBlock,
});

for (const log of settledLogs) {
  const parsed = gameInterface.parseLog(log);
  const gameId = Number(parsed.args.gameId);

  console.log(`🔥 GameSettled #${gameId}`);

  const onChain = await gameContract.games(gameId);

  if (!onChain.settled || onChain.stakeAmount == 0n) continue;

  const games = readGames();
  const game = games.find(g => g.id === gameId);
  if (!game) continue;

  // 🛑 Prevent double counting
  if (game.burnRecorded) continue;

  const stake = onChain.stakeAmount;
  const pot = stake * 2n;
  const burn = pot / 100n; // 1%

  // 🔥 Update running total
// Only add burn if game is not cancelled
if (!game.cancelled) {
  let totalBurn = readBurnTotal();
  totalBurn += burn;
  writeBurnTotal(totalBurn);

  console.log(
    `🔥 Burn added: ${ethers.formatEther(burn)} CORE | Total: ${ethers.formatEther(totalBurn)}`
  );
} else {
  console.log(`Game ${game.id} cancelled — skipping burn update`);
}

// Mark game as processed regardless
game.settled = true;
game.burnRecorded = true;
game.burnWei = burn.toString();
writeGames(games);
}

      // ----- NFT transfer logs (VKIN & VQLE) -----
      const getTransferLogs = async (address) =>
        provider.getLogs({ address, topics: [TRANSFER_TOPIC], fromBlock, toBlock });

      const zero = ethers.ZeroAddress.toLowerCase();
      const vkinLogs = await getTransferLogs(VKIN_CONTRACT_ADDRESS);
      const vqleLogs = await getTransferLogs(VQLE_CONTRACT_ADDRESS);
      const scionsLogs = await getTransferLogs(SCIONS_CONTRACT_ADDRESS);
      const evgLogs = await getTransferLogs(EVG_CONTRACT_ADDRESS);

const processLogs = async (logs, contractName, contractInstance) => {
  const affectedWallets = new Set();
  const zero = ethers.ZeroAddress.toLowerCase();

  for (const log of logs) {
    try {
      const parsed = contractInstance.interface.parseLog(log);
      const from = parsed.args.from ? String(parsed.args.from).toLowerCase() : null;
      const to = parsed.args.to ? String(parsed.args.to).toLowerCase() : null;
      const tokenId = parsed.args.tokenId ? parsed.args.tokenId.toString() : "unknown";

      console.log(
        `📦 ${contractName.toUpperCase()} Transfer detected: ${from} -> ${to}, token ${tokenId}`
      );

      if (from && from !== zero) {
        affectedWallets.add(from);
      }

      if (to && to !== zero) {
        affectedWallets.add(to);
      }
    } catch (err) {
      console.warn(`⚠️ Failed to parse ${contractName.toUpperCase()} log:`, err);
    }
  }

  if (affectedWallets.size > 0) {
    const walletList = [...affectedWallets];
    const collection = contractName.toUpperCase();

    console.log(
      `♻️ ${collection} refreshing ${walletList.length} wallet(s): ${walletList.join(", ")}`
    );

    await updateMultipleWalletCaches(walletList, collection);
  }
};

      await processLogs(vkinLogs, "vkin", vkinContract);
      await processLogs(vqleLogs, "vqle", vqleContract);
      await processLogs(scionsLogs, "scions", scionsContract);
      await processLogs(evgLogs, "evg", evgContract);

      lastBlock = toBlock;
      saveLastBlock(EVENT_LISTENER_BLOCK_KEY, lastBlock);
      fromBlock = toBlock + 1;

if (isCatchingUp && toBlock === currentBlock) {
  isCatchingUp = false;
  console.log("✅ Event indexer caught up to latest block");
}

      await new Promise((r) => setTimeout(r, 200));
    }
  } catch (err) {
    console.error("❌ Event poll error:", err.message);
  }

}, POLL_INTERVAL_MS);

export { isCatchingUp };