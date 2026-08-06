// backend/utils/authStore.js
//
// Lightweight sign-in-with-wallet session store. No new dependencies:
// nonces + session tokens are opaque random values held in memory, and
// wallet identity is proven with ethers' standard personal_sign recovery.
//
// This is intentionally in-memory (not persisted to games.json/disk):
// a server restart just forces players to re-sign, which is cheap and
// avoids ever writing session secrets to disk.

import crypto from "crypto";
import { ethers } from "ethers";

const NONCE_TTL_MS = 5 * 60 * 1000;       // 5 minutes to complete a sign-in
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hour session

const nonces = new Map();   // walletLc -> { nonce, expiresAt }
const sessions = new Map(); // token -> { walletLc, expiresAt }

function now() {
  return Date.now();
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Build the exact message the wallet is asked to sign. Binding the
 * domain + purpose + nonce prevents this signature from being replayed
 * against a different site or a different login attempt.
 */
export function buildLoginMessage(walletLc, nonce) {
  return (
    `CoreClash login\n` +
    `Wallet: ${walletLc}\n` +
    `Nonce: ${nonce}\n` +
    `This signature only proves wallet ownership and does not authorize any transaction.`
  );
}

export function createNonce(walletLc) {
  const nonce = randomToken(16);
  nonces.set(walletLc, { nonce, expiresAt: now() + NONCE_TTL_MS });
  return nonce;
}

/**
 * Verifies `signature` was produced by `walletLc` signing the nonce
 * message issued for that wallet. Single-use: the nonce is consumed
 * (deleted) whether verification succeeds or fails.
 */
export function verifyAndConsumeNonce(walletLc, signature) {
  const entry = nonces.get(walletLc);
  nonces.delete(walletLc);

  if (!entry) return { ok: false, reason: "No pending login for this wallet" };
  if (entry.expiresAt < now()) return { ok: false, reason: "Nonce expired" };

  const message = buildLoginMessage(walletLc, entry.nonce);

  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return { ok: false, reason: "Malformed signature" };
  }

  if (recovered.toLowerCase() !== walletLc) {
    return { ok: false, reason: "Signature does not match wallet" };
  }

  return { ok: true };
}

export function createSession(walletLc) {
  const token = randomToken(32);
  const expiresAt = now() + SESSION_TTL_MS;
  sessions.set(token, { walletLc, expiresAt });
  return { token, expiresAt };
}

export function getSession(token) {
  const entry = sessions.get(token);
  if (!entry) return null;

  if (entry.expiresAt < now()) {
    sessions.delete(token);
    return null;
  }

  return entry;
}

export function revokeSession(token) {
  sessions.delete(token);
}

// Periodically sweep expired entries so these maps don't grow unbounded.
setInterval(() => {
  const t = now();

  for (const [wallet, entry] of nonces) {
    if (entry.expiresAt < t) nonces.delete(wallet);
  }

  for (const [token, entry] of sessions) {
    if (entry.expiresAt < t) sessions.delete(token);
  }
}, 10 * 60 * 1000).unref();
