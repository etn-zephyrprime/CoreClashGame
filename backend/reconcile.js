import { readGames, writeGames } from "./store/gamesStore.js";
import { gameReadContract as contract } from "./gameContract.js";
import { ethers } from "ethers";
import { withLock } from "./utils/mutex.js";
import PQueue from "p-queue";
import { isCatchingUp } from "./eventListener.js";
import { deriveWinnerFromRoundResults } from "./utils/gameHelpers.js";

const ZERO = ethers.ZeroAddress;
const RPC_CONCURRENCY = 5;

/* ================================================================
   DISCOVER MISSING GAMES (every 1 min)
   ================================================================ */

const discoverQueue = new PQueue({ concurrency: RPC_CONCURRENCY });

export async function discoverMissingGamesScheduled() {
  const games = readGames();
  const knownIds = new Set(games.map(g => g.id));
  let added = 0;

  let gamesLength;
  try {
    gamesLength = Number(await contract.gamesLength());
  } catch (err) {
    console.error("[DISCOVER] Failed to fetch gamesLength:", err.message);
    return;
  }

  const missingIds = [];
  for (let id = 0; id < gamesLength; id++) {
    if (!knownIds.has(id)) missingIds.push(id);
  }

  if (missingIds.length === 0) return;

  await Promise.all(
    missingIds.map(id =>
      discoverQueue.add(async () => {
        try {
          const onChain = await contract.games(id);
          if (!onChain || onChain.player1 === ZERO) return;

          games.push({
            id,
            player1: onChain.player1.toLowerCase(),
            player2: onChain.player2?.toLowerCase() || null,
            stakeAmount: onChain.stakeAmount?.toString() || "0",
            stakeToken: onChain.stakeToken || null,
            settled: !!onChain.settled,
            cancelled: false, // default to false until we see explicit settlement without winner
            winner: onChain.settled ? onChain.winner?.toLowerCase() : null,
            player1Revealed: !!onChain.player1Revealed,
            player2Revealed: !!onChain.player2Revealed,
            createdAt: new Date().toISOString(),
          });

          added++;
        } catch (err) {
          console.warn(`[DISCOVER] Failed on game ${id}:`, err.message);
        }
      })
    )
  );

  if (added > 0) {
    games.sort((a, b) => a.id - b.id);
    writeGames(games);
    console.log(`[DISCOVER] Added ${added} missing game(s)`);
  }
}

// every 1 minute
setInterval(discoverMissingGamesScheduled, 60 * 1000);

/* ================================================================
   RECONCILE ACTIVE GAMES ONLY (every 2 min)
   ================================================================ */

const reconcileQueue = new PQueue({ concurrency: RPC_CONCURRENCY });

export async function reconcileActiveGamesScheduled() {
  if (isCatchingUp) {
    console.log("[SKIP] Skipping reconcile while catching up");
    return;
  } 

  await withLock(async () => {
    const games = readGames();
    let dirty = false;

// Repair poisoned completed games before filtering active games.
// These were incorrectly marked cancelled even though they have real results.
for (const game of games) {
  const hasBothReveals =
    !!game.player1Reveal &&
    !!game.player2Reveal;

  const hasResults =
    Array.isArray(game.roundResults) &&
    game.roundResults.length > 0;

if (hasBothReveals && hasResults && game.cancelled === true) {
  const derived = deriveWinnerFromRoundResults(game);

  game.cancelled = false;
  game.tie = derived.tie;
  game.winner = derived.winner;

  if (derived.tie) {
    game.backendWinner = ZERO;
  } else if (derived.winner) {
    game.backendWinner = derived.winner;
  }

  game.settlementState = game.settled
    ? "settled"
    : "pending-confirmation";

  dirty = true;

    console.warn(`[RECONCILE][REPAIR] Fixed poisoned game ${game.id}`, {
      winner: game.winner,
      tie: game.tie,
      settled: game.settled,
    });
  }
}

    // 🔥 Only reconcile unsettled + non-cancelled games
    const activeGames = games.filter(
      g => !g.settled && !g.cancelled
    );

    if (activeGames.length === 0) {
      console.log("[RECONCILE] No active games to process");
      return;
    }

    await Promise.all(
      activeGames.map(game =>
        reconcileQueue.add(async () => {
          try {
            const onChain = await contract.games(game.id);

// ---- Sync players (Chain is Truth) ----
const chainP1 = onChain.player1?.toLowerCase();
const chainP2 = onChain.player2?.toLowerCase();

if (game.player1 !== chainP1) {
  game.player1 = chainP1;
  dirty = true;
}

if (game.player2 !== chainP2) {
  game.player2 = chainP2;
  dirty = true;
}

/* -----------------------------
   Settlement Sync (Chain = Truth)
------------------------------*/
const hasBothReveals =
  !!game.player1Reveal &&
  !!game.player2Reveal;

const hasResults =
  Array.isArray(game.roundResults) &&
  game.roundResults.length > 0;

const isTie =
  game.tie === true;

if (onChain.settled) {
  if (!game.settled) {
    game.settled = true;
    game.settledAt = new Date().toISOString();
    dirty = true;
  }

  const winnerAddr = await contract.backendWinner(game.id);
  const chainWinner = winnerAddr?.toLowerCase();

  if (chainWinner && chainWinner !== ZERO) {
    if (game.backendWinner !== chainWinner) {
      game.backendWinner = chainWinner;
      game.winner = chainWinner;
      dirty = true;
    }

    if (game.cancelled) {
      game.cancelled = false;
      dirty = true;
    }
  } else {
    // ZERO winner can mean tie, cancelled, timeout, or bad/missing backend winner.
    // Do NOT blindly mark cancelled if the game has real revealed results.
    if (hasBothReveals || hasResults || isTie) {
      if (game.cancelled) {
        game.cancelled = false;
        dirty = true;
      }

      if (isTie) {
        game.winner = null;
        game.backendWinner = ZERO;
        dirty = true;
      }

      console.warn(
        `[RECONCILE] Game ${game.id} settled with ZERO winner, but has reveal/results. Not marking cancelled.`
      );
    } else {
      if (!game.cancelled) {
        game.cancelled = true;
        game.backendWinner = null;
        game.winner = null;
        dirty = true;
      }
    }
  }
}

            /* -----------------------------
               Reveal flags
            ------------------------------*/
            if (onChain.player1Revealed && !game.player1Revealed) {
              game.player1Revealed = true;
              dirty = true;
            }

            if (onChain.player2Revealed && !game.player2Revealed) {
              game.player2Revealed = true;
              dirty = true;
            }

          } catch (err) {
            console.warn(
              `[RECONCILE] Failed for game ${game.id}:`,
              err.message
            );
          }
        })
      )
    );

    if (dirty) {
      writeGames(games);
      console.log("[RECONCILE] Active games updated");
    }
  });
}

