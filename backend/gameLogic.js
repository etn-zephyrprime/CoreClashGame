// gameLogic.js
import axios from "axios";
import { METADATA_JSON_DIR } from "./paths.js";
import fs from "fs";
import path from "path";
import tokenMapping from "../src/mapping.json" with { type: "json" };
import { readPlayerXp } from "./utils/playerXp.js";

// Helper to map tokenId → tokenURI from mapping.json
function tokenIdToTokenURI(collection, tokenId) {
  const collectionMap = tokenMapping[collection];
  if (!collectionMap) {
    throw new Error(`No mapping for collection ${collection}`);
  }

  const entry = collectionMap[String(tokenId)];
  if (!entry || !entry.token_uri) {
    throw new Error(
      `No token_uri mapping for ${collection} tokenId ${tokenId}`
    );
  }

  return entry.token_uri;
}

// Ensure lowercase keys (matches .toLowerCase() usage)
const addressToCollection = {
  "0x3fc7665b1f6033ff901405cddf31c2e04b8a2ab4": "VKIN",
  "0x8cfbb04c54d35e2e8471ad9040d40d73c08136f0": "VQLE",
  "0xac620b1a3de23f4eb0a69663613babf73f6c535d": "SCIONS",
  "0x5c81a5609eaeef7962f1d089d6343f9790387901": "EVG",
};

// Collection → faction mapping
const collectionToFaction = {
  VKIN: "KIN",
  VQLE: "KIN",
  SCIONS: "SCIONS",
  EVG: "SCIONS",
};

function getCollectionFromContract(contractAddr) {
  if (!contractAddr) return null;
  return addressToCollection[contractAddr.toLowerCase()] || null;
}

function getFactionFromCollection(collection) {
  if (!collection) return null;
  return collectionToFaction[collection] || null;
}

/**
 * Returns faction name if all 3 NFTs belong to the same faction.
 * Examples:
 * - VKIN + VKIN + VKIN => KIN
 * - VKIN + VKIN + VQLE => KIN
 * - VQLE + VQLE + VKIN => KIN
 * - SCIONS + SCIONS + SCIONS => SCIONS
 * - SCIONS + EVG + EVG => SCIONS
 * - VKIN + SCIONS + VQLE => null
 */
function getTeamFactionBonus(contracts) {
  if (!Array.isArray(contracts) || contracts.length !== 3) return null;

  const collections = contracts.map(getCollectionFromContract);

  // reject unknown collections
  if (collections.some((c) => !c)) return null;

  const factions = collections.map(getFactionFromCollection);

  // reject unknown factions
  if (factions.some((f) => !f)) return null;

  const allSameFaction = factions.every((f) => f === factions[0]);
  return allSameFaction ? factions[0] : null;
}

/**
 * Apply +10% Attack to each NFT in the team.
 * Attack is traits[0].
 * Uses Math.ceil() to round up.
 */
function applyAttackBoost(traitsArr, boostPercent = 10) {
  const multiplier = 1 + boostPercent / 100;

  return traitsArr.map((traits) => {
    const boosted = [...traits];
    boosted[0] = Math.ceil(boosted[0] * multiplier);
    return boosted;
  });
}

//// XP / LEVELING SYSTEM
function getPlayerXpBonuses(wallet) {
  const empty = { attack: 0, defense: 0, vitality: 0, agility: 0 };

  if (!wallet) return empty;

  try {
    const allXp = readPlayerXp();
    const walletLc = String(wallet).toLowerCase();
    const player = allXp[walletLc];

    if (!player) return empty;

    const levelBonus = player.statsBonus || empty;
    const weeklyBonus = player.weeklyLeaderboardBonus || empty;

    return {
      attack: Number(((levelBonus.attack || 0) + (weeklyBonus.attack || 0)).toFixed(2)),
      defense: Number(((levelBonus.defense || 0) + (weeklyBonus.defense || 0)).toFixed(2)),
      vitality: Number(((levelBonus.vitality || 0) + (weeklyBonus.vitality || 0)).toFixed(2)),
      agility: Number(((levelBonus.agility || 0) + (weeklyBonus.agility || 0)).toFixed(2)),
    };
  } catch (err) {
    console.error(`Failed to read XP bonuses for ${wallet}:`, err.message);
    return empty;
  }
}

function applyXpBoostToTraits(traitsArr, bonuses) {
  return traitsArr.map((traits) => {
    const boosted = [...traits];

    // traits = [attack, defense, vitality, agility, core]
    boosted[0] += bonuses.attack || 0;
    boosted[1] += bonuses.defense || 0;
    boosted[2] += bonuses.vitality || 0;
    boosted[3] += bonuses.agility || 0;

    return boosted;
  });
}

