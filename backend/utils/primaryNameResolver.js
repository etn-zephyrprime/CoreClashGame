// backend/utils/primaryNameResolver.js
//
// Ported from ETNSubdomainService/backend/utils/primaryNameResolver.js — resolves a wallet's
// primary ("reverse") ENS-style name via ReverseRegistrar + the resolver it points to.
// Centralized there (and here) rather than reimplemented per call site specifically because
// getting this exact lookup wrong already caused two real production bugs in that codebase: both
// traced back to re-fetching defaultResolver() redundantly per-address under concurrency, which
// Ankr's public RPC rejects as too large a batch. Keep this file's logic in sync with the
// original if you change one — see that file's header comment for the fuller history.
import { ethers } from "ethers";

const REVERSE_REGISTRAR_ABI = [
  "function node(address addr) view returns (bytes32)",
  "function defaultResolver() view returns (address)",
];
const RESOLVER_ABI = ["function name(bytes32 node) view returns (string)"];

export function shortAddress(address) {
  if (!address) return "Unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Returns an async `resolveDisplayName(addr) -> string` bound to one ReverseRegistrar. Always
 * resolves to a displayable string — the wallet's primary name if it has one set, otherwise
 * `shortAddress(addr)`.
 *
 * `defaultResolver()` is a single global value (not address-dependent) that effectively never
 * changes, so it's fetched once and cached for the life of the process. A failed fetch clears the
 * cache so the next call retries rather than failing forever.
 */
export function createPrimaryNameResolver(provider, reverseRegistrarAddress) {
  const reverseRegistrar = new ethers.Contract(reverseRegistrarAddress, REVERSE_REGISTRAR_ABI, provider);
  let resolverPromise = null;

  function getResolver() {
    if (!resolverPromise) {
      resolverPromise = reverseRegistrar
        .defaultResolver()
        .then((addr) => (addr === ethers.ZeroAddress ? null : new ethers.Contract(addr, RESOLVER_ABI, provider)))
        .catch((err) => {
          resolverPromise = null; // let the next call retry instead of caching a failure forever
          throw err;
        });
    }
    return resolverPromise;
  }

  async function resolveDisplayName(addr) {
    try {
      const resolver = await getResolver();
      if (!resolver) return shortAddress(addr);
      const node = await reverseRegistrar.node(addr);
      const name = await resolver.name(node);
      return name || shortAddress(addr);
    } catch (err) {
      console.warn(`⚠️  Failed to resolve primary name for ${addr}:`, err.message);
      return shortAddress(addr);
    }
  }

  // Resolves many addresses at once — the leaderboard/game-list use case this file adds on top
  // of the ported single-address resolver above (the Telegram bots that originated this file
  // only ever resolve one or two addresses per event, so they never needed this). Runs
  // concurrently — getResolver()'s own caching keeps that from re-fetching defaultResolver() per
  // address, the exact bug this file's header warns about — and de-dupes repeated addresses in
  // the input so a leaderboard with the same wallet in multiple rows doesn't resolve it twice.
  // Attached to the returned function (rather than changing what createPrimaryNameResolver
  // returns) so every existing single-address call site — ported verbatim from
  // ETNSubdomainService — keeps working exactly as `const resolveDisplayName =
  // createPrimaryNameResolver(provider, addr)` expects.
  resolveDisplayName.resolveMany = async function resolveMany(addrs) {
    const unique = [...new Set(addrs.filter(Boolean).map((a) => a.toLowerCase()))];
    const results = await Promise.all(unique.map((addr) => resolveDisplayName(addr)));

    const out = {};
    unique.forEach((addr, i) => {
      out[addr] = results[i];
    });
    return out;
  };

  return resolveDisplayName;
}
