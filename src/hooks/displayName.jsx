// src/hooks/displayName.jsx
//
// Resolves a wallet address to its Electroneum Name Service primary name (via the backend's
// GET /names/resolve, see backend/routes/names.js), falling back to a shortened address while
// resolving or if the wallet has none set. Same "name, falling back to short address" contract
// the backend's Telegram bots already use (utils/telegramBot.js's resolveWallet).
//
// One module-level cache + a short debounce window batches every <DisplayName> on screen at once
// (a leaderboard with 50 rows fires exactly one request for whatever addresses aren't already
// cached) instead of one request per row — the same "don't fan out per-address" caution
// ETNSubdomainService's primaryNameResolver.js warns is easy to get wrong.
import { useEffect, useState } from "react";
import { BACKEND_URL } from "../config.js";

const cache = new Map(); // lowercase address -> resolved display name
let pending = new Set();
let flushTimer = null;
let listeners = new Set(); // components waiting on the next flush to re-render

function shortAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function flush() {
  const addresses = [...pending];
  pending = new Set();
  flushTimer = null;

  if (addresses.length === 0) return;

  try {
    const res = await fetch(
      `${BACKEND_URL}/names/resolve?addresses=${addresses.join(",")}`
    );
    const data = await res.json();
    for (const addr of addresses) {
      cache.set(addr, data?.[addr] || shortAddress(addr));
    }
  } catch (err) {
    console.error("Failed to resolve display names:", err);
    for (const addr of addresses) {
      if (!cache.has(addr)) cache.set(addr, shortAddress(addr));
    }
  }

  listeners.forEach((fn) => fn());
}

function scheduleResolve(address) {
  if (cache.has(address) || pending.has(address)) return;
  pending.add(address);
  if (!flushTimer) flushTimer = setTimeout(flush, 50);
}

/** Returns the wallet's resolved display name (or a shortened address while resolving / if it
 * has none set). Safe to call from many components at once for the same or different addresses —
 * they all share the one cache and one batched request. */
export function useDisplayName(address) {
  const lc = address ? address.toLowerCase() : null;
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!lc || cache.has(lc)) return;

    scheduleResolve(lc);
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, [lc]);

  if (!lc) return "";
  return cache.get(lc) || shortAddress(address);
}

/** Drop-in replacement for `{addr.slice(0,6)}...{addr.slice(-4)}` — renders the resolved name
 * once available, the shortened address until then. */
export function DisplayName({ address }) {
  return useDisplayName(address);
}
