import React, { useState } from "react";

const XP_LEVELS = [
  { level: 0, minXp: 0 },
  { level: 1, minXp: 50 },
  { level: 2, minXp: 100 },
  { level: 3, minXp: 200 },
  { level: 4, minXp: 400 },
  { level: 5, minXp: 800 },
  { level: 6, minXp: 1600 },
  { level: 7, minXp: 3200 },
  { level: 8, minXp: 6400 },
  { level: 9, minXp: 12800 },
  { level: 10, minXp: 25600 },
];

const getLevelProgress = (xp, level) => {
  const currentIndex = XP_LEVELS.findIndex((l) => l.level === level);
  if (currentIndex === -1) return 0;

  const currentMin = XP_LEVELS[currentIndex].minXp;
  const nextMin = XP_LEVELS[currentIndex + 1]?.minXp;

  if (!nextMin) return 100;

  const span = nextMin - currentMin;
  const progress = ((xp - currentMin) / span) * 100;

  return Math.max(0, Math.min(100, progress));
};

export default function WalletXpPanel({
  xpProfile,
  xpLoading,
  isMobile,
}) {
  const [showXpHelp, setShowXpHelp] = useState(false);
  const [showPerks, setShowPerks] = useState(false);

const statsBonus = xpProfile?.statsBonus || {};
const weeklyBonus = xpProfile?.weeklyLeaderboardBonus || {};

const totalBonus = {
  attack: Number(((statsBonus.attack || 0) + (weeklyBonus.attack || 0)).toFixed(2)),
  defense: Number(((statsBonus.defense || 0) + (weeklyBonus.defense || 0)).toFixed(2)),
  vitality: Number(((statsBonus.vitality || 0) + (weeklyBonus.vitality || 0)).toFixed(2)),
  agility: Number(((statsBonus.agility || 0) + (weeklyBonus.agility || 0)).toFixed(2)),
};


if (xpLoading) {
    return (
      <div
        style={{
          width: isMobile ? "100%" : 320,
          background: "#0f0f0f",
          border: "1px solid #2a2a2a",
          borderRadius: 14,
          padding: "14px 16px",
          boxShadow: "0 0 10px rgba(0,0,0,0.35)",
          color: "#888",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        Loading XP Profile...
      </div>
    );
  }

  if (!xpProfile) {
    return (
      <div
        style={{
          width: isMobile ? "100%" : 320,
          background: "#0f0f0f",
          border: "1px solid #2a2a2a",
          borderRadius: 14,
          padding: "14px 16px",
          boxShadow: "0 0 10px rgba(0,0,0,0.35)",
          color: "#777",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        No XP data available
      </div>
    );
  }

const progress = xpProfile
  ? getLevelProgress(Number(xpProfile.xp || 0), Number(xpProfile.level || 0))
  : 0;
  
  return (
    <div
style={{
        position: "relative",
        zIndex: showXpHelp ? 9999 : 1,
        isolation: "isolate",
        width: isMobile ? "100%" : 320,
        background:
          "linear-gradient(180deg, rgb(18,18,18), rgb(10,10,10))",
        border: "1px solid #2d2d2d",
        borderRadius: 16,
        padding: "14px 16px",
        boxShadow:
          "0 0 14px rgba(0,0,0,0.45), inset 0 0 12px rgba(24,187,26,0.03)",
        backdropFilter: "blur(4px)",
      }}
    >
{/* Header */}
<div
  style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    position: "relative",
    gap: 12,
  }}
>
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <div>
      <div
        style={{
          fontSize: 11,
          color: "#888",
          textTransform: "uppercase",
          letterSpacing: 1.2,
          marginBottom: 2,
        }}
      >
        Core Rank
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          color: "#fff",
          letterSpacing: 0.3,
        }}
      >
        Level {xpProfile.level}
      </div>
    </div>

    <button
      onClick={() => setShowXpHelp((prev) => !prev)}
      style={{
        width: 22,
        height: 22,
        minWidth: 22,
        borderRadius: "50%",
        border: "1px solid #2f2f2f",
        background: "#151515",
        color: "#18bb1a",
        fontSize: 12,
        fontWeight: 800,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 0 8px rgba(0,0,0,0.25)",
      }}
      title="XP help"
    >
      ?
    </button>
  </div>

  <div
    style={{
      textAlign: "right",
    }}
  >
    <div
      style={{
        fontSize: 11,
        color: "#888",
        textTransform: "uppercase",
        letterSpacing: 1.2,
        marginBottom: 2,
      }}
    >
      Total XP
    </div>
    <div
      style={{
        fontSize: 17,
        fontWeight: 800,
        color: "#18bb1a",
        textShadow: "0 0 8px rgba(24,187,26,0.35)",
      }}
    >
      {xpProfile.xp}
    </div>
  </div>

{showXpHelp && (
  <div
    style={{
      position: "absolute",
      top: 42,
      left: isMobile ? "auto" : 0,
      right: isMobile ? 0 : "auto",
      zIndex: 9999,
      background: "rgb(17, 17, 17)",
      boxShadow: "0 12px 36px rgba(0,0,0,0.95)",
      isolation: "isolate",      width: isMobile ? "min(320px, calc(100vw - 48px))" : 290,
      maxWidth: 320,
      border: "1px solid #2f2f2f",
      borderRadius: 12,
      padding: "12px 14px",
    }}
  >
      <div
        style={{
          fontSize: 11,
          color: "#18bb1a",
          textTransform: "uppercase",
          letterSpacing: 1.2,
          fontWeight: 800,
          marginBottom: 10,
        }}
      >
        How to gain XP
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {[
          ["Daily login / refresh", "5 XP per day"],
          ["Ecosystem link click", "5 XP per link, once per day"],
          ["Create game", "25 XP"],
          ["Join game", "15 XP"],
          ["Reveal", "25 XP"],
          ["Settle game", "30 XP"],
        ].map(([label, value]) => (
<div
  key={label}
  style={{
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    justifyContent: "space-between",
    alignItems: isMobile ? "flex-start" : "center",
    gap: isMobile ? 4 : 12,
    fontSize: 12,
    color: "#ddd",
    borderBottom: "1px solid #1f1f1f",
    paddingBottom: 6,
  }}
>
  <span style={{ lineHeight: 1.4 }}>{label}</span>
  <span
    style={{
      color: "#18bb1a",
      fontWeight: 700,
      whiteSpace: isMobile ? "normal" : "nowrap",
      lineHeight: 1.4,
    }}
  >
    {value}
  </span>
</div>
        ))}
      </div>

      <div
        style={{
          marginTop: 10,
          fontSize: 11,
          color: "#888",
          lineHeight: 1.4,
        }}
      >
        Settle XP is only awarded when both players have revealed and the game is newly settled.
      </div>
    </div>
  )}
</div>

      {/* Progress bar */}
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            width: "100%",
            height: 12,
            background: "#1a1a1a",
            borderRadius: 999,
            overflow: "hidden",
            border: "1px solid #2c2c2c",
            boxShadow: "inset 0 0 6px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background:
                "linear-gradient(90deg, #18bb1a 0%, #32d74b 45%, #5cff61 100%)",
              borderRadius: 999,
              transition: "width 0.35s ease",
              boxShadow: "0 0 10px rgba(24,187,26,0.35)",
            }}
          />
        </div>

        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: "#9a9a9a",
            textAlign: "center",
            letterSpacing: 0.2,
          }}
        >
        {xpProfile.nextLevelXp
          ? `${xpProfile.nextLevelXp - xpProfile.xp} XP to next level`
          : "Maximum level reached"}
          </div>
      </div>

      {/* Perks */}
      <div
        style={{
          borderTop: "1px solid #242424",
          paddingTop: 12,
        }}
      >
