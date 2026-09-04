// backend/scripts/backfillGameWinners.js
//
// Fixes the leaderboard "wins" column showing zero/empty for everyone.
//
// Root cause: after the data wipe, games.json was rebuilt by a resync that
// only pulls the on-chain `games(id)` struct (creator, joiner, settled,
// cancelled, revealed flags) — it never populated `winner`. Both the
// frontend's leaderboard (src/App.js) and the backend's weekly leaderboard
// (utils/weeklyLeaderboard.js) read game.winner directly, so with that field
// missing every wins/winRate column reads zero.
//
// The winner IS still recoverable — the Game contract exposes it via a
// separate getter, `backendWinner(gameId)`, distinct from the `games(id)`
// struct (confirmed: game 0/1 -> 0x2871835C..., matching the pre-wipe
// backup's `backendWinner` field exactly). This script walks every game ID,
// reads that getter, and merges the result into games.json as `winner`.
//
// Run ON THE SERVER (so it reads/writes the real live games.json via the
// app's own store helpers):
//
//   node scripts/backfillGameWinners.js            # dry run — prints only
//   node scripts/backfillGameWinners.js --write     # also writes games.json
//
// Purely additive and read-only on-chain (no private key, no transactions
// sent) — safe to re-run any time, including after future games are played.

import { ethers } from "ethers";
import { RPC_URL, GAME_ADDRESS } from "../config.js";
import GameABI from "../../src/abis/GameABI.json" with { type: "json" };
import { readGames, writeGames } from "../store/gamesStore.js";

const WRITE = process.argv.includes("--write");
const ZERO = ethers.ZeroAddress.toLowerCase();

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(GAME_ADDRESS, GameABI, provider);

  const games = readGames();
  let changed = 0;
  let resolved = 0;

  for (const game of games) {
    let winner;
    try {
      const w = await contract.backendWinner(game.id);
      winner = w && w.toLowerCase() !== ZERO ? w.toLowerCase() : null;
    } catch (err) {
      console.error(`game ${game.id}: backendWinner() failed — ${err.message}`);
      continue;
    }

    if (winner) resolved++;
    if (game.winner !== winner) {
      changed++;
      game.winner = winner;
    }
  }

  console.log(`Checked ${games.length} games — ${resolved} have a resolved winner, ${changed} field(s) updated.`);

  if (!WRITE) {
    console.log("Dry run only — pass --write to save this into games.json");
    return;
  }

  writeGames(games);
  console.log("games.json updated. Re-run/trigger your weekly leaderboard rebuild to refresh stored standings —");
  console.log("the frontend leaderboard reads game.winner directly from GET /games so it picks this up immediately.");
}

main().catch((err) => {
  console.error("backfillGameWinners failed:", err);
  process.exit(1);
});
