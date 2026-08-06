// backend/middleware/authGame.js
//
// Authorization checks that run *after* authWallet has proven req.wallet
// is genuinely controlled by the caller. These decide whether that wallet
// is allowed to act on a given game (participant) or perform ops actions
// (admin) — authWallet alone only proves identity, not permission.
import { readGames } from "../store/gamesStore.js";
import { ADMIN_ADDRESS } from "../config.js";

function loadGameOr404(req, res) {
  const gameId = Number(req.params.id);

  if (!Number.isInteger(gameId)) {
    res.status(400).json({ error: "Invalid game ID" });
    return null;
  }

  const games = readGames();
  const game = games.find((g) => g.id === gameId);

  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return null;
  }

  return game;
}

/**
 * Requires req.wallet to be player1, player2, or the admin wallet on the
 * game referenced by :id. Use for actions a player should be able to
 * drive for their own match (reveal follow-ups, settlement) without
 * opening them up to arbitrary third parties / gas-griefing.
 */
export function requireGameParticipant(req, res, next) {
  const game = loadGameOr404(req, res);
  if (!game) return;

  const walletLc = req.wallet;
  const p1 = game.player1?.toLowerCase();
  const p2 = game.player2?.toLowerCase();

  if (walletLc === p1 || walletLc === p2 || walletLc === ADMIN_ADDRESS) {
    return next();
  }

  return res.status(403).json({ error: "Not a participant in this game" });
}

/**
 * Requires req.wallet to be the game's creator (player1) or the admin
 * wallet. Use for creator-only actions like cancelling an unjoined game.
 */
export function requireGameCreatorOrAdmin(req, res, next) {
  const game = loadGameOr404(req, res);
  if (!game) return;

  const walletLc = req.wallet;
  const p1 = game.player1?.toLowerCase();

  if (walletLc === p1 || walletLc === ADMIN_ADDRESS) {
    return next();
  }

  return res.status(403).json({ error: "Only the game creator or an admin can do this" });
}

/** Requires req.wallet to be the configured admin wallet. */
export function requireAdmin(req, res, next) {
  if (req.wallet === ADMIN_ADDRESS) {
    return next();
  }

  return res.status(403).json({ error: "Admin only" });
}
