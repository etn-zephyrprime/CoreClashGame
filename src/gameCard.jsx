import { ethers } from "ethers";
import React, { useEffect, useState } from "react";
import mapping from "./mapping.json"; // Frontend mapping
import { BACKEND_URL, ADMIN_ADDRESS } from "./config.js"

const addressToCollection = {
  "0x3fc7665b1f6033ff901405cddf31c2e04b8a2ab4": "VKIN",
  "0x3FC7665B1F6033FF901405CdDF31C2E04B8A2AB4": "VKIN",
  "0x8cfbb04c54d35e2e8471ad9040d40d73c08136f0": "VQLE",
  "0x8cFBB04c54d35e2e8471Ad9040D40D73C08136f0": "VQLE",
  "0xAc620b1A3dE23F4EB0A69663613baBf73F6C535D": "SCIONS",
  "0xac620b1a3de23f4eb0a69663613babf73f6c535d": "SCIONS",
  "0x5C81a5609EaeEF7962F1D089D6343F9790387901": "EVG",
  "0x5c81a5609eaeef7962f1d089d6343f9790387901": "EVG",
  // add more if needed
};

const COLLECTION_IMAGE_FORMATS = {
  EVG: "webp",
  SCIONS: "png",
  VQLE: "png",
  VKIN: "png",
};

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

/* ---------------- Stable Image Component ---------------- */
export const StableImage = ({ src, alt }) => {
  const [status, setStatus] = React.useState('loading');

  React.useEffect(() => {
    setStatus('loading');
  }, [src]);

  return (
    <div style={{ 
      position: 'relative', 
      width: 80, 
      height: 120,           // fixed size
      background: '#111',
      borderRadius: 6,
      overflow: 'hidden',
      border: '1px solid #333',
    }}>
      <img
        src={src}
        alt={alt}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',               // keep fill + crop
          objectPosition: 'top center',     // ← CHANGED: prioritize top/head area
          opacity: status === 'success' ? 1 : 0.4,
          transition: 'opacity 0.2s ease',
        }}
        onLoad={() => setStatus('success')}
        onError={() => setStatus('error')}
      />
      {status !== 'success' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(17, 17, 17, 0.7)',
            color: status === 'error' ? '#ff5555' : '#888',
            fontSize: 24,
            borderRadius: 6,
          }}
        >
          {status === 'error' ? '×' : '...'}
        </div>
      )}
    </div>
  );
};

