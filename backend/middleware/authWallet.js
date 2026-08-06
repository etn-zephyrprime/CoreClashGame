import { getSession } from "../utils/authStore.js";

/**
 * Requires a valid session token proving the caller signed a login
 * challenge with the wallet's private key (see routes/auth.js).
 *
 * Sets req.wallet to the authenticated (lowercased) wallet address.
 *
 * NOTE: this used to trust a self-reported `x-wallet` / `x-address`
 * header or `req.body.player` with no proof of key ownership at all —
 * that allowed anyone to impersonate any wallet. Do not reintroduce
 * that shortcut.
 */
export function authWallet(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

    if (!token) {
      return res.status(401).json({ error: "Missing session token. Sign in via /auth/nonce + /auth/verify." });
    }

    const session = getSession(token);

    if (!session) {
      return res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
    }

    req.wallet = session.walletLc;
    next();
  } catch (err) {
    console.error("authWallet error:", err);
    return res.status(401).json({ error: "Wallet authentication failed" });
  }
}
