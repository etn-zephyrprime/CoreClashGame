// backend/utils/inactiveXpReminder.js
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import {
  readInactiveXpReminderState,
  writeInactiveXpReminderState,
} from "../store/inactiveXpReminderStore.js";
import {
  sendTelegramGroupMessage,
  escapeHtml,
  shortWallet,
} from "./telegramBot.js";

const BASE_DATA_DIR =
  process.env.DATA_DIR ||
  process.env.RENDER_DISK_PATH ||
  "/backend/data";

const XP_FILE = path.join(BASE_DATA_DIR, "playerXp.json");
const XP_ACTIONS_FILE = path.join(BASE_DATA_DIR, "xpActions.json");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const SEND_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

function readJsonSafe(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`[XP INACTIVE] Failed to read ${file}:`, err.message);
    return fallback;
  }
}

function isTwoPmUtcNow() {
  const now = new Date();
  return now.getUTCHours() === 14;
}

function getLastXpActivityDate(wallet, xpActions, playerXp) {
  const walletLc = wallet.toLowerCase();
  const actions = xpActions[walletLc];
  const player = playerXp[walletLc];

  const dates = [];

  if (player?.updatedAt) dates.push(player.updatedAt);
  if (actions?.dailyLogin?.lastClaimedDate) {
    dates.push(actions.dailyLogin.lastClaimedDate);
  }

  if (actions?.ecosystemClicks) {
    Object.values(actions.ecosystemClicks).forEach((date) => {
      if (date) dates.push(date);
    });
  }

  const parsed = dates
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b - a);

  return parsed[0] || null;
}

function getInactiveStage(daysInactive) {
  if (daysInactive >= 12) return "dormant";
  if (daysInactive >= 9) return 3;
  if (daysInactive >= 6) return 2;
  if (daysInactive >= 3) return 1;
  return 0;
}

function getStageStyle(stage) {
  if (stage === 1) {
    return {
      icon: "🟡",
      label: "Taking a break",
      detail: "3+ days inactive",
    };
  }

  if (stage === 2) {
    return {
      icon: "🟠",
      label: "Come back soon",
      detail: "6+ days inactive",
    };
  }

  if (stage === 3) {
    return {
      icon: "🔴",
      label: "Falling behind",
      detail: "9+ days inactive",
    };
  }

  return {
    icon: "⚪",
    label: "Unknown",
    detail: "Unknown inactive status",
  };
}

function buildInactiveXpMessage(reminders) {
  const sorted = [...reminders].sort((a, b) => {
    if (b.stage !== a.stage) return b.stage - a.stage;
    return b.daysInactive - a.daysInactive;
  });

  const rows = sorted.map(({ wallet, daysInactive, stage }) => {
    const { icon, label, detail } = getStageStyle(stage);

    return (
      `${icon} <code>${escapeHtml(shortWallet(wallet))}</code> — ` +
      `<b>${escapeHtml(daysInactive)} days</b>\n` +
      `<i>${escapeHtml(label)} (${escapeHtml(detail)})</i>`
    );
  });

  const maxStage = Math.max(...sorted.map((r) => r.stage));

const footer =
  maxStage === 1
    ? "<b>Stay active and keep earning XP.</b>"
    : maxStage === 2
    ? "<b>A gentle nudge to jump back in and keep things moving.</b>"
    : "<b>Still inactive — log in, claim XP, and keep your progress going.</b>";

return (
  `⏳ <b>XP Activity Check-In</b>\n\n` +
  `<b>Wallets currently inactive:</b>\n\n` +
  rows.join("\n\n") +
  `\n\n${footer}`
);
}

