import express from "express";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { Wallet, ethers } from "ethers";
import { fileURLToPath } from "url";
import { METADATA_JSON_DIR, REVEAL_DIR, MAPPING_FILE, loadMapping } from "../paths.js";
import { RPC_URL, BACKEND_PRIVATE_KEY, GAME_ADDRESS, 
  VKIN_CONTRACT_ADDRESS, VQLE_CONTRACT_ADDRESS, SCIONS_CONTRACT_ADDRESS, EVG_CONTRACT_ADDRESS } from "../config.js";
import GameABI from "../../src/abis/GameABI.json" with { type: "json" };
import { readGames, writeGames } from "../store/gamesStore.js";
import { resolveGame } from "../gameLogic.js";
import { fetchOwnedTokenIds } from "../utils/nftUtils.js";
import { readOwnerCache, writeOwnerCache } from "../utils/ownerCache.js";
import { reconcileActiveGamesScheduled } from "../reconcile.js";
import { broadcast } from "./sse.js";
import { adminContract, adminWalletReady } from "../admin.js";
import { withLock } from "../utils/mutex.js";
import { authWallet } from "../middleware/authWallet.js";
import VKIN_ABI from "../../src/abis/VKINABI.json" with { type: "json" };
import VQLE_ABI from "../../src/abis/VQLEABI.json" with { type: "json" };
import SCIONS_ABI from "../../src/abis/SCIONSABI.json" with { type: "json" };
import EVG_ABI from "../../src/abis/EVGABI.json" with { type: "json" };
import { readBurnTotal } from "../store/burnStore.js";
import { rebuildWeeklyLeaderboardForDate } from "../utils/weeklyLeaderboard.js";
import { awardXp, adjustXp, XP_REWARDS } from "../utils/playerXp.js";
import { sendTelegramGameCreated, sendTelegramGameJoined, sendTelegramReveal, sendTelegramBothRevealed,
         sendTelegramGameSettled, sendTelegramGameCancelled, formatTokenAmount } from "../utils/telegramBot.js";
import { gameWriteContract as contract } from "../gameContract.js";
import { deriveWinnerFromRoundResults } from "./utils/gameHelpers.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_URI_MAP = loadTokenURIMapping();

const provider = new ethers.JsonRpcProvider(RPC_URL);
const adminWallet = new ethers.Wallet(BACKEND_PRIVATE_KEY, provider);

// ---------------- HELPERS ----------------
function loadTokenURIMapping() {
  if (!fs.existsSync(MAPPING_FILE)) return {};
  const csv = fs.readFileSync(MAPPING_FILE, "utf8");
  const records = parse(csv, { columns: true, skip_empty_lines: true });
  const map = {};
  for (const r of records) map[Number(r.token_id)] = r.token_uri;
  return map;
}


// GET /games — list all games (NO CHAIN CALLS)
router.get("/", (req, res) => {
  try {
    const games = readGames();
    res.json(games);
  } catch (err) {
    console.error("GET /games error:", err);
    res.status(500).json({ error: "Failed to load games" });
  }
});

/* ------- TRACK BURNS -------- */
router.get("/burn-total", (req, res) => {
  try {
    const total = readBurnTotal();
    res.json({ totalBurnWei: total.toString() });
  } catch (err) {
    console.error("Burn route error:", err);
    res.status(500).json({ error: "Failed to read burn total" });
  }
});

