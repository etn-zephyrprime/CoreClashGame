import { keccak256, toUtf8Bytes } from "ethers";

/**
 * Creates a deterministic commitment hash for a team.
 *
 * NOTE: unused elsewhere in the codebase today (the actual on-chain
 * commit/reveal hash is computed inline in backend/routes/games.js using
 * ethers.solidityPacked over [salt, nftContracts, tokenIds], matching the
 * game contract's own hash — this function used a different, JSON-based
 * payload and was never wired up to it). Previously this also could not
 * have run even if called: `const { keccak256, toUtf8Bytes } = "ethers";`
 * destructured a string literal instead of importing the module, so
 * makeTeamCommitment() would have thrown immediately. Fixed the import;
 * left the function here in case it's intended for a future use, but it
 * is not currently part of the reveal-verification path.
 */
export function makeTeamCommitment({
  gameId,
  player,
  teamData
}) {
  const normalized = teamData.map(t => ({
    tokenId: t.tokenId.toString(),
    character: t.metadata?.name || `Token ${t.tokenId}`,
    background: t.metadata?.background || "Unknown",
    traits: t.metadata?.traits?.map(Number) || [0, 0, 0, 0, 0]
  }));

  const payload = JSON.stringify({
    gameId,
    player: player.toLowerCase(),
    team: normalized
  });

  return keccak256(toUtf8Bytes(payload));
}
