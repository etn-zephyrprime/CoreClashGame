export function deriveWinnerFromRoundResults(game) {
  const rounds = Array.isArray(game.roundResults) ? game.roundResults : [];

  const p1Wins = rounds.filter(r => r.winner === "player1").length;
  const p2Wins = rounds.filter(r => r.winner === "player2").length;

  if (p1Wins > p2Wins) {
    return { winner: game.player1?.toLowerCase(), tie: false };
  }

  if (p2Wins > p1Wins) {
    return { winner: game.player2?.toLowerCase(), tie: false };
  }

  return { winner: null, tie: true };
}