/// ----------- fetch NFT metadata with local JSON files (no external calls) -----------
export const fetchNFT = async (collection, tokenId, tokenURI = null) => {
  try {
    let jsonFile = tokenURI;

    if (!jsonFile) {
      const collectionMap = tokenMapping[collection];
      if (!collectionMap) {
        throw new Error(`No mapping for collection ${collection}`);
      }

      const mapped = collectionMap[String(tokenId)];
      if (!mapped || !mapped.token_uri) {
        throw new Error(
          `No token_uri mapping for ${collection} tokenId ${tokenId}`
        );
      }

      jsonFile = mapped.token_uri;
    }

    const filePath = path.join(METADATA_JSON_DIR, collection, jsonFile);

    console.log(`Loading metadata: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Metadata file missing: ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(
      "Failed to fetch NFT metadata:",
      collection,
      tokenId,
      tokenURI,
      err.message
    );
    return null;
  }
};

/**
 * Compute round result between two NFT traits
 * traits = [attack, defense, vitality, agility, core]
 */
export function getRoundResult(traits1, traits2) {
  const atk1 = traits1[0] + traits1[3]; // attack + agility
  const def1 = traits1[1] + traits1[2]; // defense + vitality
  const core1 = traits1[4];

  const atk2 = traits2[0] + traits2[3];
  const def2 = traits2[1] + traits2[2];
  const core2 = traits2[4];

  const damage1 = atk2 > def1 ? atk2 - def1 : 0;
  const mod1 = core1 > damage1 ? core1 - damage1 : 0;

  const damage2 = atk1 > def2 ? atk1 - def2 : 0;
  const mod2 = core2 > damage2 ? core2 - damage2 : 0;

  let p1_wins = 0;
  let p2_wins = 0;

  // primary comparison
  if (mod1 > mod2) p1_wins = 1;
  else if (mod2 > mod1) p2_wins = 1;
  else {
    // deterministic tie-breaker: sum of attack+defense+vitality+agility
    const score1 = traits1[0] + traits1[1] + traits1[2] + traits1[3];
    const score2 = traits2[0] + traits2[1] + traits2[2] + traits2[3];

    if (score1 > score2) p1_wins = 1;
    else if (score2 > score1) p2_wins = 1;
    // else exact tie, leave p1_wins = p2_wins = 0
  }

  const round_diff = mod1 - mod2;
  return { p1_wins, p2_wins, round_diff };
}

/**
 * Compute game winner over 3 rounds
 * traits1Arr and traits2Arr are arrays of 3 NFT trait arrays
 */
export function computeWinner(traits1Arr, traits2Arr) {
  let player1Points = 0;
  let player2Points = 0;
  let totalDiff = 0;

  const roundResults = [];

  for (let i = 0; i < 3; i++) {
    const { p1_wins, p2_wins, round_diff } = getRoundResult(
      traits1Arr[i],
      traits2Arr[i]
    );

    player1Points += p1_wins;
    player2Points += p2_wins;
    totalDiff += round_diff;

    roundResults.push({
      round: i + 1,
      winner: p1_wins ? "player1" : p2_wins ? "player2" : "tie",
      diff: round_diff,
    });
  }

  let winner = "tie";
  if (player1Points > player2Points) winner = "player1";
  else if (player2Points > player1Points) winner = "player2";
  else if (totalDiff > 0) winner = "player1";
  else if (totalDiff < 0) winner = "player2";

  return { winner, roundResults };
}

/**
 * Resolve a single game using NFT metadata
 * Populates winner, tie
 */
export async function resolveGame(game) {
  // ---- Basic validation ----
  if (!game.player1 || !game.player2) return null;

  if (!game.player1Reveal || !game.player2Reveal) {
    console.warn("Missing reveal data");
    return null;
  }

  const {
    tokenIds: p1TokenIds,
    nftContracts: p1Contracts,
    tokenURIs: p1Uris,
    backgrounds: p1Backgrounds = [],
  } = game.player1Reveal;

  const {
    tokenIds: p2TokenIds,
    nftContracts: p2Contracts,
    tokenURIs: p2Uris,
    backgrounds: p2Backgrounds = [],
  } = game.player2Reveal;

  const p1XpBonuses = getPlayerXpBonuses(game.player1);
  const p2XpBonuses = getPlayerXpBonuses(game.player2);

  // ---- Hard guard: reveal structure ----
  if (
    !Array.isArray(p1TokenIds) ||
    !Array.isArray(p2TokenIds) ||
    !Array.isArray(p1Contracts) ||
    !Array.isArray(p2Contracts) ||
    !Array.isArray(p1Uris) ||
    !Array.isArray(p2Uris)
  ) {
    throw new Error("Invalid reveal data structure");
  }

  if (
    p1TokenIds.length < 3 ||
    p2TokenIds.length < 3 ||
    p1Contracts.length < 3 ||
    p2Contracts.length < 3
  ) {
    throw new Error("Each player must reveal exactly 3 NFTs");
  }

  console.log("Resolving game:", {
    id: game.id,
    p1Tokens: p1TokenIds,
    p2Tokens: p2TokenIds,
  });

  const traits1 = [];
  const traits2 = [];

  // ---- Trait extraction helper ----
  const extractTraits = (nftData) => {
    const findValue = (name) => {
      const trait = nftData.attributes?.find(
        (a) => a.trait_type?.toLowerCase() === name.toLowerCase()
      );
      return trait ? Number(trait.value) : 0;
    };

    return [
      findValue("Attack"),
      findValue("Defense"),
      findValue("Vitality"),
      findValue("Agility"),
      findValue("CORE"),
    ];
  };

  // ---- Player 1 ----
  for (let i = 0; i < 3; i++) {
    const tokenId = p1TokenIds[i];
    const contractAddr = p1Contracts[i]?.toLowerCase() || "";
    const collection = getCollectionFromContract(contractAddr);

    if (!collection) {
      throw new Error(`Unknown P1 contract address: ${contractAddr}`);
    }

    console.log(`P1 token ${i}: ${collection} ${tokenId}`);

const tokenURI = p1Uris[i] || null;
const nftData = await fetchNFT(collection, tokenId, tokenURI);

    if (!nftData) {
throw new Error(`Missing metadata for P1 token ${tokenId} (${p1Uris[i]}) in ${collection}`);    }

    traits1.push(extractTraits(nftData));
  }

  // ---- Player 2 ----
  for (let i = 0; i < 3; i++) {
    const tokenId = p2TokenIds[i];
    const contractAddr = p2Contracts[i]?.toLowerCase() || "";
    const collection = getCollectionFromContract(contractAddr);

    if (!collection) {
      throw new Error(`Unknown P2 contract address: ${contractAddr}`);
    }

    console.log(`P2 token ${i}: ${collection} ${tokenId}`);

const tokenURI = p2Uris[i] || null;
const nftData = await fetchNFT(collection, tokenId, tokenURI);

    if (!nftData) {
throw new Error(`Missing metadata for P2 token ${tokenId} (${p2Uris[i]}) in ${collection}`);
    }

    traits2.push(extractTraits(nftData));
  }

  // ---- Team faction bonus: +10% attack if all 3 are from same faction ----
  const p1FactionBonus = getTeamFactionBonus(p1Contracts);
  const p2FactionBonus = getTeamFactionBonus(p2Contracts);

let finalTraits1 = applyXpBoostToTraits(traits1, p1XpBonuses);
let finalTraits2 = applyXpBoostToTraits(traits2, p2XpBonuses);

if (p1FactionBonus) {
  console.log(
    `P1 faction bonus applied: ${p1FactionBonus} (+10% attack, rounded up)`
  );
  finalTraits1 = applyAttackBoost(finalTraits1, 10);
}

if (p2FactionBonus) {
  console.log(
    `P2 faction bonus applied: ${p2FactionBonus} (+10% attack, rounded up)`
  );
  finalTraits2 = applyAttackBoost(finalTraits2, 10);
}

  // ---- Compute winner ----
  const { winner, roundResults } = computeWinner(finalTraits1, finalTraits2);

  const winnerAddress =
    winner === "tie"
      ? null
      : winner === "player1"
      ? game.player1
      : game.player2;

  // ---- Persist result ----
  game.roundResults = roundResults;
  game.winner = winnerAddress;
  game.tie = winner === "tie";
  game.settledAt = new Date().toISOString();

  // Optional debugging / UI support
  game.player1FactionBonus = p1FactionBonus;
  game.player2FactionBonus = p2FactionBonus;
  game.player1Traits = finalTraits1;
  game.player2Traits = finalTraits2;
  game.player1XpBonuses = p1XpBonuses;
  game.player2XpBonuses = p2XpBonuses;

  console.log("Game resolved:", {
    gameId: game.id,
    winner: game.winner,
    tie: game.tie,
    rounds: roundResults.length,
    p1FactionBonus,
    p2FactionBonus,
  });

  return game;
}