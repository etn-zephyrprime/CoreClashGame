// backend/utils/handleEvent.js
import { readGames, writeGames } from "../gamesStore.js";
import { broadcast } from "../routes/events.js";
import { deleteCache } from "../utils/ownerCache.js";
import { ethers } from "ethers";
import {
  VKIN_CONTRACT_ADDRESS,
  VQLE_CONTRACT_ADDRESS,
  SCIONS_CONTRACT_ADDRESS,
  EVG_CONTRACT_ADDRESS
} from "../config.js";

// Sanitize BigInt values in args for logging and broadcasting
  function sanitizeBigInt(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeBigInt);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitizeBigInt(v)])
    );
  }

  return value;
}

  // ---------------- TRANSFER HANDLING ----------------
  if (e.eventName === "Transfer") {
    const contractAddr = e.address.toLowerCase();
    const from = args?.from?.toLowerCase();
    const to = args?.to?.toLowerCase();

const isTrackedCollection =
  contractAddr === VKIN_CONTRACT_ADDRESS.toLowerCase() ||
  contractAddr === VQLE_CONTRACT_ADDRESS.toLowerCase() ||
  contractAddr === SCIONS_CONTRACT_ADDRESS.toLowerCase();
  contractAddr === EVG_CONTRACT_ADDRESS.toLowerCase();

if (isTrackedCollection) {
  if (from && from !== ethers.ZeroAddress.toLowerCase()) {
    deleteCache(from);
    console.log(`♻️ Cache invalidated for ${from}`);
  }

  if (to && to !== ethers.ZeroAddress.toLowerCase()) {
    deleteCache(to);
    console.log(`♻️ Cache invalidated for ${to}`);
  }
}

    return; // Transfer handled, nothing else to do
  }

  // ---------------- GAME EVENTS ----------------
export async function handleEvent(e) {
  const games = readGames();
  const eventName = e.eventName;
  const args = e.args;

  if (!args || args.length === 0) return;

  const gameId = Number(args[0]);

  let game = games.find(g => g.id === gameId);

  if (!game) {
    game = {
      id: gameId,
      cancelled: false,
      settled: false,
      player1Revealed: false,
      player2Revealed: false,
    };
    games.push(game);
  }

switch (eventName) {
  case "GameCreated": {
    const player1 = args[1];
    if (player1) {
      game.player1 = player1.toLowerCase();
      game.createdAt = new Date().toISOString();
    }
    break;
  }

  case "GameJoined": {
    const player2 = args[1];
    if (player2) {
      game.player2 = player2.toLowerCase();
      game.player2JoinedAt = new Date().toISOString();
    }
    break;
  }

  case "GameCancelled": {
    game.cancelled = true;
    game.cancelledAt = new Date().toISOString();
    break;
  }

  case "GameSettled": {
    const winner = args[1];
    game.settled = true;
    game.winner = winner.toLowerCase();
    game.settledAt = new Date().toISOString();
    break;
  }
  }

  writeGames(games);

broadcast(eventName, sanitizeBigInt({
  gameId,
  args
}));
}