// ---------------- GET SINGLE GAME ----------------
router.get("/:id", (req, res) => {
    try {
    const gameId = Number(req.params.id);
    if (!Number.isInteger(gameId)) {
      return res.status(400).json({ error: "Invalid game ID" });
    }

    const games = readGames();
    const game = games.find(g => g.id === gameId);

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    res.json(game);
  } catch (err) {
    console.error(`GET /games/${req.params.id} error:`, err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ---------- CREATE GAME ROUTE --------*/
router.post("/", async (req, res) => {
  console.log("🔥 CREATE GAME HIT", req.body);

  const { gameId, creator, stakeToken, stakeAmount } = req.body;

  // convert stake from wei to human-readable format for Telegram messages
  const prettyStake = formatTokenAmount(stakeAmount, 18, 4);

  if (!creator || !stakeToken || !stakeAmount) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  if (typeof gameId !== "number") {
    return res.status(400).json({ error: "gameId required" });
  }

  const player1Lc = creator.toLowerCase();
  let createdGamesSnapshot = null;
  let gameCreated = false;

  try {
    await withLock(async () => {
      const games = readGames();

      if (games.some((g) => g.id === gameId)) {
        res.status(409).json({ error: "Game already exists" });
        return;
      }

      games.push({
        id: gameId,
        player1: player1Lc,
        player2: null,
        stakeToken,
        stakeAmount,
        createdAt: new Date().toISOString(),
        cancelled: false,
        winner: null,
        tie: false,
        player1Reveal: null,
        player2Reveal: null,
        xp: {
            createAwarded: true,
            createAwardedAt: new Date().toISOString(),
            createXpReverted: false,
            },
      });

      writeGames(games);
      createdGamesSnapshot = games;
      gameCreated = true;

      console.log("✅ Game created:", gameId);
    });

    if (res.headersSent) return;

    if (gameCreated) {
      try {
        const updatedPlayer = await awardXp(player1Lc, XP_REWARDS.CREATE_GAME);
        console.log(
          `XP awarded: CREATE_GAME +${XP_REWARDS.CREATE_GAME} → ${player1Lc}, total XP: ${updatedPlayer.xp}`
        );
      } catch (xpErr) {
        console.error(
          `Failed to award CREATE_GAME XP for ${player1Lc}:`,
          xpErr.message || xpErr
        );
      }
    }

broadcast("GameCreated", createdGamesSnapshot);

console.log("[TG] create about to send", {
  gameId,
  creator,
  prettyStake,
  threadId: process.env.TELEGRAM_MESSAGE_THREAD_ID || null,
});

try {
  await sendTelegramGameCreated({
    gameId,
    creator,
    stakeAmount: prettyStake,
    tokenLabel: "CORE",
  });
  console.log("[TG] create sent", {
    messageId: tgResult?.message_id ?? null,
    ok: !!tgResult,
  });
} catch (tgErr) {
  console.error("[TG] create failed:", tgErr.message || tgErr);
}

    // Populate ownership cache for creator (Player 1)
    const cache = readOwnerCache();

    if (!cache[player1Lc]) {
      console.log(`Populating initial ownership cache for creator ${player1Lc}`);

      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const vkin = new ethers.Contract(VKIN_CONTRACT_ADDRESS, VKIN_ABI, provider);
        const vqle = new ethers.Contract(VQLE_CONTRACT_ADDRESS, VQLE_ABI, provider);
        const scions = new ethers.Contract(SCIONS_CONTRACT_ADDRESS, SCIONS_ABI, provider);
        const evg = new ethers.Contract(EVG_CONTRACT_ADDRESS, EVG_ABI, provider);

        console.log("Fetching VKIN tokens...");
        const vkinIds = await fetchOwnedTokenIds(vkin, player1Lc, "VKIN");

        console.log("Fetching VQLE tokens...");
        const vqleIds = await fetchOwnedTokenIds(vqle, player1Lc, "VQLE");

        console.log("Fetching SCIONS tokens...");
        const scionsIds = await fetchOwnedTokenIds(scions, player1Lc, "SCIONS");

        console.log("Fetching EVG tokens...");
        const evgIds = await fetchOwnedTokenIds(evg, player1Lc, "EVG");

        const freshCache = readOwnerCache();

        if (!freshCache[player1Lc]) {
          freshCache[player1Lc] = {
            VKIN: vkinIds,
            VQLE: vqleIds,
            SCIONS: scionsIds,
            EVG: evgIds,
          };

          writeOwnerCache(freshCache);
          console.log(
            `Cache populated for ${player1Lc}: ${vkinIds.length} VKIN, ${vqleIds.length} VQLE, ${scionsIds.length} SCIONS, ${evgIds.length} EVG`
          );
        } else {
          console.log(`Owner cache already exists for ${player1Lc}, skipping write`);
        }
      } catch (err) {
        console.error("Failed to populate creator cache:", err.message, err.stack);
      }
    }

    return res.json({ success: true, gameId });
  } catch (err) {
    console.error("CREATE GAME error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ---------------- JOIN GAME ----------------
router.post("/:id/join", async (req, res) => {
  console.log("🔥 JOIN GAME HIT", req.params, req.body);

  const gameId = Number(req.params.id);
  const { player2 } = req.body;

  if (!Number.isInteger(gameId) || !player2) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const player2Lc = player2.toLowerCase();
  let gamesSnapshot = null;
  let gameJoined = false;

  if (player2Lc === ethers.ZeroAddress.toLowerCase()) {
    return res.status(400).json({ error: "Zero address not allowed" });
  }

  try {
    await withLock(async () => {
      const games = readGames();
      const game = games.find(g => g.id === gameId);

      if (!game) {
        res.status(404).json({ error: "Game not found" });
        return;
      }

      if (game.player2) {
        res.status(409).json({ error: "Game already joined" });
        return;
      }

      if (game.player1 === player2Lc) {
        res.status(403).json({ error: "Creator cannot join own game" });
        return;
      }

      game.player2 = player2Lc;
      game.player2JoinedAt = new Date().toISOString();

      writeGames(games);
      gamesSnapshot = games;
      gameJoined = true;

      console.log("✅ Game joined:", gameId);
    });

    if (res.headersSent) return;

    if (gameJoined) {
      try {
        const updatedPlayer = await awardXp(player2Lc, XP_REWARDS.JOIN_GAME);
        console.log(
          `XP awarded: JOIN_GAME +${XP_REWARDS.JOIN_GAME} → ${player2Lc}, total XP: ${updatedPlayer.xp}`
        );
      } catch (xpErr) {
        console.error(
          `Failed to award JOIN_GAME XP for ${player2Lc}:`,
          xpErr.message || xpErr
        );
      }
    }

broadcast("GameJoined", gamesSnapshot);

try {
  await sendTelegramGameJoined({
    gameId: numericGameId,
    player1: game.player1,
    player2: gameOnChain.player2,
  });
} catch (tgErr) {
  console.error("Telegram GameJoined notification failed:", tgErr.message || tgErr);
}

    return res.json({ success: true });
  } catch (err) {
    console.error("JOIN GAME error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ---------------- REVEAL ----------------
router.post("/:id/reveal", authWallet, async (req, res) => {
  try {
    const gameId = Number(req.params.id);
    const { player, salt, nftContracts, tokenIds } = req.body;

    if (!Number.isInteger(gameId)) {
      return res.status(400).json({ error: "Invalid game ID" });
    }

    if (!req.wallet) {
      return res.status(401).json({ error: "Wallet not authenticated" });
    }

    if (!salt || !Array.isArray(nftContracts) || !Array.isArray(tokenIds)) {
      return res.status(400).json({ error: "Missing reveal data" });
    }

    if (nftContracts.length !== tokenIds.length) {
      return res.status(400).json({ error: "nftContracts and tokenIds length mismatch" });
    }

    const walletLc = req.wallet.toLowerCase();

    if (player && player.toLowerCase() !== walletLc) {
      return res.status(400).json({ error: "Reveal file player mismatch" });
    }

    // Read once for participant validation before expensive work
    const initialGames = readGames();
    const initialGame = initialGames.find((g) => g.id === gameId);

    if (!initialGame) {
      return res.status(404).json({ error: "Game not found" });
    }

    const p1 = initialGame.player1?.toLowerCase();
    const p2 = initialGame.player2?.toLowerCase();

    let slot;
    if (walletLc === p1) slot = "player1";
    else if (walletLc === p2) slot = "player2";
    else return res.status(403).json({ error: "Not a game participant" });

    // ---- Check on-chain first ----
    const onChainGame = await contract.games(gameId);
    const alreadyRevealedOnChain =
      (slot === "player1" && onChainGame.player1Revealed) ||
      (slot === "player2" && onChainGame.player2Revealed);

    if (alreadyRevealedOnChain) {
      console.log(`Game ${gameId}: reveal already on-chain for ${slot}, syncing backend...`);
    }

    // ---- Map addresses to collection folders ----
    const addressToCollection = {
      [VKIN_CONTRACT_ADDRESS.toLowerCase()]: "VKIN",
      [VQLE_CONTRACT_ADDRESS.toLowerCase()]: "VQLE",
      [SCIONS_CONTRACT_ADDRESS.toLowerCase()]: "SCIONS",
      [EVG_CONTRACT_ADDRESS.toLowerCase()]: "EVG",
    };

    const mapping = loadMapping();
    const tokenURIs = [];
    const backgrounds = [];

    for (let i = 0; i < tokenIds.length; i++) {
      const contractAddr = String(nftContracts[i]).toLowerCase();
      const collection = addressToCollection[contractAddr];

      if (!collection) {
        return res.status(400).json({ error: `Unknown contract: ${contractAddr}` });
      }

      const tokenId = String(tokenIds[i]);
      const mapped = mapping[collection]?.[tokenId];

      if (!mapped) {
        return res.status(400).json({
          error: `Missing mapping for ${collection} token ${tokenId}`,
        });
      }

      const jsonFile = mapped.token_uri || `${tokenId}.json`;
      const jsonPath = path.join(METADATA_JSON_DIR, collection, jsonFile);

      if (!fs.existsSync(jsonPath)) {
        return res.status(500).json({ error: `Metadata missing: ${jsonPath}` });
      }

      const jsonData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const bgTrait = jsonData.attributes?.find((a) => a.trait_type === "Background");

      tokenURIs.push(jsonFile);
      backgrounds.push(bgTrait?.value || "Unknown");
    }

    const revealData = {
      salt,
      nftContracts: [...nftContracts],
      tokenIds: [...tokenIds],
      tokenURIs,
      backgrounds,
    };

    let gamesSnapshot = null;
    let savedReveal = null;
    let bothRevealed = false;
    let revealSavedNow = false;

    // ---- Save reveal data under lock ----
    await withLock(async () => {
      const games = readGames();
      const game = games.find((g) => g.id === gameId);

      if (!game) {
        res.status(404).json({ error: "Game not found" });
        return;
      }

      const freshP1 = game.player1?.toLowerCase();
      const freshP2 = game.player2?.toLowerCase();

      let freshSlot;
      if (walletLc === freshP1) freshSlot = "player1";
      else if (walletLc === freshP2) freshSlot = "player2";
      else {
        res.status(403).json({ error: "Not a game participant" });
        return;
      }

      if (game[`${freshSlot}Reveal`]) {
        console.log(`Game ${gameId}: backend already has reveal for ${freshSlot}`);
        res.json({
          message: "Reveal already synced",
          savedReveal: game[`${freshSlot}Reveal`],
        });
        return;
      }

      game[`${freshSlot}Reveal`] = revealData;
      game.backendPlayer1Revealed = !!game.player1Reveal;
      game.backendPlayer2Revealed = !!game.player2Reveal;

      writeGames(games);

      gamesSnapshot = games;
      savedReveal = game[`${freshSlot}Reveal`];
      bothRevealed = !!(game.player1Reveal && game.player2Reveal);
      revealSavedNow = true;
    });

    if (res.headersSent) return;

    if (revealSavedNow) {
      try {
        const updatedPlayer = await awardXp(walletLc, XP_REWARDS.REVEAL);
        console.log(
          `XP awarded: REVEAL +${XP_REWARDS.REVEAL} → ${walletLc}, total XP: ${updatedPlayer.xp}`
        );
      } catch (xpErr) {
        console.error(
          `Failed to award REVEAL XP for ${walletLc}:`,
          xpErr.message || xpErr
        );
      }
    }

broadcast("GameRevealed", gamesSnapshot);

const revealedBy = walletLc;

const currentGame = gamesSnapshot?.find((g) => g.id === gameId);
const player1Revealed = !!currentGame?.player1Reveal;
const player2Revealed = !!currentGame?.player2Reveal;

try {
  await sendTelegramReveal({
    gameId,
    revealedBy,
    player1Revealed,
    player2Revealed,
  });
} catch (tgErr) {
  console.error(
    "Telegram GameRevealed notification failed:",
    tgErr.message || tgErr
  );
}

if (player1Revealed && player2Revealed) {
  try {
    await sendTelegramBothRevealed({ gameId });
  } catch (tgErr) {
    console.error(
      "Telegram BothRevealed notification failed:",
      tgErr.message || tgErr
    );
  }
}

    // ---- Auto-resolve in background ----
    if (bothRevealed) {
      const tryResolveAndSettle = async (attempt = 1) => {
        try {
          const onChain = await contract.games(gameId);
          const p1OnChain = onChain.player1Revealed;
          const p2OnChain = onChain.player2Revealed;
          const onChainWinner = onChain.winner.toLowerCase();
          const onChainSettled = onChain.settled;

          console.log(
            `Attempt ${attempt} - On-chain reveals: P1=${p1OnChain}, P2=${p2OnChain}`
          );

          if (!p1OnChain || !p2OnChain) {
            if (attempt >= 4) {
              console.log(
                `Gave up waiting for on-chain reveals after ${attempt} attempts`
              );
              return false;
            }

            await new Promise((r) => setTimeout(r, 3000));
            return tryResolveAndSettle(attempt + 1);
          }

          console.log(`Both on-chain reveals confirmed after ${attempt} attempts`);

          await withLock(async () => {
            const games = readGames();
            const game = games.find((g) => g.id === gameId);

            if (!game) {
              console.log(`Game ${gameId} disappeared before resolution`);
              return;
            }

            if (!game.player1Reveal || !game.player2Reveal) {
              console.log(`Game ${gameId} missing backend reveal during resolution`);
              return;
            }

            // Compute results
            if (!Array.isArray(game.roundResults) || game.roundResults.length === 0) {
              const resolved = await resolveGame(game);
              if (!resolved) {
                console.log(`resolveGame returned no result for game ${gameId}`);
                return;
              }

              game.roundResults = resolved.roundResults || resolved.rounds || [];
              game.winner = resolved.winner || null;
              game.tie = !!resolved.tie;

              console.log(`Resolved game ${gameId}: winner=${game.winner ?? "tie"}`);
            }

            // Post winner
            if (!game.backendWinner) {
              let winnerAddr = ethers.ZeroAddress.toLowerCase();

              if (!game.tie && game.winner) {
                winnerAddr =
                  game.winner.toLowerCase() === game.player1.toLowerCase()
                    ? game.player1.toLowerCase()
                    : game.player2.toLowerCase();
              }

              if (onChainWinner === ethers.ZeroAddress.toLowerCase()) {
                const tx = await contract.postWinner(gameId, winnerAddr, {
                  gasLimit: 450000,
                });
                await tx.wait(1);
                console.log(`postWinner success: ${tx.hash}`);
              }

              game.backendWinner = winnerAddr;
              game.winnerResolvedAt = new Date().toISOString();
            }

            // Settle
            if (!game.settled && !game.cancelled) {
              if (!onChainSettled) {
                const tx = await contract.settleGame(gameId, {
                  gasLimit: 350000,
                });
                await tx.wait(1);

                game.settled = true;
                game.settleTxHash = tx.hash;
                game.settledAt = new Date().toISOString();

                console.log(`settleGame success: ${tx.hash}`);
              } else {
                game.settled = true;
                game.settledAt = new Date().toISOString();
              }
            }

            writeGames(games);
          });

          return true;
        } catch (err) {
          console.error(`Resolution attempt ${attempt} failed:`, err.message);

          if (attempt >= 4) return false;

          await new Promise((r) => setTimeout(r, 4000));
          return tryResolveAndSettle(attempt + 1);
        }
      };

      tryResolveAndSettle().catch((err) =>
        console.error(`Background resolution failed for game ${gameId}:`, err)
      );
    }

    // ---- Respond immediately ----
    return res.json({
      savedReveal,
      message: bothRevealed
        ? "Both reveals received — waiting for on-chain confirmation and automatic settlement..."
        : "Reveal saved. Waiting for the other player to reveal.",
    });
  } catch (err) {
    console.error("Reveal route failed:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ────────────── BACKFILL ──────────────
router.post("/:id/backfill", async (req, res) => {
  try {
    const gameId = Number(req.params.id);
    const { field, value } = req.body;

    if (!Number.isInteger(gameId)) {
      return res.status(400).json({ error: "Invalid game ID" });
    }

    if (!["settleTxHash", "backendWinner", "settledAt"].includes(field)) {
      return res.status(400).json({ error: "Invalid field for backfill" });
    }

    await withLock(async () => {
      const games = readGames();
      const game = games.find((g) => g.id === gameId);

      if (!game) {
        res.status(404).json({ error: "Game not found" });
        return;
      }

      game[field] = value;
      writeGames(games);

      console.log(`Backfilled ${field} for game ${gameId}: ${value}`);
    });

    if (res.headersSent) return;

    return res.json({ success: true, updated: { [field]: value } });
  } catch (err) {
    console.error(`Backfill error for game ${req.params.id}:`, err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ────────────── COMPUTE RESULTS ──────────────
router.post("/:id/compute-results", async (req, res) => {
  try {
    const gameId = Number(req.params.id);

    if (!Number.isInteger(gameId)) {
      return res.status(400).json({ error: "Invalid game ID" });
    }

    // First read: validate and fast-return if already computed
    const initialGames = readGames();
    const initialGame = initialGames.find((g) => g.id === gameId);

    if (!initialGame) {
      return res.status(404).json({ error: "Game not found" });
    }

    if (!initialGame.player1Reveal || !initialGame.player2Reveal) {
      return res.status(400).json({ error: "Both players must reveal first" });
    }

    if (Array.isArray(initialGame.roundResults) && initialGame.roundResults.length > 0) {
      return res.json({
        success: true,
        alreadyComputed: true,
        roundResults: initialGame.roundResults,
        winner: initialGame.winner?.toLowerCase() || null,
        tie: initialGame.tie || false,
      });
    }

    // Compute outside the lock so we do not block other writers longer than needed
const resolved = await resolveGame(initialGame);

console.log(
  `resolveGame(${gameId}) returned:`,
  JSON.stringify(resolved, null, 2)
);

const resolvedRounds = resolved?.roundResults || resolved?.rounds || [];

if (!resolved) {
  return res.status(500).json({
    error: "resolveGame returned null/undefined",
  });
}

if (!Array.isArray(resolvedRounds)) {
  return res.status(500).json({
    error: "resolveGame did not return roundResults/rounds array",
    resolved,
  });
}

if (resolvedRounds.length === 0) {
  return res.status(500).json({
    error: "resolveGame returned empty rounds",
    resolved,
  });
}

    let responsePayload = null;

    await withLock(async () => {
      const games = readGames();
      const game = games.find((g) => g.id === gameId);

      if (!game) {
        res.status(404).json({ error: "Game not found" });
        return;
      }

      if (!game.player1Reveal || !game.player2Reveal) {
        res.status(400).json({ error: "Both players must reveal first" });
        return;
      }

      // Another request may have computed results while we were resolving
      if (Array.isArray(game.roundResults) && game.roundResults.length > 0) {
        responsePayload = {
          success: true,
          alreadyComputed: true,
          roundResults: game.roundResults,
          winner: game.winner?.toLowerCase() || null,
          tie: game.tie || false,
        };
        return;
      }

      // Persist computation
game.roundResults = resolvedRounds;
game.tie = !!resolved.tie;
game.winner = resolved.tie ? null : resolved.winner;
game.cancelled = false;
game.settlementState = "pending-confirmation";
writeGames(games);

      console.log(`Computed results for game ${gameId}:`, {
        winner: game.winner,
        tie: game.tie,
        rounds: game.roundResults.length,
      });

      responsePayload = {
        success: true,
        gameId,
        roundResults: game.roundResults,
        winner: game.winner,
        tie: game.tie,
      };
    });

    if (res.headersSent) return;

    return res.json(responsePayload);
  } catch (err) {
    console.error(`Compute-results error for game ${req.params.id}:`, err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

/* ---------------- POST WINNER ---------------- */
router.post("/:id/post-winner", async (req, res) => {
  try {
    const gameId = Number(req.params.id);

    if (!Number.isInteger(gameId)) {
      return res.status(400).json({ error: "Invalid game ID" });
    }

    if (!adminWalletReady || !adminContract) {
      return res.status(503).json({ error: "Backend admin wallet not ready" });
    }

    let winnerAddress;

    // First lock: validate and capture required state
    await withLock(async () => {
      const games = readGames();
      const game = games.find((g) => g.id === gameId);

      if (!game) {
        res.status(404).json({ error: "Game not found" });
        return;
      }

      if (!Array.isArray(game.roundResults) || game.roundResults.length === 0) {
        res.status(400).json({ error: "Results not computed yet" });
        return;
      }

      if (game.backendWinner) {
        res.json({
          success: true,
          alreadyPosted: true,
          winner: game.backendWinner,
        });
        return;
      }

const derived = deriveWinnerFromRoundResults(game);

game.tie = derived.tie;
game.winner = derived.winner;
game.cancelled = false;

winnerAddress = game.tie ? ethers.ZeroAddress : game.winner;

const zero = ethers.ZeroAddress.toLowerCase();

if (!game.tie && (!winnerAddress || String(winnerAddress).toLowerCase() === zero)) {
  res.status(500).json({
    error: "Cannot post zero/null winner for non-tie completed game",
  });
  return;
}
    });

    if (res.headersSent) return;

    // Post winner on-chain outside the lock
    const tx = await adminContract.postWinner(gameId, winnerAddress);
    await tx.wait(1);

    // Second lock: persist backend state safely against fresh data
    await withLock(async () => {
      const games = readGames();
      const game = games.find((g) => g.id === gameId);

      if (!game) {
        res.status(404).json({ error: "Game not found after tx confirmation" });
        return;
      }

      // If another path already persisted backendWinner while tx was pending,
      // keep idempotency and just avoid overwriting useful existing state.
      if (!game.backendWinner) {
        game.backendWinner = String(winnerAddress).toLowerCase();
      }

      if (!game.postWinnerTxHash) {
        game.postWinnerTxHash = tx.hash;
      }

      if (!game.winnerResolvedAt) {
        game.winnerResolvedAt = new Date().toISOString();
      }

      game.settlementState = "winner-posted";

      writeGames(games);
    });

    if (res.headersSent) return;

    return res.json({ success: true, winner: winnerAddress, txHash: tx.hash });
  } catch (err) {
    console.error("post-winner error:", err);
    return res.status(500).json({ error: err.message || "Failed to post winner" });
  }
});

/* ---------------- MANUAL SETTLE GAME ---------------- */
router.post("/:id/settle-game", async (req, res) => {
  try {
    const gameId = Number(req.params.id);
    const { settledBy } = req.body;

    if (!Number.isInteger(gameId)) {
      return res.status(400).json({ error: "Invalid game ID" });
    }

    if (!settledBy || typeof settledBy !== "string") {
      return res.status(400).json({ error: "settledBy wallet required" });
    }

    const settledByLc = settledBy.toLowerCase();

    let gameSnapshot = null;
    let newlySettled = false;

    // First lock: validate and take a fresh snapshot
    await withLock(async () => {
      const games = readGames();
      const game = games.find((g) => g.id === gameId);

      if (!game) {
        res.status(404).json({ error: "Game not found" });
        return;
      }

      if (!game.player1Reveal || !game.player2Reveal) {
        res.status(400).json({ error: "Both players must reveal before settling" });
        return;
      }

      if (game.settled) {
        res.json({ success: true, alreadySettled: true, gameId });
        return;
      }

      gameSnapshot = JSON.parse(JSON.stringify(game));
    });

    if (res.headersSent) return;

    // Compute results outside the lock if missing
    let resolved = null;
    if (!Array.isArray(gameSnapshot.roundResults) || gameSnapshot.roundResults.length === 0) {
      resolved = await resolveGame(gameSnapshot);

      const resolvedRounds = resolved?.roundResults || resolved?.rounds || [];
      if (!resolved || !Array.isArray(resolvedRounds) || resolvedRounds.length === 0) {
        return res.status(500).json({ error: "Failed to compute results" });
      }
    }

    // Persist computed results if still missing
    await withLock(async () => {
      const games = readGames();
      const game = games.find((g) => g.id === gameId);

      if (!game) {
        res.status(404).json({ error: "Game not found" });
        return;
      }

      if (game.settled) {
        res.json({ success: true, alreadySettled: true, gameId });
        return;
      }

      if (
        (!Array.isArray(game.roundResults) || game.roundResults.length === 0) &&
        resolved
      ) {
        const resolvedRounds = resolved.roundResults || resolved.rounds || [];
        game.roundResults = resolvedRounds;
        game.tie = !!resolved.tie;
        game.winner = resolved.tie ? null : resolved.winner;
        game.settlementState = "pending-confirmation";
        writeGames(games);
      }

      gameSnapshot = JSON.parse(JSON.stringify(game));
    });

    if (res.headersSent) return;

function deriveWinnerFromRoundResults(game) {
  const rounds = Array.isArray(game.roundResults) ? game.roundResults : [];

  const p1Wins = rounds.filter(r => r.winner === "player1").length;
  const p2Wins = rounds.filter(r => r.winner === "player2").length;

  if (p1Wins > p2Wins) {
    return { winner: game.player1?.toLowerCase(), tie: false };
  }

  if (p2Wins > p1Wins) {
    return { winner: game.player2?.toLowerCase(), tie: false };
  }

  return { winner: null, tie: true };
}

    // Ensure winner posted
    let winnerTx = null;

if (
  Array.isArray(gameSnapshot.roundResults) &&
  gameSnapshot.roundResults.length > 0
) {
  const derived = deriveWinnerFromRoundResults(gameSnapshot);

  gameSnapshot.winner = derived.winner;
  gameSnapshot.tie = derived.tie;
}

let winnerAddress = gameSnapshot.tie
  ? ethers.ZeroAddress
  : gameSnapshot.winner;

const zero = ethers.ZeroAddress.toLowerCase();

if (
  !gameSnapshot.tie &&
  (!winnerAddress || String(winnerAddress).toLowerCase() === zero)
) {
  return res.status(500).json({
    error: "Cannot post zero/null winner for non-tie completed game",
  });
}

    if (!gameSnapshot.backendWinner) {
      if (!adminWalletReady || !adminContract) {
        return res.status(503).json({ error: "Backend admin wallet not ready" });
      }

      winnerTx = await adminContract.postWinner(gameId, winnerAddress);
      await winnerTx.wait(1);

      await withLock(async () => {
        const games = readGames();
        const game = games.find((g) => g.id === gameId);

        if (!game) {
          res.status(404).json({ error: "Game not found after winner tx confirmation" });
          return;
        }

        if (!game.backendWinner) {
          game.backendWinner = String(winnerAddress).toLowerCase();
        }

        if (!game.postWinnerTxHash) {
          game.postWinnerTxHash = winnerTx.hash;
        }

        if (!game.winnerResolvedAt) {
          game.winnerResolvedAt = new Date().toISOString();
        }

        game.settlementState = "winner-posted";
        writeGames(games);

        gameSnapshot = JSON.parse(JSON.stringify(game));
      });

      if (res.headersSent) return;
    }

    // Re-check before settle
    await withLock(async () => {
      const games = readGames();
      const game = games.find((g) => g.id === gameId);

      if (!game) {
        res.status(404).json({ error: "Game not found" });
        return;
      }

      if (game.settled) {
        res.json({ success: true, alreadySettled: true, gameId });
        return;
      }

      gameSnapshot = JSON.parse(JSON.stringify(game));
    });

    if (res.headersSent) return;

    // Settle game on-chain outside the lock
    const txSettle = await adminContract.settleGame(gameId);
    await txSettle.wait(1);

    let finalSettledAt = null;

    // Persist settled state
    await withLock(async () => {
      const games = readGames();
      const game = games.find((g) => g.id === gameId);

      if (!game) {
        res.status(404).json({ error: "Game not found after settle tx confirmation" });
        return;
      }

      if (!game.settled) {
        finalSettledAt = new Date().toISOString();
        game.settled = true;
        game.settleTxHash = txSettle.hash;
        game.settledAt = finalSettledAt;
        game.settlementState = "settled";
        if (!game.settleXpAwarded) {
          const p1 = String(game.player1 || "").toLowerCase();
          const p2 = String(game.player2 || "").toLowerCase();
          const zero = ethers.ZeroAddress.toLowerCase();

        if (p1 && p1 !== zero) {
          await awardXp(p1, XP_REWARDS.SETTLE);
        }

        if (p2 && p2 !== zero) {
          await awardXp(p2, XP_REWARDS.SETTLE);
        }
        game.settleXpAwarded = true;
        game.settleXpAwardedAt = new Date().toISOString();
        }
        writeGames(games);
        newlySettled = true;
      } else {
        finalSettledAt = game.settledAt || new Date().toISOString();
      }
    });

    if (res.headersSent) return;

await rebuildWeeklyLeaderboardForDate(finalSettledAt);

try {
await sendTelegramGameSettled({
  gameId,
  winner: gameSnapshot?.winner,
  tie: gameSnapshot?.tie,
});
} catch (tgErr) {
  console.error("Telegram GameSettled notification failed:", tgErr.message || tgErr);
}

    return res.json({ success: true, gameId, txHash: txSettle.hash });
  } catch (err) {
    console.error("manual settle-game error:", err);
    return res.status(500).json({ error: err.message || "Failed to settle game" });
  }
});

/* ---------------- FINALIZE SETTLE ---------------- */
router.post("/:id/finalize-settle", async (req, res) => {
  const gameId = Number(req.params.id);
  const { txHash } = req.body;

  if (!Number.isInteger(gameId)) {
    return res.status(400).json({ error: "Invalid game ID" });
  }

  if (!txHash) {
    return res.status(400).json({ error: "Missing txHash" });
  }

  try {
    await withLock(async () => {
      const games = readGames();
      const game = games.find((g) => g.id === gameId);

      if (!game) {
        res.status(404).json({ error: "Game not found" });
        return;
      }

      if (game.settled) {
        res.json({ success: true, alreadySettled: true, gameId });
        return;
      }

      // Canonical settlement
      game.settled = true;
      game.settleTxHash = txHash;
      game.settledAt = new Date().toISOString();
      game.winner ??= game.backendWinner ?? ethers.ZeroAddress.toLowerCase();
      game.settlementState = "settled";

      writeGames(games);

      res.json({
        success: true,
        gameId,
        txHash,
      });
    });
  } catch (err) {
    console.error("finalize-settle error:", err);
    res.status(500).json({ error: err.message || "Failed to finalize settle" });
  }
});

    // ------------------ Setup provider and wallet ------------------
    if (!BACKEND_PRIVATE_KEY.startsWith("0x")) {
      throw new Error("Backend private key must start with 0x");
    }

/* ---------- CANCEL UNJOINED GAME ----------- */
router.post("/:id/cancel-unjoined", async (req, res) => {
  try {
    const gameId = Number(req.params.id);

    if (!Number.isInteger(gameId)) {
      return res.status(400).json({ error: "Invalid game ID" });
    }

    // Ensure backend matches on-chain first
    await reconcileActiveGamesScheduled();

    let gameSnapshot = null;

    // Validate against fresh backend state under lock
    await withLock(async () => {
      const games = readGames();
      const game = games.find((g) => g.id === gameId);

      if (!game) {
        res.status(404).json({ error: "Game not found" });
        return;
      }

      // Must be unjoined
      if (game.player2 && game.player2 !== ethers.ZeroAddress.toLowerCase()) {
        res.status(400).json({ error: "Game already joined - cannot cancel" });
        return;
      }

      // Already in terminal state?
      if (game.cancelled || game.settled) {
        res.status(400).json({ error: "Game already settled or cancelled" });
        return;
      }

      gameSnapshot = JSON.parse(JSON.stringify(game));
    });

    if (res.headersSent) return;

    console.log(`[CANCEL] Cancelling unjoined game ${gameId}...`);

    // On-chain cancel outside the lock
    const tx = await contract.cancelUnjoinedGame(gameId);
    console.log(`[CANCEL] tx sent: ${tx.hash}`);
    await tx.wait();
    console.log(`[CANCEL] confirmed on-chain`);

    let gamesSnapshot = null;
    let shouldRevertCreateXp = false;
    let cancelWallet = null;

    // Persist fresh backend state under lock
    await withLock(async () => {
      const games = readGames();
      const game = games.find((g) => g.id === gameId);

      if (!game) {
        res.status(404).json({ error: "Game not found after cancel confirmation" });
        return;
      }

      // If another path already marked it terminal while tx was pending,
      // keep the route idempotent.
      if (!game.cancelled) {
        game.cancelled = true;
      }

      if (!game.settled) {
        game.settled = true;
      }

      game.settledAt ??= new Date().toISOString();
      game.settleTxHash ??= tx.hash;
      game.settlementState = "cancelled";

      if (game.xp?.createAwarded && !game.xp?.createXpReverted) {
        shouldRevertCreateXp = true;
        cancelWallet = game.player1?.toLowerCase();

        game.xp = {
          ...(game.xp || {}),
          createXpReverted: true,
          createXpRevertedAt: new Date().toISOString(),
        };
      }

      writeGames(games);
      gamesSnapshot = games;
    });

    if (res.headersSent) return;

        if (shouldRevertCreateXp && cancelWallet) {
      try {
        const updatedPlayer = adjustXp(cancelWallet, -XP_REWARDS.CREATE_GAME);
        console.log(
          `XP reverted: CANCEL_UNJOINED -${XP_REWARDS.CREATE_GAME} → ${cancelWallet}, total XP: ${updatedPlayer.xp}`
        );
      } catch (xpErr) {
        console.error(
          `Failed to revert CREATE_GAME XP for ${cancelWallet}:`,
          xpErr.message || xpErr
        );
      }
    }

broadcast("GameCancelled", gamesSnapshot);

try {
  await sendTelegramGameCancelled({
    gameId,
    cancelledBy: req.wallet?.toLowerCase(),
  });
} catch (tgErr) {
  console.error("Telegram GameCancelled notification failed:", tgErr.message || tgErr);
}

    return res.json({
      success: true,
      gameId,
      txHash: tx.hash,
      status: "cancelled",
    });
  } catch (err) {
    console.error("[CANCEL] error:", err);
    return res.status(500).json({
      error: err.reason || err.message || "Internal server error",
    });
  }
});

export default router;