/* ---------------- GameCard Component ---------------- */
export default function GameCard({
  g,
  account,
  signer,
  approveTokens,
  joinGame,
  manualSettleGame,
  handleRevealFile,
  cancelUnjoinedGame,
  roundResults = [],
  downloadRevealBackup,
}) {
const safeAccount = account?.toLowerCase() || null;
const safePlayer1 = g.player1?.toLowerCase() || null;
const safePlayer2 = g.player2?.toLowerCase() || null;
const zero = ethers.ZeroAddress.toLowerCase();

const isPlayer1 = !!safeAccount && safePlayer1 === safeAccount;
const isPlayer2 = !!safeAccount && safePlayer2 === safeAccount;

const isAdmin =
  !!safeAccount &&
  !!ADMIN_ADDRESS &&
  safeAccount === ADMIN_ADDRESS.toLowerCase();

const canManualSettleUser = isAdmin || isPlayer1 || isPlayer2;

const isTrue = (v) => v === true || v === "true";

const isSettled = isTrue(g.settled);
const isCancelled = isTrue(g.cancelled);

const hasPlayer2 = !!safePlayer2 && safePlayer2 !== zero;
const isPlayer2Empty = !hasPlayer2;

// Better reveal detection
const p1Revealed = 
  !!(g.player1Reveal?.tokenIds?.length) || 
  isTrue(g.backendPlayer1Revealed) || 
  isTrue(g.player1Revealed);

const p2Revealed = 
  !!(g.player2Reveal?.tokenIds?.length) || 
  isTrue(g.backendPlayer2Revealed) || 
  isTrue(g.player2Revealed);

const bothRevealed = p1Revealed && p2Revealed;

const isPreJoinCancelled =
  isCancelled && !hasPlayer2;

const backupExists = (() => {
  try {
    if (!account || !g?.id) return false;

    const prefix = `${account.toLowerCase()}_${g.id}`;
    const salt = localStorage.getItem(`${prefix}_salt`);
    const nftContracts = localStorage.getItem(`${prefix}_nftContracts`);
    const tokenIds = localStorage.getItem(`${prefix}_tokenIds`);
    return !!salt && !!nftContracts && !!tokenIds;
  } catch (err) {
    console.warn("backupExists localStorage check failed:", err);
    return false;
  }
})();

// ---------- Game Status Logic ----------
function getGameStatus(g) {
  const isTrue = (v) => v === true || v === "true";
  
  // More reliable reveal detection
  const p1Revealed = 
    !!(g.player1Reveal?.tokenIds?.length) || 
    isTrue(g.backendPlayer1Revealed) || 
    isTrue(g.player1Revealed);

  const p2Revealed = 
    !!(g.player2Reveal?.tokenIds?.length) || 
    isTrue(g.backendPlayer2Revealed) || 
    isTrue(g.player2Revealed);

  const missedRevealDeadline =
    isTrue(g.settled) &&
    isTrue(g.cancelled) &&
    (!p1Revealed || !p2Revealed);

  if (missedRevealDeadline) {
    return {
      label: "🔗 Settled - Missing Reveal(s)",
      color: "#ff9f43",
      link: g.settleTxHash
        ? `https://blockexplorer.electroneum.com/tx/${g.settleTxHash}`
        : undefined,
    };
  }

  if (isTrue(g.cancelled)) {
    return { label: "Cancelled", color: "#ff4444" };
  }

  if (isTrue(g.settled)) {
    return {
      label: "🔗 Settled On-Chain",
      color: "#18bb1a",
      link: g.settleTxHash
        ? `https://blockexplorer.electroneum.com/tx/${g.settleTxHash}`
        : undefined,
    };
  }

  if (
    g.player1 &&
    (!g.player2 || g.player2 === ethers.ZeroAddress)
  ) {
    return { label: "⏳ Waiting for Opponent", color: "#f0b90b" };
  }

  // Improved "Awaiting Reveals" check
  if (
    g.player1 &&
    g.player2 &&
    g.player2 !== ethers.ZeroAddress &&
    (!p1Revealed || !p2Revealed)
  ) {
    return { label: "⏳ Awaiting Reveals", color: "#888" };
  }

  if (g.roundResults && g.roundResults.length > 0 && !g.backendWinner) {
    return { label: "Winner Ready to Post", color: "#4da3ff" };
  }

  if (g.backendWinner && !g.settled) {
    return { label: "Winner Posted — Settling...", color: "#ff9800" };
  }

  return { label: "In Progress", color: "#888" };
}

// Ensure stake is treated as wei (already stored in wei)
const rawStake = g.stakeAmount || "0";

// sanity check: reject suspiciously small values
if (BigInt(rawStake) < 10n ** 10n) {
  console.warn("⚠️ stakeAmount looks like human value, not wei:", rawStake);
}

const stakeWei = BigInt(rawStake);

// Compute totals (WEI-SAFE)
const totalPotWei = stakeWei * 2n;

// 1% burn
const burnPercent = 1;
const burnWei = (totalPotWei * BigInt(burnPercent)) / 100n;

// 🔽 Keep original const names (formatted for UI)\
const stakeAmount = ethers.formatUnits(stakeWei, 18);
const totalPot = ethers.formatUnits(totalPotWei, 18);
const burnAmount = ethers.formatUnits(burnWei, 18);
const hasStakeAmount = stakeAmount !== undefined && stakeAmount !== null && stakeAmount !== "";
const displayStake = hasStakeAmount ? Number(stakeAmount) : null;

const formatTokenAmount = (value) => {
  if (value === null || value === undefined) return "0";

  const n = Number(value);

  if (Number.isNaN(n)) return "0";

  return Number.isInteger(n)
    ? n.toLocaleString()
    : Number(n.toFixed(2)).toLocaleString();
};

/* ----- Deadline Calculation ----- */
const joinedTs = g.player2JoinedAt ? Date.parse(g.player2JoinedAt) : NaN;

const revealDeadlineTs = Number.isFinite(joinedTs)
  ? joinedTs + FIVE_DAYS_MS
  : null;

const [now, setNow] = useState(Date.now());

const revealDeadlinePassed =
  revealDeadlineTs !== null ? now >= revealDeadlineTs : false;

const timeRemaining =
  revealDeadlineTs !== null ? Math.max(revealDeadlineTs - now, 0) : 0;
  
const canManualSettle =
  revealDeadlinePassed &&
  !bothRevealed &&
  !isSettled &&
  !isCancelled &&
  canManualSettleUser;

useEffect(() => {
  const timer = setInterval(() => {
    setNow(Date.now());
  }, 1000);

  return () => clearInterval(timer);
}, []);

function formatTimeRemaining(ms) {
  if (ms <= 0) return "00d 00h 00m 00s";

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(days).padStart(2, "0")}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

  /* --------- GAME STATES --------- */
const canJoin =
  isPlayer2Empty &&
  !isPlayer1 &&
  !isPlayer2 &&
  !isCancelled &&
  !isSettled &&
  !!safeAccount;

  const canSettle = bothRevealed && !isSettled && !isCancelled;
  const status = getGameStatus(g);
  const BadgeWrapper = status.link ? "a" : "div";

const isMissedRevealSettled =
  isSettled &&
  isCancelled &&
  hasPlayer2 &&
  (!p1Revealed || !p2Revealed);
  
const showTeamsSection =
  bothRevealed || isMissedRevealSettled;

// UI-only winner resolution for missed-reveal settled games
const displayWinnerAddress = (() => {
  if (g.winner && g.winner !== ethers.ZeroAddress) {
    return g.winner;
  }
  if (isMissedRevealSettled) {
    if (p1Revealed && !p2Revealed) return g.player1;
    if (p2Revealed && !p1Revealed) return g.player2;
  }

  return null;
})();

const winnerAddress =
  g.winner ||
  (isMissedRevealSettled
    ? p1Revealed && !p2Revealed
      ? g.player1
      : p2Revealed && !p1Revealed
      ? g.player2
      : null
    : null);
    
const tie = !displayWinnerAddress || displayWinnerAddress === ethers.ZeroAddress;

const winnerIsPlayer1 =
  isSettled &&
  winnerAddress &&
  g.player1 &&
  winnerAddress.toLowerCase() === g.player1.toLowerCase();

const winnerIsPlayer2 =
  isSettled &&
  winnerAddress &&
  g.player2 &&
  winnerAddress.toLowerCase() === g.player2.toLowerCase();

// Player winnings (95% if not tie)
const playerWinningsWei = tie
  ? totalPotWei / 2n
  : (totalPotWei * 95n) / 100n;

const playerWinnings = ethers.formatUnits(playerWinningsWei, 18);

const isOpenGame = !isSettled && !isCancelled && isPlayer2Empty;
const isActiveGame = !isSettled && !isCancelled && hasPlayer2;

const cardAccent = isOpenGame
  ? "#18bb1a"
  : isActiveGame
  ? "#f0b90b"
  : "#444";

const cardTitle = isOpenGame
  ? "Open Clash"
  : isActiveGame
  ? "Active Clash"
  : "Clash";

const cardSubtitle = isOpenGame
  ? "Waiting for a challenger"
  : isActiveGame
  ? "Battle locked — reveal phase active"
  : "";

const buttonBaseStyle = {
  width: "100%",              // 🔑 makes it span the card
  display: "block",           // ensures full-width behavior
  border: "none",
  borderRadius: 12,
  padding: "12px 14px",       // slightly taller = more premium feel
  fontWeight: "bold",
  cursor: "pointer",
  boxShadow: "0 0 12px rgba(0,0,0,0.35)",
  textAlign: "center",
  fontSize: 14,
};

const statBoxStyle = {
  background: "rgba(255,255,255,0.045)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: "10px 12px",
  textAlign: "center",
};

/* ---------------- Reveal File Re-download Handler ---------------- */
const getRevealBackup = (() => {
  try {
    if (!account || !g?.id) return false;

    const prefix = `${account.toLowerCase()}_${g.id}`;
    const salt = localStorage.getItem(`${prefix}_salt`);
    const nftContracts = localStorage.getItem(`${prefix}_nftContracts`);
    const tokenIds = localStorage.getItem(`${prefix}_tokenIds`);
    return !!salt && !!nftContracts && !!tokenIds;
  } catch (err) {
    console.warn("getRevealBackup localStorage check failed:", err);
    return false;
  }
})();

const canDownloadRevealBackup = (game, account) => {
  if (!game || !account) return false;

  const wallet = account.toLowerCase();
  const p1 = game.player1?.toLowerCase();
  const p2 = game.player2?.toLowerCase();

  const isPlayer = wallet === p1 || wallet === p2;
  const allowedStatus = game.status === "open" || game.status === "active";

  return isPlayer && allowedStatus;
};

const handleDownloadReveal = (game) => {
  if (!canDownloadRevealBackup(game, account)) {
    alert("You can only download the reveal backup for your own open or active games.");
    return;
  }

  const backup = getRevealBackup(account, game.id);

  if (!backup) {
    alert("No reveal backup found for this game.");
    return;
  }

  downloadRevealBackup({
    gameId: game.id,
    player: account.toLowerCase(),
    salt: backup.salt,
    nftContracts: backup.nftContracts,
    tokenIds: backup.tokenIds,
  });
};

/* ---------------- Render Token Images ---------------- */
const renderTokenImages = (input = [], isWinningTeam = false) => {
  let tokens = [];

  if (Array.isArray(input)) {
    tokens = input;
  } else if (input && typeof input === "object") {
    const { nftContracts = [], tokenIds = [], tokenURIs = [] } = input;

tokens = tokenIds.map((id, idx) => {
  const rawAddr = nftContracts[idx];
  const addr = String(rawAddr || "").trim().toLowerCase();

  const collection =
    addressToCollection[addr] ||
    (addr.includes("8cfbb04c")
      ? "VQLE"
      :addr.includes("5c81a560")
      ? "EVG"
      : addr.includes("ac620b1a3de23f4eb0a69663613babf73f6c535d")
      ? "SCIONS"
      : "VKIN");

const format = COLLECTION_IMAGE_FORMATS[collection] || "png";

let imageFile = `${id}.${format}`;
const mappedEntry = mapping[collection]?.[String(id)];

if (mappedEntry?.image_file) {
  imageFile = mappedEntry.image_file;
} else if (mappedEntry?.token_uri) {
  imageFile = mappedEntry.token_uri
    .replace(/\.json$/i, `.${format}`)
    .toLowerCase();
} else if (tokenURIs[idx]) {
  imageFile = tokenURIs[idx]
    .replace(/\.json$/i, `.${format}`)
    .toLowerCase();
}
  return { collection, tokenId: id, imageFile };
});
  }

  if (!tokens.length) return null;

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
      {tokens.map((token, i) => {
        const { collection, tokenId, imageFile } = token;
        const src = `${BACKEND_URL}/images/${collection}/${imageFile}`;

        return (
          <div
            key={`${collection}-${tokenId || i}-${i}`}
            style={{
              position: "relative",
              borderRadius: 14,
              padding: isWinningTeam ? 3 : 0,
              background: isWinningTeam
                ? "linear-gradient(135deg, #ffd700, #fff4a3, #ffcf40, #fff8cc, #ffd700)"
                : "transparent",
              boxShadow: isWinningTeam
                ? "0 0 8px rgba(255,215,0,0.7), 0 0 16px rgba(255,215,0,0.5), 0 0 24px rgba(255,215,0,0.3)"
                : "none",
              animation: isWinningTeam ? "winnerGlowPulse 1.8s ease-in-out infinite" : "none",
            }}
          >
            {isWinningTeam && (
              <>
                <span
                  style={{
                    position: "absolute",
                    top: -6,
                    left: -4,
                    fontSize: 11,
                    color: "#fff6b0",
                    textShadow: "0 0 6px #ffd700, 0 0 10px #fff6b0",
                    pointerEvents: "none",
                    animation: "winnerSparkle 1.5s ease-in-out infinite",
                  }}
                >
                  ✨
                </span>
                <span
                  style={{
                    position: "absolute",
                    top: 4,
                    right: -5,
                    fontSize: 10,
                    color: "#fff6b0",
                    textShadow: "0 0 6px #ffd700, 0 0 10px #fff6b0",
                    pointerEvents: "none",
                    animation: "winnerSparkle 1.7s ease-in-out infinite 0.35s",
                  }}
                >
                  ✦
                </span>
                <span
                  style={{
                    position: "absolute",
                    bottom: -4,
                    left: 10,
                    fontSize: 10,
                    color: "#fffbe0",
                    textShadow: "0 0 6px #ffd700, 0 0 10px #fff6b0",
                    pointerEvents: "none",
                    animation: "winnerSparkle 1.9s ease-in-out infinite 0.7s",
                  }}
                >
                  ✨
                </span>
              </>
            )}

            <div
              style={{
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <StableImage
                src={src}
                alt={`${collection} #${tokenId || "?"}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

  /* ---------------- Render JSX ---------------- */
return (
  <div
    style={{
      position: "relative",
      overflow: "hidden",
      border: `1px solid ${isCancelled ? "#444" : cardAccent}`,
      borderRadius: 18,
      padding: 16,
      marginBottom: 18,
      opacity: isCancelled ? 0.6 : 1,
      background: isCancelled
        ? "#111"
        : `
          radial-gradient(circle at top left, ${cardAccent}22, transparent 34%),
          linear-gradient(145deg, #111 0%, #171717 55%, #0b0b0b 100%)
        `,
      boxShadow: isCancelled
        ? "0 0 12px rgba(0,0,0,0.5)"
        : `0 0 18px ${cardAccent}22, 0 8px 24px rgba(0,0,0,0.45)`,
    }}
  >
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background:
          "linear-gradient(120deg, rgba(255,255,255,0.05), transparent 35%, rgba(255,255,255,0.025))",
      }}
    />

    <div style={{ position: "relative", zIndex: 1 }}>
      {isPreJoinCancelled && (
        <div
          style={{
            backgroundColor: "rgba(255, 68, 68, 0.2)",
            border: "1px solid #ff4444",
            borderRadius: 12,
            padding: "12px",
            marginBottom: 14,
            color: "#ff5555",
            fontWeight: "bold",
            textAlign: "center",
            fontSize: 16,
          }}
        >
          ⚠️ Game Cancelled
          <div style={{ fontSize: 13, fontWeight: "normal", marginTop: 4, opacity: 0.9 }}>
            Stake refunded on-chain
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              color: cardAccent,
              fontWeight: "bold",
              letterSpacing: 1.2,
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            {cardTitle}
          </div>

          <h3
            style={{
              margin: 0,
              fontSize: 24,
              color: "#fff",
              textShadow: `0 0 12px ${cardAccent}55`,
            }}
          >
            Game #{g.id}
          </h3>

          {cardSubtitle && (
            <div style={{ fontSize: 13, color: "#aaa", marginTop: 4 }}>
              {cardSubtitle}
            </div>
          )}
        </div>

        <BadgeWrapper
          href={status.link}
          target={status.link ? "_blank" : undefined}
          rel={status.link ? "noopener noreferrer" : undefined}
          style={{
            display: "inline-block",
            padding: "7px 12px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: "bold",
            backgroundColor: status.color,
            color: "#000",
            textDecoration: "none",
            cursor: status.link ? "pointer" : "default",
            boxShadow: `0 0 12px ${status.color}66`,
            whiteSpace: "nowrap",
          }}
        >
          {status.label}
        </BadgeWrapper>
      </div>

      {!isSettled && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
              marginTop: 12,
            }}
          >
            <div
              style={{
                ...statBoxStyle,
                borderColor: "rgba(255,85,85,0.35)",
                background: "rgba(255,85,85,0.08)",
              }}
            >
              <div style={{ fontSize: 12, color: "#ff7777", fontWeight: "bold" }}>
                🟥 Player 1
              </div>
              <div style={{ marginTop: 4, color: "#fff", fontWeight: "bold" }}>
                {g.player1 ? `0x...${g.player1.slice(-5)}` : "Waiting"}
              </div>
            </div>

            <div
              style={{
                ...statBoxStyle,
                borderColor: hasPlayer2
                  ? "rgba(77,163,255,0.35)"
                  : "rgba(240,185,11,0.35)",
                background: hasPlayer2
                  ? "rgba(77,163,255,0.08)"
                  : "rgba(240,185,11,0.08)",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: hasPlayer2 ? "#7db8ff" : "#f0b90b",
                  fontWeight: "bold",
                }}
              >
                🟦 Player 2
              </div>
              <div style={{ marginTop: 4, color: "#fff", fontWeight: "bold" }}>
                {hasPlayer2 ? `0x...${g.player2.slice(-5)}` : "Open Slot"}
              </div>
            </div>

            <div
              style={{
                ...statBoxStyle,
                borderColor: "rgba(24,187,26,0.35)",
                background: "rgba(24,187,26,0.08)",
              }}
            >
              <div style={{ fontSize: 12, color: "#18bb1a", fontWeight: "bold" }}>
                Stake
              </div>
              <div style={{ marginTop: 4, color: "#fff", fontWeight: "bold" }}>
                {displayStake !== null ? formatTokenAmount(displayStake) : "Loading..."} $CORE
              </div>
            </div>

            <div
              style={{
                ...statBoxStyle,
                borderColor: "rgba(255,152,0,0.35)",
                background: "rgba(255,152,0,0.08)",
              }}
            >
              <div style={{ fontSize: 12, color: "#ffb74d", fontWeight: "bold" }}>
                Total Pot
              </div>
              <div style={{ marginTop: 4, color: "#fff", fontWeight: "bold" }}>
                {formatTokenAmount(totalPot)} $CORE
              </div>
            </div>
          </div>
        </>
      )}
      
{/* Cancel Button – only for unjoined games */}
{isPlayer1 &&
  g.player2?.toLowerCase() === ethers.ZeroAddress.toLowerCase() &&
  !isSettled &&
  !isCancelled && (
    <div style={{ marginTop: 12 }}>
<button
  onClick={() => cancelUnjoinedGame(g.id)}
  disabled={!account}
  style={{
    ...buttonBaseStyle,
    background: "linear-gradient(135deg, #ff4444, #9f1d1d)",
    color: "#fff",
    opacity: account ? 1 : 0.5,
    cursor: account ? "pointer" : "not-allowed",
  }}
>
  Cancel Game (Refund Stake)
</button>
      <div style={{ fontSize: 12, color: "#ff9999", marginTop: 4 }}>
        Only available before someone joins
      </div>
    </div>
)}

      {/* Hidden Teams */}
{!isSettled && hasPlayer2 && !bothRevealed && (
   <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>🔒 Teams hidden until both players reveal</div>
      )}

      {/* Join / Approve */}
      {!isCancelled && !isSettled && canJoin && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
<button
  onClick={() => joinGame(g.id)}
  style={{
    ...buttonBaseStyle,
    background: "linear-gradient(135deg, #18bb1a, #0f8f12)",
    color: "#fff",
  }}
>
  Join Game
</button>
        </div>
      )}

{canDownloadRevealBackup(g, account) && backupExists && (
  <button
    onClick={() => handleDownloadReveal(g)}
    style={{
      marginTop: "8px",
      padding: "6px 12px",
      background: "#444",
      color: "#fff",
      border: "none",
      borderRadius: 4,
      cursor: "pointer"
    }}
  >
    ⬇️ Re-download Reveal File
  </button>
)}

{/* Reveal Upload + Expired Settle */}
{hasPlayer2 &&
  !isSettled &&
  !isCancelled &&
  ((isPlayer1 && !p1Revealed) ||
   (isPlayer2 && !p2Revealed)) && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            onClick={() => document.getElementById(`reveal-file-${g.id}`).click()}
style={{
  ...buttonBaseStyle,
  background: "linear-gradient(135deg, #18bb1a, #0f8f12)",
  color: "#fff",
}}
          >
            Upload Reveal
          </button>

          <input
            id={`reveal-file-${g.id}`}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={handleRevealFile}
          />
        </div>
      )}

{/* Settle after 5 days */}
{revealDeadlineTs !== null && !bothRevealed && !isSettled && !isCancelled && (
  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
    {!revealDeadlinePassed ? (
      <div style={{ fontSize: 12, color: "#ffb74d" }}>
        ⏳ Reveal deadline in: {formatTimeRemaining(timeRemaining)}
      </div>
    ) : (
      <div style={{ fontSize: 12, color: "#ffb74d" }}>
        ⏱ Reveal window expired
      </div>
    )}

    {canManualSettle && (
      <button
        onClick={() => manualSettleGame(g.id)}
style={{
  ...buttonBaseStyle,
  background: "linear-gradient(135deg, #ffb347, #ff9800)",
  color: "#000",
}}
      >
        Settle Game
      </button>
    )}
  </div>
)}

{/* Manual settle for fully revealed games */}
{canSettle && !isCancelled && (
  <div style={{ marginTop: 8 }}>
    <button
      onClick={() => manualSettleGame(g.id)}
      style={{
        background: "#18bb1a",
        color: "#fff",
        padding: "6px 12px",
        borderRadius: 4,
        cursor: "pointer",
      }}
    >
      Settle Game
    </button>
  </div>
)}

{/* Teams + Round Results */}
{showTeamsSection && (
  <div style={{ marginTop: 16 }}>
    {/* Player 1 Team */}
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          fontWeight: "bold",
          color: "#ff5555",
          marginBottom: 8,
          textAlign: "left",
        }}
      >
        🟥 Player 1 Team: {g.player1 ? `0x...${g.player1.slice(-5)}` : "—"}
      </div>

      <div style={{ fontSize: 14, marginTop: 2 }}>
        Stake:{" "}
        {displayStake !== null
          ? (() => {
              const n = Number(displayStake);
              return Number.isInteger(n) ? n : n.toFixed(2);
            })()
          : "Loading..."}{" "}
        $CORE
      </div>

      {p1Revealed ? (
        <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
          {renderTokenImages(g.player1Reveal, winnerIsPlayer1)}
        </div>
      ) : (
        <div
          style={{
            marginTop: 10,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #ff5555",
            background: "rgba(255, 85, 85, 0.12)",
            color: "#ff7777",
            textAlign: "center",
            fontWeight: "bold",
          }}
        >
          Player 1 missed reveal
        </div>
      )}
    </div>

    {/* Round Results */}
    {bothRevealed && isSettled && g.roundResults && g.roundResults.length > 0 && (
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontWeight: "bold",
            marginBottom: 8,
            fontSize: 20,
            color: "#aaa",
            textAlign: "center",
          }}
        >
          📊 Round Results
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
          {g.roundResults.map((r) => (
            <div
              key={r.round}
              style={{
                padding: "4px 4px",
                borderRadius: 20,
                backgroundColor:
                  r.winner === "player1"
                    ? "#ff5555"
                    : r.winner === "player2"
                    ? "#4da3ff"
                    : "#777",
                color: "#fff",
                fontWeight: "bold",
                fontSize: 16,
                minWidth: 70,
                textAlign: "center",
                boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
              }}
            >
              R{r.round}:{" "}
              {r.winner === "player1"
                ? "P1"
                : r.winner === "player2"
                ? "P2"
                : "TIE"}
            </div>
          ))}
        </div>
      </div>
    )}

    {/* Player 2 Team */}
    <div>
      <div
        style={{
          fontWeight: "bold",
          color: "#4da3ff",
          marginBottom: 8,
          textAlign: "left",
        }}
      >
        🟦 Player 2 Team: {g.player2 ? `0x...${g.player2.slice(-5)}` : "—"}
      </div>

      <div style={{ fontSize: 14, marginTop: 2 }}>
        Stake:{" "}
        {displayStake !== null
          ? (() => {
              const n = Number(displayStake);
              return Number.isInteger(n) ? n : n.toFixed(2);
            })()
          : "Loading..."}{" "}
        $CORE
      </div>

      {p2Revealed ? (
        <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
          {renderTokenImages(g.player2Reveal, winnerIsPlayer2)}
        </div>
      ) : (
        <div
          style={{
            marginTop: 10,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #4da3ff",
            background: "rgba(77, 163, 255, 0.12)",
            color: "#7db8ff",
            textAlign: "center",
            fontWeight: "bold",
          }}
        >
          Player 2 missed reveal
        </div>
      )}
    </div>
  </div>
)}
<div
  style={{
    marginTop: 12,
    padding: 12,
    background: "#111", // dark card background
    borderRadius: 8,
    textAlign: "center",
    color: "#fff",
    boxShadow: "0 0 10px rgba(0,0,0,0.5)"
  }}
>
{/* Settled Result Card */}
{isSettled && (displayWinnerAddress || isMissedRevealSettled) && (
  <div
  style={{
    marginTop: 2,
    padding: 8,
    borderRadius: 12,
    textAlign: "center",
    background: "#111",
    boxShadow: "0 0 20px rgba(0,0,0,0.7)",
    color: "#fff",
  }}
>
{/* Determine result */}
{displayWinnerAddress ? (
  <div
    style={{
      fontWeight: "bold",
      marginBottom: 6,
      fontSize: 22,
      letterSpacing: 1,
      textTransform: "uppercase",
      color:
        displayWinnerAddress.toLowerCase() === g.player1.toLowerCase()
          ? "#ff2d55"
          : "#4da3ff",
      textShadow:
        displayWinnerAddress.toLowerCase() === g.player1.toLowerCase()
          ? "0 0 8px #ff2d55, 0 0 16px #ff2d55"
          : "0 0 8px #4da3ff, 0 0 16px #4da3ff",
    }}
  >
    🏆{" "}
    {displayWinnerAddress.toLowerCase() === g.player1.toLowerCase()
      ? "PLAYER 1 WINS!"
      : "PLAYER 2 WINS!"}
  </div>
) : (
  <div style={{ fontSize: 18, color: "#888" }}>🤝 Tie Game</div>
)}

{isMissedRevealSettled && (
  <div style={{ fontSize: 13, marginBottom: 6, color: "#ffb347" }}>
    Settled After Missed Reveal
  </div>
)}

  {/* Total Pot */}
  <div style={{ fontSize: 14, marginBottom: 4 }}>
    Total Pot: {formatTokenAmount(totalPot)} $CORE
  </div>

  {/* Player Winnings */}
  <div style={{ fontSize: 28, fontWeight: "bold", color: "#0f0", marginBottom: 4 }}>
    Winnings: {formatTokenAmount(playerWinnings)} $CORE  
  </div>

  {/* Core Burn */}
  <div style={{ fontSize: 16, color: "#f50", display: "flex", justifyContent: "center", alignItems: "center" }}>
    🔥 Core Burn: {formatTokenAmount(burnAmount)} $CORE 🔥
  </div>
</div>
)}
      </div>
    </div>
  </div>
);
}