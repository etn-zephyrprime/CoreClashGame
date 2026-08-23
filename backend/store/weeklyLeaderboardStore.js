import fs from "fs";
import path from "path";
import { withLock } from "../utils/mutex.js";
import { readGames } from "./gamesStore.js";
import { ethers } from "ethers";
import { BASE_DATA_DIR } from "../utils/dataDir.js";
import { queueR2Upload } from "../utils/r2Sync.js";

const DATA_DIR = path.join(BASE_DATA_DIR, "leaderboards");
const STORE_FILE = path.join(DATA_DIR, "weeklyLeaderboards.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log("📁 Created weekly leaderboard directory:", DATA_DIR);
  }

  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({}, null, 2), "utf8");
    console.log("🆕 Created weeklyLeaderboards.json:", STORE_FILE);
  }
}

export function readWeeklyLeaderboards() {
  ensureStore();

  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.error("readWeeklyLeaderboards error:", err);
    return {};
  }
}

export function writeWeeklyLeaderboards(data) {
  ensureStore();

  try {
    const tempFile = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempFile, STORE_FILE);
    queueR2Upload(STORE_FILE);
  } catch (err) {
    console.error("writeWeeklyLeaderboards error:", err);
    throw err;
  }
}

export async function saveWeeklyLeaderboard(weekStart, top3) {
  return withLock(async () => {
    const all = readWeeklyLeaderboards();
    all[weekStart] = top3;
    writeWeeklyLeaderboards(all);
    return all;
  });
}

export async function getWeeklyLeaderboardsSorted() {
  return withLock(async () => {
    const leaderboards = readWeeklyLeaderboards();

    return Object.keys(leaderboards)
      .sort((a, b) => new Date(b) - new Date(a))
      .reduce((acc, key) => {
        acc[key] = leaderboards[key];
        return acc;
      }, {});
  });
}

function getWeekStartUTC(dateInput) {
  const d = new Date(dateInput);
  const day = d.getUTCDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;

  d.setUTCDate(d.getUTCDate() + diffToMonday);
  d.setUTCHours(0, 0, 0, 0);

  return d;
}

function buildTop3ForGames(games) {
  const stats = {};

  for (const g of games) {
    const p1 = g.player1?.toLowerCase();
    const p2 = g.player2?.toLowerCase();
    const winner = g.winner?.toLowerCase();
    const isTie = !!g.tie;

    [p1, p2].forEach((player) => {
      if (!player || player === ethers.ZeroAddress.toLowerCase()) return;

      if (!stats[player]) stats[player] = { wins: 0, played: 0 };
      stats[player].played += 1;
    });

    if (!isTie && winner && winner !== ethers.ZeroAddress.toLowerCase()) {
      if (!stats[winner]) stats[winner] = { wins: 0, played: 0 };
      stats[winner].wins += 1;
    }
  }

  return Object.entries(stats)
    .map(([address, data]) => ({
      address,
      wins: data.wins,
      played: data.played,
      winRate: data.played > 0 ? Math.round((data.wins / data.played) * 100) : 0,
    }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.winRate - a.winRate;
    })
    .slice(0, 3);
}

export async function rebuildWeeklyLeaderboardForDate(dateInput) {
  return withLock(async () => {
    const games = readGames();

    const weekStart = getWeekStartUTC(dateInput);
    const weekStartTime = weekStart.getTime();
    const weekEndTime = weekStartTime + 7 * 24 * 60 * 60 * 1000;
    const weekKey = weekStart.toISOString().split("T")[0];

    const weeklyGames = games.filter((g) => {
      if (!g.settled || g.cancelled) return false;

      const resultDate = g.settledAt || g.createdAt || g.date;
      if (!resultDate) return false;

      const t = new Date(resultDate).getTime();
      if (Number.isNaN(t)) return false;

      return t >= weekStartTime && t < weekEndTime;
    });

    const top3 = buildTop3ForGames(weeklyGames);

    const all = readWeeklyLeaderboards();
    all[weekKey] = top3;
    writeWeeklyLeaderboards(all);

    console.log(`✅ Rebuilt weekly leaderboard for ${weekKey}`);
    return { weekKey, top3 };
  });
}

export async function backfillWeeklyLeaderboardsFromGames(weeksToKeep = 7) {
  return withLock(async () => {
    const games = readGames();

    const eligibleGames = games.filter((g) => {
      if (!g.settled || g.cancelled) return false;

      const resultDate = g.settledAt || g.createdAt || g.date;
      if (!resultDate) return false;

      return !Number.isNaN(new Date(resultDate).getTime());
    });

    const buckets = {};

    for (const g of eligibleGames) {
      const resultDate = g.settledAt || g.createdAt || g.date;
      const weekKey = getWeekStartUTC(resultDate).toISOString().split("T")[0];

      if (!buckets[weekKey]) buckets[weekKey] = [];
      buckets[weekKey].push(g);
    }

    const sortedWeeks = Object.keys(buckets)
      .sort((a, b) => new Date(b) - new Date(a))
      .slice(0, weeksToKeep);

    const archive = {};
    for (const week of sortedWeeks) {
      archive[week] = buildTop3ForGames(buckets[week]);
    }

    writeWeeklyLeaderboards(archive);

    console.log(`✅ Backfilled weekly leaderboards for ${sortedWeeks.length} weeks`);
    return archive;
  });
}