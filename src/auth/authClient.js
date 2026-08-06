// src/auth/authClient.js
//
// Sign-in-with-wallet client. Replaces the old pattern of sending
// "x-wallet": account.toLowerCase() as if it were proof of identity —
// it wasn't; anyone could set that header to any address. Instead we
// get the wallet to sign a one-time server-issued nonce and exchange
// that signature for a short-lived session token, then send the token
// as a normal Authorization: Bearer header.
import { BACKEND_URL } from "../config.js";

// In-memory session cache: walletLc -> { token, expiresAt }
const sessions = new Map();

const SAFETY_MARGIN_MS = 60 * 1000; // treat tokens as expired 1 min early

function isUsable(session) {
  return !!session && session.expiresAt - SAFETY_MARGIN_MS > Date.now();
}

/**
 * Ensures we hold a valid session token for `wallet`, prompting a wallet
 * signature (via `signer`) if we don't have one cached yet or it expired.
 * Returns the bearer token string.
 */
export async function ensureSession(wallet, signer) {
  if (!wallet) throw new Error("Wallet required for sign-in");
  if (!signer) throw new Error("Signer required for sign-in");

  const walletLc = wallet.toLowerCase();
  const cached = sessions.get(walletLc);

  if (isUsable(cached)) {
    return cached.token;
  }

  const nonceRes = await fetch(`${BACKEND_URL}/auth/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: walletLc }),
  });

  if (!nonceRes.ok) {
    throw new Error("Failed to start sign-in (nonce request failed)");
  }

  const { message } = await nonceRes.json();
  const signature = await signer.signMessage(message);

  const verifyRes = await fetch(`${BACKEND_URL}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: walletLc, signature }),
  });

  if (!verifyRes.ok) {
    const body = await verifyRes.json().catch(() => ({}));
    throw new Error(body.error || "Sign-in failed");
  }

  const { token, expiresAt } = await verifyRes.json();
  sessions.set(walletLc, { token, expiresAt });

  return token;
}

export function clearSession(wallet) {
  if (wallet) sessions.delete(wallet.toLowerCase());
}

/**
 * fetch() wrapper that attaches "Authorization: Bearer <token>",
 * signing in first if needed. Use this for any endpoint that requires
 * authWallet on the backend (reveal, XP actions, etc).
 */
export async function authFetch(url, options = {}, wallet, signer) {
  const token = await ensureSession(wallet, signer);

  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(url, { ...options, headers });

  // Session may have been invalidated server-side (restart, manual revoke).
  // Retry once with a fresh sign-in rather than surfacing a confusing 401.
  if (res.status === 401) {
    clearSession(wallet);
    const freshToken = await ensureSession(wallet, signer);

    return fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${freshToken}` },
    });
  }

  return res;
}
