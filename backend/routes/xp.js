import express from "express";
import { authWallet } from "../middleware/authWallet.js";
import {
  ensurePlayer,
  awardDailyLoginXp,
  awardEcosystemClickXp,
  XP_LEVELS,
  readPlayerXp,
  readXpActions,
} from "../utils/playerXp.js";

const router = express.Router();

/* ---------------- GET MY XP PROFILE ---------------- */
router.get("/me", authWallet, (req, res) => {
  try {
    if (!req.wallet) {
      return res.status(401).json({ error: "Wallet not authenticated" });
    }

    const walletLc = req.wallet.toLowerCase();
    const player = ensurePlayer(walletLc);

    const nextLevel = XP_LEVELS.find((lvl) => lvl.minXp > player.xp) || null;

    return res.json({
      wallet: player.wallet,
      xp: player.xp,
      level: player.level,
      statsBonus: player.statsBonus,
      updatedAt: player.updatedAt,
      nextLevelXp: nextLevel ? nextLevel.minXp : null,
      maxLevel: player.level === XP_LEVELS[XP_LEVELS.length - 1].level,
    });
  } catch (err) {
    console.error("GET /xp/me error:", err);
    return res.status(500).json({ error: err.message || "Failed to load XP profile" });
  }
});

/* ---------------- DAILY LOGIN XP ---------------- */
router.post("/login", authWallet, (req, res) => {
  try {
    if (!req.wallet) {
      return res.status(401).json({ error: "Wallet not authenticated" });
    }

    const result = awardDailyLoginXp(req.wallet);

    return res.json({
      success: true,
      awarded: !!result.awarded,
      reason: result.reason || null,
      amount: result.awarded ? result.amount : 0,
      player: result.player || ensurePlayer(req.wallet.toLowerCase()),
    });
  } catch (err) {
    console.error("POST /xp/login error:", err);
    return res.status(500).json({ error: err.message || "Failed to process login XP" });
  }
});

/* ---------------- ECOSYSTEM LINK CLICK XP ---------------- */
router.post("/ecosystem-click", authWallet, (req, res) => {
  try {
    if (!req.wallet) {
      return res.status(401).json({ error: "Wallet not authenticated" });
    }

    const { linkKey } = req.body;

    if (!linkKey || typeof linkKey !== "string") {
      return res.status(400).json({ error: "Missing or invalid linkKey" });
    }

    // Keep this list aligned with the actual links you show in the frontend
    const allowedLinks = [
      "vkin",
      "vqle",
      "scions",
      "electroswap",
      "website",
      "sponsoredad1",
    ];

    const normalizedLinkKey = linkKey.trim().toLowerCase();

    if (!allowedLinks.includes(normalizedLinkKey)) {
      return res.status(400).json({ error: "Invalid ecosystem link" });
    }

    const result = awardEcosystemClickXp(req.wallet, normalizedLinkKey);

    return res.json({
      success: true,
      awarded: !!result.awarded,
      reason: result.reason || null,
      linkKey: normalizedLinkKey,
      amount: result.awarded ? result.amount : 0,
      player: result.player || ensurePlayer(req.wallet.toLowerCase()),
    });
  } catch (err) {
    console.error("POST /xp/ecosystem-click error:", err);
    return res.status(500).json({ error: err.message || "Failed to process ecosystem XP" });
  }
});

/* ---------------- DEBUG ALL XP DATA ---------------- */
router.get("/debug/all", (req, res) => {
  try {
    const wallet = req.query.wallet?.toLowerCase();
    const type = req.query.type?.toLowerCase(); 
    // type options: playerxp, xpactions, ecosystemclicks

    const playerXp = readPlayerXp();
    const xpActions = readXpActions();

    const filterByWallet = (data) => {
      if (!wallet) return data;

      return Object.fromEntries(
        Object.entries(data).filter(([address, value]) => {
          return (
            address.toLowerCase() === wallet ||
            value?.wallet?.toLowerCase?.() === wallet
          );
        })
      );
    };

    const filteredPlayerXp = filterByWallet(playerXp);
    const filteredXpActions = filterByWallet(xpActions);

    if (type === "playerxp") {
      return res.json({
        playerXp: filteredPlayerXp,
      });
    }

    if (type === "xpactions") {
      return res.json({
        xpActions: filteredXpActions,
      });
    }

    if (type === "ecosystemclicks") {
      const ecosystemClicks = Object.fromEntries(
        Object.entries(filteredXpActions).map(([address, data]) => [
          address,
          data.ecosystemClicks || {},
        ])
      );

      return res.json({
        ecosystemClicks,
      });
    }

    return res.json({
      playerXp: filteredPlayerXp,
      xpActions: filteredXpActions,
    });
  } catch (err) {
    console.error("GET /xp/debug/all error:", err);
    return res.status(500).json({
      error: err.message || "Failed to load XP debug data",
    });
  }
});

export default router;