// backend/routes/auth.js
//
// Sign-in-with-wallet: prove control of a private key once per session
// instead of trusting a self-reported x-wallet header (see authWallet.js).
import express from "express";
import { ethers } from "ethers";
import {
  buildLoginMessage,
  createNonce,
  verifyAndConsumeNonce,
  createSession,
  revokeSession,
} from "../utils/authStore.js";

const router = express.Router();

/* ---------------- STEP 1: REQUEST A NONCE ---------------- */
router.post("/nonce", (req, res) => {
  try {
    const { wallet } = req.body;

    if (!wallet || !ethers.isAddress(wallet)) {
      return res.status(400).json({ error: "Valid wallet address required" });
    }

    const walletLc = wallet.toLowerCase();
    const nonce = createNonce(walletLc);
    const message = buildLoginMessage(walletLc, nonce);

    return res.json({ message });
  } catch (err) {
    console.error("POST /auth/nonce error:", err);
    return res.status(500).json({ error: "Failed to create login nonce" });
  }
});

/* ---------------- STEP 2: VERIFY SIGNATURE, ISSUE SESSION ---------------- */
router.post("/verify", (req, res) => {
  try {
    const { wallet, signature } = req.body;

    if (!wallet || !ethers.isAddress(wallet)) {
      return res.status(400).json({ error: "Valid wallet address required" });
    }

    if (!signature || typeof signature !== "string") {
      return res.status(400).json({ error: "Signature required" });
    }

    const walletLc = wallet.toLowerCase();
    const result = verifyAndConsumeNonce(walletLc, signature);

    if (!result.ok) {
      return res.status(401).json({ error: result.reason || "Signature verification failed" });
    }

    const { token, expiresAt } = createSession(walletLc);

    return res.json({ token, wallet: walletLc, expiresAt });
  } catch (err) {
    console.error("POST /auth/verify error:", err);
    return res.status(500).json({ error: "Failed to verify signature" });
  }
});

/* ---------------- LOGOUT ---------------- */
router.post("/logout", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (token) revokeSession(token);

  return res.json({ success: true });
});

export default router;