// ⏱ Run every 2 minutes
setInterval(reconcileActiveGamesScheduled, 2 * 60 * 1000);

/* ================================================================
   FULL RECONCILE SWEEP (Batched + Safe)
   ================================================================ */

const FULL_SWEEP_BATCH_SIZE = 50;

export async function reconcileFullSweep() {
  if (isCatchingUp) {
    console.log("[FULL SWEEP] Skipping while catching up");
    return;
  }

  console.log("[FULL SWEEP] Starting hourly reconciliation...");

  await withLock(async () => {
    const games = readGames();
    let dirty = false;

    for (let i = 0; i < games.length; i += FULL_SWEEP_BATCH_SIZE) {
      const batch = games.slice(i, i + FULL_SWEEP_BATCH_SIZE);

      await Promise.all(
        batch.map(async (game) => {
          try {
            const onChain = await contract.games(game.id);

// ---- Sync players (Chain is Truth) ----
const chainP1 = onChain.player1?.toLowerCase();
const chainP2 = onChain.player2?.toLowerCase();

if (game.player1 !== chainP1) {
  game.player1 = chainP1;
  dirty = true;
}

if (game.player2 !== chainP2) {
  game.player2 = chainP2;
  dirty = true;
}

// ---- Sync settlement ----
if (game.settled !== onChain.settled) {
  game.settled = onChain.settled;
  game.settledAt = onChain.settled
    ? new Date().toISOString()
    : null;
  dirty = true;
}

// ---- Sync winner ONLY if settled ----
if (onChain.settled) {
  const chainWinner = onChain.winner?.toLowerCase();

  if (chainWinner && chainWinner !== ZERO) {
    if (game.backendWinner !== chainWinner) {
      game.backendWinner = chainWinner;
      game.winner = chainWinner;
      game.cancelled = false;
      dirty = true;
    }
  } else {
    // Only cancelled if explicitly settled without winner
    if (!game.cancelled || game.backendWinner) {
      game.cancelled = false;
      game.backendWinner = null;
      game.winner = null;
      dirty = true;
    }
  }
}

            // ---- Sync reveals ----
            if (onChain.player1Revealed && !game.player1Revealed) {
              game.player1Revealed = true;
              dirty = true;
            }

            if (onChain.player2Revealed && !game.player2Revealed) {
              game.player2Revealed = true;
              dirty = true;
            }

          } catch (err) {
            console.warn(
              `[FULL SWEEP] Failed for game ${game.id}:`,
              err.message
            );
          }
        })
      );

      // Small delay between batches to avoid burst throttling
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    if (dirty) {
      writeGames(games);
      console.log("[FULL SWEEP] games.json updated from chain truth");
    } else {
      console.log("[FULL SWEEP] No drift detected");
    }
  });
}

setInterval(reconcileFullSweep, 60 * 60 * 1000);

// Run once on boot
reconcileFullSweep().catch(err =>
  console.error("[FULL SWEEP BOOT ERROR]", err)
);