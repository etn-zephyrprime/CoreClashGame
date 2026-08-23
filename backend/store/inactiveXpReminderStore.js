// backend/store/inactiveXpReminderStore.js
import fs from "fs";
import path from "path";
import { BASE_DATA_DIR } from "../utils/dataDir.js";
import { queueR2Upload } from "../utils/r2Sync.js";

const FILE = path.join(BASE_DATA_DIR, "inactiveXpReminders.json");

const DEFAULT_STATE = {
  lastRunAt: null,
  wallets: {},
};

export function readInactiveXpReminderState() {
  try {
    if (!fs.existsSync(FILE)) return { ...DEFAULT_STATE };
    return {
      ...DEFAULT_STATE,
      ...JSON.parse(fs.readFileSync(FILE, "utf8")),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeInactiveXpReminderState(state) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  queueR2Upload(FILE);
}