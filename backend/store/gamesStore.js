import fs from "fs";
import path from "path";
import { withLock } from "../utils/mutex.js";
import { BASE_DATA_DIR } from "../utils/dataDir.js";
import { queueR2Upload } from "../utils/r2Sync.js";

const DATA_DIR = path.join(BASE_DATA_DIR, "games");
const GAMES_FILE = path.join(DATA_DIR, "games.json");

function ensureGamesStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log("📁 Created games data directory:", DATA_DIR);
  }

  if (!fs.existsSync(GAMES_FILE)) {
    fs.writeFileSync(GAMES_FILE, "[]", "utf8");
    console.log("🆕 Created games.json:", GAMES_FILE);
  }
}

export function readGames() {
  ensureGamesStore();

  try {
    const raw = fs.readFileSync(GAMES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to read games:", err.message);
    return [];
  }
}

export function writeGames(games) {
  ensureGamesStore();

  try {
    const tempFile = `${GAMES_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(games, null, 2), "utf8");
    fs.renameSync(tempFile, GAMES_FILE);
    queueR2Upload(GAMES_FILE);
    console.log(`💾 Wrote ${games.length} games to:`, GAMES_FILE);
  } catch (err) {
    console.error("Failed to write games:", err.message);
    throw err;
  }
}

export async function updateGames(mutator) {
  return withLock(async () => {
    const games = readGames();
    const result = await mutator(games);
    writeGames(games);
    return result;
  });
}

export default { readGames, writeGames, updateGames };