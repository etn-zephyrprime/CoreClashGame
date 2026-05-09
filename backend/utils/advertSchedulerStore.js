// backend/store/advertSchedulerStore.js
import fs from "fs";
import path from "path";

const BASE_DATA_DIR =
  process.env.DATA_DIR ||
  process.env.RENDER_DISK_PATH ||
  "/backend/data";

const FILE = path.join(BASE_DATA_DIR, "advertScheduler.json");

const DEFAULT_STATE = {
  firstStartupSent: false,
  scheduleDate: null,
  dailyQueue: [],
  lastSentAt: null,
  lastSentIndex: null,
};

export function readAdvertState() {
  try {
    if (!fs.existsSync(FILE)) {
      return { ...DEFAULT_STATE };
    }

    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);

    return {
      ...DEFAULT_STATE,
      ...parsed,
      dailyQueue: Array.isArray(parsed.dailyQueue)
        ? parsed.dailyQueue
        : [],
    };
  } catch (err) {
    console.error("[ADVERT STORE] Failed to read advert state:", err.message);
    return { ...DEFAULT_STATE };
  }
}

export function writeAdvertState(state) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });

    const nextState = {
      ...DEFAULT_STATE,
      ...state,
      dailyQueue: Array.isArray(state?.dailyQueue)
        ? state.dailyQueue
        : [],
    };

    fs.writeFileSync(FILE, JSON.stringify(nextState, null, 2));
    return nextState;
  } catch (err) {
    console.error("[ADVERT STORE] Failed to write advert state:", err.message);
    throw err;
  }
}

export function resetAdvertState() {
  writeAdvertState({ ...DEFAULT_STATE });
}

export function getAdvertStateFilePath() {
  return FILE;
}