<div
  style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: showPerks ? 10 : 0,
  }}
>
  <div
    style={{
      fontSize: 11,
      color: "#888",
      textTransform: "uppercase",
      letterSpacing: 1.2,
    }}
  >
    Total Perks
  </div>

  <button
    onClick={() => setShowPerks((prev) => !prev)}
    style={{
      background: "#151515",
      border: "1px solid #2f2f2f",
      borderRadius: 8,
      color: "#18bb1a",
      fontSize: 12,
      fontWeight: 700,
      padding: "4px 8px",
      cursor: "pointer",
      minWidth: 32,
    }}
  >
    {showPerks ? "−" : "+"}
  </button>
</div>

{showPerks && (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8,
    }}
  >
{[
  ["Attack", totalBonus.attack],
  ["Defense", totalBonus.defense],
  ["Vitality", totalBonus.vitality],
  ["Agility", totalBonus.agility],
].map(([label, value]) => (
              <div
              key={label}
              style={{
                background: "#141414",
                border: "1px solid #252525",
                borderRadius: 10,
                padding: "8px 10px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: "#cfcfcf",
                  fontWeight: 500,
                }}
              >
                {label}
              </span>

              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#18bb1a",
                  textShadow: "0 0 6px rgba(24,187,26,0.25)",
                }}
              >
                +{value}
              </span>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}