export async function runInactiveXpReminderCheck() {
  const playerXp = readJsonSafe(XP_FILE, {});
  const xpActions = readJsonSafe(XP_ACTIONS_FILE, {});
  const state = readInactiveXpReminderState();

  const now = Date.now();
  const nextWalletState = { ...(state.wallets || {}) };
  const remindersToSend = [];

const isFirstRun = !state.bootstrappedAt;

const lastSentAt = state.lastSentAt
  ? new Date(state.lastSentAt).getTime()
  : 0;

const nowTime = Date.now();
const isTwoPmUtc = new Date().getUTCHours() === 14;

const canSend =
  isFirstRun ||
  (nowTime - lastSentAt >= SEND_INTERVAL_MS && isTwoPmUtc);

for (const wallet of Object.keys(playerXp)) {
  const walletLc = wallet.toLowerCase();

  if (
    !ethers.isAddress(walletLc) ||
    walletLc === ethers.ZeroAddress.toLowerCase()
  ) {
    continue;
  }

  const lastActivity = getLastXpActivityDate(walletLc, xpActions, playerXp);
  if (!lastActivity) continue;

  const daysInactive = Math.floor(
    (now - lastActivity.getTime()) / ONE_DAY_MS
  );

  const existing = nextWalletState[walletLc] || {
    reminderStage: 0,
    dormant: false,
  };

  // Bootstrap mode:
  // everyone already inactive starts from stage 1, no matter how old their inactivity is.
  if (isFirstRun && daysInactive >= 3) {
    remindersToSend.push({
      wallet: walletLc,
      daysInactive,
      stage: 1,
    });

    nextWalletState[walletLc] = {
      ...existing,
      reminderStage: 1,
      dormant: false,
      firstInactiveSeenAt: new Date().toISOString(),
      lastReminderAt: new Date().toISOString(),
      lastDaysInactive: daysInactive,
    };

    continue;
  }

  const stage = getInactiveStage(daysInactive);

  // Active again — clear reminder state.
  if (stage === 0) {
    delete nextWalletState[walletLc];
    continue;
  }

  // Dormant — stop reminders after final stage.
  if (stage === "dormant") {
    nextWalletState[walletLc] = {
      ...existing,
      reminderStage: 3,
      dormant: true,
      dormantAt: existing.dormantAt || new Date().toISOString(),
      lastDaysInactive: daysInactive,
    };
    continue;
  }

// First startup/bootstrap:
// list every currently inactive wallet, but reset their reminder countdown from now.
if (isFirstRun && typeof stage === "number" && stage >= 1) {
  remindersToSend.push({
    wallet: walletLc,
    daysInactive,
    stage: 1,
  });

  nextWalletState[walletLc] = {
    ...existing,
    reminderStage: 1,
    dormant: false,
    firstInactiveSeenAt: new Date().toISOString(),
    lastReminderAt: new Date().toISOString(),
    lastDaysInactive: daysInactive,
  };

  continue;
}

// Normal mode:
// send only when newly crossing stage 1, 2, or 3.
if ((existing.reminderStage || 0) < stage) {
  remindersToSend.push({
    wallet: walletLc,
    daysInactive,
    stage,
  });

  nextWalletState[walletLc] = {
    ...existing,
    reminderStage: stage,
    dormant: false,
    lastReminderAt: new Date().toISOString(),
    lastDaysInactive: daysInactive,
  };
}
  }

if (remindersToSend.length > 0 && canSend) {
  await sendTelegramGroupMessage(buildInactiveXpMessage(remindersToSend), {
    skipDefaultThread: true,
    includeFooter: true,
  });

  console.log("[XP INACTIVE] batch message sent:", remindersToSend.length);

  state.lastSentAt = new Date().toISOString();
} else {
  console.log("[XP INACTIVE] skipping send", {
    reminders: remindersToSend.length,
    canSend,
  });
}

writeInactiveXpReminderState({
  ...state,
  bootstrappedAt: state.bootstrappedAt || new Date().toISOString(),
  lastRunAt: new Date().toISOString(),
  lastSentAt: remindersToSend.length > 0 && canSend
    ? new Date().toISOString()
    : state.lastSentAt,
  wallets: nextWalletState,
});

  return {
    checked: Object.keys(playerXp).length,
    remindersSent: remindersToSend.length,
  };
}

export function startInactiveXpReminderScheduler() {
  runInactiveXpReminderCheck().catch((err) =>
    console.error("[XP INACTIVE] initial check failed:", err.message || err)
  );

  setInterval(() => {
    runInactiveXpReminderCheck().catch((err) =>
      console.error("[XP INACTIVE] scheduled check failed:", err.message || err)
    );
  }, CHECK_INTERVAL_MS);
}