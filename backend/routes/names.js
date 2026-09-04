// backend/routes/names.js
//
// Public batch wallet -> Electroneum Name Service display-name resolution, for the frontend
// (leaderboards, game history, the connected-wallet display) to show a player's ENS-style name
// instead of a raw address, same as the Telegram bots already do via utils/telegramBot.js's own
// resolveWallet. One shared resolver instance so its defaultResolver() lookup is fetched once for
// the life of the process, not once per request — see utils/primaryNameResolver.js.
import express from "express";
import { ethers } from "ethers";
import { RPC_URL, REVERSE_REGISTRAR_ADDRESS } from "../config.js";
import { createPrimaryNameResolver } from "../utils/primaryNameResolver.js";

const router = express.Router();

const resolveWallet = createPrimaryNameResolver(
  new ethers.JsonRpcProvider(RPC_URL),
  REVERSE_REGISTRAR_ADDRESS
);

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

// Read-only, no auth needed (same posture as GET /games) — this only ever returns publicly
// resolvable on-chain name data or a shortened form of the address the caller already sent.
// Capped so one request can't fan out into an unbounded number of RPC calls.
const MAX_ADDRESSES = 200;

router.get("/resolve", async (req, res) => {
  try {
    const raw = String(req.query.addresses || "");
    const addresses = raw
      .split(",")
      .map((a) => a.trim())
      .filter((a) => ADDRESS_RE.test(a));

    if (addresses.length === 0) {
      return res.json({});
    }

    if (addresses.length > MAX_ADDRESSES) {
      return res.status(400).json({ error: `Too many addresses (max ${MAX_ADDRESSES})` });
    }

    const names = await resolveWallet.resolveMany(addresses);

    res.setHeader("Cache-Control", "public, max-age=300"); // names change rarely; light client/CDN caching is fine
    return res.json(names);
  } catch (err) {
    console.error("GET /names/resolve error:", err);
    return res.status(500).json({ error: "Failed to resolve names" });
  }
});

export default router;
