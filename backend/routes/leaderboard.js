import express from "express";
import fs from "fs";
import path from "path";

import {
  saveWeeklyLeaderboard,
  getWeeklyLeaderboardsSorted,
} from "../store/weeklyLeaderboardStore.js";
import { BASE_DATA_DIR as DATA_DIR } from "../utils/dataDir.js";

const XP_FILE = path.join(DATA_DIR, "playerXp.json");
const XP_ACTIONS_FILE = path.join(DATA_DIR, "xpActions.json");

const router = express.Router();

// SAVE WEEKLY
router.post("/weekly", async (req, res) => {
  try {
    const { weekStart, top3 } = req.body;

    if (!weekStart || !Array.isArray(top3) || top3.length === 0) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const weekDate = new Date(weekStart).toISOString().split("T")[0];

    await saveWeeklyLeaderboard(weekDate, top3);

    return res.json({ message: "Weekly leaderboard saved" });
  } catch (err) {
    console.error("Error saving weekly leaderboard:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET ALL WEEKS
router.get("/weekly", async (req, res) => {
  try {
    const sortedWeeks = await getWeeklyLeaderboardsSorted();
    return res.json(sortedWeeks);
  } catch (err) {
    console.error("Failed to read weekly leaderboards:", err);
    return res.status(500).json({ error: "Failed to read weekly leaderboards" });
  }
});

router.get("/xp-leaderboard", (req, res) => {
  try {
    const playerXp = fs.existsSync(XP_FILE)
      ? JSON.parse(fs.readFileSync(XP_FILE, "utf8"))
      : {};

    const xpActions = fs.existsSync(XP_ACTIONS_FILE)
      ? JSON.parse(fs.readFileSync(XP_ACTIONS_FILE, "utf8"))
      : {};

    res.json({ playerXp, xpActions });
  } catch (err) {
    console.error("XP leaderboard error:", err);
    res.status(500).json({ error: "Failed to load XP leaderboard" });
  }
});

export default router;