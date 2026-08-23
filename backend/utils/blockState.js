// backend/utils/blockState.js
import fs from "fs";
import path from "path";
import { withLock } from "./mutex.js";
import { BASE_DATA_DIR } from "./dataDir.js";
import { queueR2Upload } from "./r2Sync.js";

const DATA_DIR = path.join(BASE_DATA_DIR, "state");
const STATE_FILE = path.join(DATA_DIR, "lastBlock.json");

function ensureStateDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStateFile() {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};

    const raw = fs.readFileSync(STATE_FILE, "utf8");
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.error("loadStateFile error:", err);
    return {};
  }
}

function saveStateFile(state) {
  try {
    ensureStateDir();

    const tempFile = `${STATE_FILE}.tmp`;
    fs.writeFileSync(
      tempFile,
      JSON.stringify(state, null, 2),
      "utf8"
    );
    fs.renameSync(tempFile, STATE_FILE);
    queueR2Upload(STATE_FILE);
  } catch (err) {
    console.error("saveStateFile error:", err);
    throw err;
  }
}

export function loadLastBlock(key = "lastBlock") {
  const state = loadStateFile();
  return state[key] ?? null;
}

export function saveLastBlock(key = "lastBlock", block) {
  const state = loadStateFile();
  state[key] = block;
  saveStateFile(state);
}

export async function loadLastBlockLocked(key = "lastBlock") {
  return withLock(async () => {
    return loadLastBlock(key);
  });
}

export async function saveLastBlockLocked(key = "lastBlock", block) {
  return withLock(async () => {
    saveLastBlock(key, block);
    return block;
  });
}