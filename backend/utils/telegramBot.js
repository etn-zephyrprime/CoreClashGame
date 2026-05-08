// backend/utils/telegramBot.js
import axios from "axios";
import { EXPLORER_BASE_URL, ELECTROSWAP_BASE_URL,
} from "../config.js";

import {
  CLUB_TELEGRAM_BOT_TOKEN,
  CLUB_TELEGRAM_CHAT_ID,
  CLUB_TELEGRAM_MESSAGE_THREAD_ID,
  CLUB_ALL_SWAPS_CHAT_ID,
  CLUB_ALL_SWAPS_MESSAGE_THREAD_ID,
  TOKEN_SYMBOL_MAP
} from "../swapsConfig.js";

import {
  rebuildWeeklyLeaderboardForDate,
  getWeeklyLeaderboardsSorted,
} from "../store/weeklyLeaderboardStore.js";

import { readGames } from "../store/gamesStore.js";
import { ethers } from "ethers";

import fs from "fs";
import FormData from "form-data";
import { resolveExistingNftImage } from "./nftMedia.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ZEPHYROS_TELEGRAM_BOT_TOKEN = process.env.ZEPHYROS_TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const ZEPHYROS_NFT_MESSAGE_THREAD_ID = 782;

import {
  readAdvertState,
  writeAdvertState,
} from "../utils/advertSchedulerStore.js";

// Default topic for Core Clash bot messages
const TELEGRAM_MESSAGE_THREAD_ID = process.env.TELEGRAM_MESSAGE_THREAD_ID
  ? Number(process.env.TELEGRAM_MESSAGE_THREAD_ID)
  : null;

const TELEGRAM_API_BASE = TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
  : null;

const ZEPHYROS_TELEGRAM_API_BASE = ZEPHYROS_TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${ZEPHYROS_TELEGRAM_BOT_TOKEN}`
  : null;

function isTelegramConfigured() {
  return !!TELEGRAM_BOT_TOKEN && !!TELEGRAM_GROUP_CHAT_ID;
}

function isZephyrosTelegramConfigured() {
  return !!ZEPHYROS_TELEGRAM_BOT_TOKEN && !!TELEGRAM_GROUP_CHAT_ID;
}

function formatUsdPrice(n) {
  if (n == null || !Number.isFinite(n)) return "0";

  if (n >= 1) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }

  if (n >= 0.01) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 6,
    });
  }

  if (n >= 0.0001) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 6,
      maximumFractionDigits: 8,
    });
  }

  return n.toLocaleString(undefined, {
    minimumFractionDigits: 8,
    maximumFractionDigits: 10,
  });
}

function resolveTokenSymbol(tokenAddress, fallback = "TOKEN") {
  const key = String(tokenAddress || "").toLowerCase();
  return TOKEN_SYMBOL_MAP[key] || fallback;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortAddr(address) {
  if (!address) return "Unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortWallet(address) {
  if (!address || typeof address !== "string") return "Unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTokenAmount(amount, decimals = 18, maxFractionDigits = 4) {
  try {
    const raw = BigInt(amount);
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const fraction = raw % divisor;

    if (fraction === 0n) return whole.toString();

    const fractionStr = fraction
      .toString()
      .padStart(decimals, "0")
      .slice(0, maxFractionDigits)
      .replace(/0+$/, "");

    return fractionStr ? `${whole}.${fractionStr}` : whole.toString();
  } catch {
    return String(amount);
  }
}

async function telegramRequest(apiBase, method, payload) {
  if (!apiBase) {
    throw new Error("Telegram API base is not configured.");
  }

  const res = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok) {
    throw new Error(
      data?.description || `Telegram API request failed with status ${res.status}`
    );
  }

  return data.result;
}

function buildAllTimeTop10() {
  const games = readGames();
  const stats = {};

  games
    .filter((g) => g.settled && !g.cancelled)
    .forEach((g) => {
      const p1 = g.player1?.toLowerCase();
      const p2 = g.player2?.toLowerCase();
      const winner = g.winner?.toLowerCase();
      const isTie = g.tie;

      [p1, p2].forEach((player) => {
        if (!player || player === ethers.ZeroAddress.toLowerCase()) return;

        if (!stats[player]) stats[player] = { wins: 0, played: 0 };
        stats[player].played += 1;
      });

      if (!isTie && winner && winner !== ethers.ZeroAddress.toLowerCase()) {
        if (!stats[winner]) stats[winner] = { wins: 0, played: 0 };
        stats[winner].wins += 1;
      }
    });

  return Object.entries(stats)
    .map(([address, data]) => ({
      address,
      wins: data.wins,
      played: data.played,
      winRate:
        data.played > 0
          ? Math.round((data.wins / data.played) * 100)
          : 0,
    }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.winRate - a.winRate;
    })
    .slice(0, 10);
}

const REVEAL_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

// Helper function to check if a game is in the active reveal phase
export async function sendZephyrosNftPhotoMessage({
  caption,
  photoPath,
}) {
  if (!isZephyrosTelegramConfigured()) {
    console.warn(
      "Zephyros Telegram bot not configured; skipping NFT photo message:",
      caption
    );
    return null;
  }

  const form = new FormData();
  form.append("chat_id", TELEGRAM_GROUP_CHAT_ID);
  form.append("message_thread_id", String(ZEPHYROS_NFT_MESSAGE_THREAD_ID));
  form.append("caption", caption + buildFooter());
  form.append("parse_mode", "HTML");
  form.append("disable_web_page_preview", "true");
  form.append("photo", fs.createReadStream(photoPath));

  try {
    const res = await axios.post(
      `${ZEPHYROS_TELEGRAM_API_BASE}/sendPhoto`,
      form,
      { headers: form.getHeaders() }
    );

    if (!res.data?.ok) {
      throw new Error(res.data?.description || "Telegram sendPhoto failed");
    }

    return res.data.result;
  } catch (err) {
    console.error("sendZephyrosNftPhotoMessage failed:", err.message || err);
    throw err;
  }
}

function buildFooter() {
  return (
    `\n\n━━━━━━━━━━━━━━\n` +
    `🎮 <a href="https://coreclash.planetzephyros.xyz">Play Core Clash</a>\n` +
    `🌍 <a href="https://planetetn.org/zephyros">PlanetETN: Planet Zephyros</a>`
  );
}

function buildClubFooter() {
  return (
    `\n\n━━━━━━━━━━━━━━\n\n` +
    `💵 <a href="https://app.electroswap.io/explore/tokens/electroneum/0xc9fc4ab00911793d99b5c7bd01f01203c21d4131?inputCurrency=ETN">Buy CLUB</a> |` +
    `⚡️ <a href="https://app.electroswap.io/explore/transactions">Live Txs</a>\n` +
    `🌍 <a href="https://planetetn.org/profile/4-etn-club">PlanetETN: CLUB Website</a>\n\n` +
    `📢 Add your token: @JAYETNZ`
  );
}

export async function sendTelegramGroupMessage(text, options = {}) {
  if (!isTelegramConfigured()) {
    console.warn("Telegram bot not configured; skipping group message:", text);
    return null;
  }

  const {
    skipDefaultThread = false,
    includeFooter = true,
    ...restOptions
  } = options;

  const payload = {
    chat_id: TELEGRAM_GROUP_CHAT_ID,
    text: includeFooter ? text + buildFooter() : text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...restOptions,
  };

  if (
    !skipDefaultThread &&
    TELEGRAM_MESSAGE_THREAD_ID != null &&
    !payload.message_thread_id
  ) {
    payload.message_thread_id = TELEGRAM_MESSAGE_THREAD_ID;
  }

  try {
    return await telegramRequest(TELEGRAM_API_BASE, "sendMessage", payload);
  } catch (err) {
    console.error("sendTelegramGroupMessage failed:", err.message);
    throw err;
  }
}

export async function sendZephyrosAnimationMessage({
  caption,
  animationUrl,
  messageThreadId,
}) {
  if (!isZephyrosTelegramConfigured()) {
    console.warn(
      "Zephyros Telegram bot not configured; skipping animation message:",
      caption
    );
    return null;
  }

  const payload = {
    chat_id: TELEGRAM_GROUP_CHAT_ID,
    animation: animationUrl,
    caption,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(messageThreadId != null ? { message_thread_id: messageThreadId } : {}),
  };

  try {
    return await telegramRequest(
      ZEPHYROS_TELEGRAM_API_BASE,
      "sendAnimation",
      payload
    );
  } catch (err) {
    console.error("sendZephyrosAnimationMessage failed:", err.message);
    throw err;
  }
}

export async function sendZephyrosBurnMessage({
  symbol = "CORE",
  burnAmount,
  totalBurned,
  burnPercent,
  txHash,
  messageThreadId,
}) {
  const explorerUrl = txHash
    ? `https://blockexplorer.electroneum.com/tx/${txHash}`
    : null;

const caption =
  `🔥🔥 <b>${escapeHtml(symbol)} Burned!</b> 🔥🔥\n\n` +
  `<b>${escapeHtml(burnAmount)} ${escapeHtml(symbol)}</b> is gone forever!\n\n` +
  `Total Burned: <b>${escapeHtml(totalBurned)} ${escapeHtml(symbol)}</b> (${escapeHtml(burnPercent)}%)\n\n` +
  (explorerUrl
    ? `<a href="${escapeHtml(explorerUrl)}">View Transaction</a>`
    : `Transaction unavailable`)+
    buildFooter();
    
  return sendZephyrosAnimationMessage({
    caption,
    animationUrl: "CgACAgQAAxkBAAMDaeiG7E_J1y18lV9NePlhqQRIv5cAAjgiAAJ5zkBT47yvPwTBxsA7BA",
    messageThreadId,
  });
}

export async function sendTelegramGameCreated({
  gameId,
  creator,
  stakeAmount,
  tokenLabel = "TOKEN",
}) {
  const text =
    `🎮 <b>Game #${escapeHtml(gameId)}</b> created\n` +
    `Creator: <code>${escapeHtml(shortWallet(creator))}</code>\n` +
    `Stake: <b>${escapeHtml(stakeAmount)} ${escapeHtml(tokenLabel)}</b>`;

  return sendTelegramGroupMessage(text);
}

export async function sendTelegramGameJoined({
  gameId,
  player1,
  player2,
}) {
  const text =
    `⚔️ <b>Game #${escapeHtml(gameId)}</b> joined\n` +
    `P1: <code>${escapeHtml(shortWallet(player1))}</code>\n` +
    `P2: <code>${escapeHtml(shortWallet(player2))}</code>\n` +
    `Reveal phase is now live.`;

  return sendTelegramGroupMessage(text);
}

export async function sendTelegramReveal({
  gameId,
  revealedBy,
  player1Revealed = false,
  player2Revealed = false,
}) {
  const revealCount =
    Number(!!player1Revealed) + Number(!!player2Revealed);

  const text =
    `📂 <b>Game #${escapeHtml(gameId)}</b> reveal update\n` +
    `Revealed by: <code>${escapeHtml(shortWallet(revealedBy))}</code>\n` +
    `Progress: <b>${revealCount}/2</b>`;

  return sendTelegramGroupMessage(text);
}

export async function sendTelegramBothRevealed({ gameId }) {
  const text =
    `🧮 <b>Game #${escapeHtml(gameId)}</b> both players revealed\n` +
    `Settlement is being processed.`;

  return sendTelegramGroupMessage(text);
}

export async function sendTelegramGameSettled({
  gameId,
  winner,
  tie = false,
}) {
  const text = tie
    ? `🤝 <b>Game #${escapeHtml(gameId)}</b> settled\nResult: <b>Tie</b>`
    : `🏆 <b>Game #${escapeHtml(gameId)}</b> settled\nWinner: <code>${escapeHtml(
        shortWallet(winner)
      )}</code>`;

  return sendTelegramGroupMessage(text);
}

export async function sendTelegramGameCancelled({
  gameId,
  cancelledBy,
}) {
  const text =
    `❌ <b>Game #${escapeHtml(gameId)}</b> cancelled\n` +
    `By: <code>${escapeHtml(shortWallet(cancelledBy))}</code>`;

  return sendTelegramGroupMessage(text);
}

export async function sendTelegramTestMessage() {
  return sendTelegramGroupMessage(
    `✅ <b>Core Clash bot test</b>\nTelegram notifications are working.`
  );
}

export async function getTelegramUpdates(offset) {
  if (!isTelegramConfigured()) {
    throw new Error(
      "Telegram bot not configured. Missing TELEGRAM_BOT_TOKEN or TELEGRAM_GROUP_CHAT_ID."
    );
  }

  const payload = {
    timeout: 10,
  };

  if (offset !== undefined) {
    payload.offset = offset;
  }

  try {
    return await telegramRequest(TELEGRAM_API_BASE, "getUpdates", payload);
  } catch (err) {
    console.error("getTelegramUpdates failed:", err.message);
    return [];
  }
}

// Helper function to format the week range for a given weekKey (e.g. "2024-W30")
function formatWeekRangeFromKey(weekKey) {
  const start = new Date(`${weekKey}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);

  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return `${fmt.format(start)} - ${fmt.format(end)}`;
}

function buildWeeklyLeaderboardText(weekKey, top3 = []) {
  const weekLabel = formatWeekRangeFromKey(weekKey);

  let text =
    `📊 <b>Core Clash Weekly Leaderboard</b>\n` +
    `🗓️ <b>${escapeHtml(weekLabel)}</b>\n`;

  if (!Array.isArray(top3) || top3.length === 0) {
    return (
      text +
      `\nNo settled games recorded for this week yet.`
    );
  }

  const medals = ["🥇", "🥈", "🥉"];

  const rows = top3.map((entry, i) => {
    return (
      `${medals[i] || "🏅"} <code>${escapeHtml(shortWallet(entry.address))}</code>\n` +
      `Played: <b>${escapeHtml(entry.played)}</b> • ` +
      `Wins: <b>${escapeHtml(entry.wins)}</b> • ` +
      `Win Rate: <b>${escapeHtml(entry.winRate)}%</b>`
    );
  });

  return `${text}\n${rows.join("\n\n")}`;
}

// New function to send the final weekly leaderboard message to Telegram, which rebuilds the leaderboard for the week that just ended and locks it in
export async function sendTelegramFinalWeeklyLeaderboard() {
  const now = new Date();

  // Rebuild the leaderboard for the week that is just ending
  const { weekKey } = await rebuildWeeklyLeaderboardForDate(now);
  const sorted = await getWeeklyLeaderboardsSorted();
  const top3 = sorted[weekKey] || [];

  const weekLabel = formatWeekRangeFromKey(weekKey);

  let text =
    `🏁 <b>Final Weekly Leaderboard</b>\n` +
    `Week: <b>${escapeHtml(weekLabel)}</b>\n\n`;

  if (!Array.isArray(top3) || top3.length === 0) {
    text += `No settled games were recorded for this week.`;
    text += buildFooter();
    return sendTelegramGroupMessage(text);
  }

  const medals = ["🥇", "🥈", "🥉"];

const leaderboardRewards = {
  1: { attack: 1, defense: 1, vitality: 1, agility: 1 },
  2: { attack: 0.5, defense: 0.5, vitality: 0.5, agility: 0.5 },
  3: { attack: 0.1, defense: 0.1, vitality: 0.1, agility: 0.1 },
};

top3.forEach((entry, i) => {
  const rank = i + 1;
  const reward = leaderboardRewards[rank];

  text +=
    `${medals[i] || "🏅"} <code>${escapeHtml(shortWallet(entry.address))}</code>\n` +
    `Played: <b>${escapeHtml(entry.played)}</b>\n` +
    `Wins: <b>${escapeHtml(entry.wins)}</b>\n` +
    `Win Rate: <b>${escapeHtml(entry.winRate)}%</b>\n`;

  if (reward) {
    text +=
      `Perks Awarded: ` +
      `<b>+${reward.attack}</b> Attack, ` +
      `<b>+${reward.defense}</b> Defense, ` +
      `<b>+${reward.vitality}</b> Vitality, ` +
      `<b>+${reward.agility}</b> Agility\n`;
  }

  text += `\n`;
});

  text += `🎉 <b>This week is now locked in.</b>`;
  text += buildFooter();

  return sendTelegramGroupMessage(text);
}

// Helper to format USD values with appropriate decimal places and commas
function formatUsd(value) {
  if (value == null || !Number.isFinite(value)) return null;

  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getSwapTelegramDestination(destination = "MAIN_ALERTS") {
  if (destination === "ALL_SWAPS") {
    return {
      chatId: CLUB_ALL_SWAPS_CHAT_ID,
      threadId: CLUB_ALL_SWAPS_MESSAGE_THREAD_ID
        ? Number(CLUB_ALL_SWAPS_MESSAGE_THREAD_ID)
        : null,
    };
  }

  return {
    chatId: CLUB_TELEGRAM_CHAT_ID,
    threadId: CLUB_TELEGRAM_MESSAGE_THREAD_ID
      ? Number(CLUB_TELEGRAM_MESSAGE_THREAD_ID)
      : null,
  };
}

// Main function to send swap messages to Telegram with rich formatting and media support
export async function sendSwapMessage({
  symbol,
  side,                    // "BUY" or "SELL"
  baseAmount,
  quoteAmount,
  quoteSymbol,  
  trader,
  txHash,
  usdValue,
  tokenPriceUsd,
  imageFileId,
  image,
  animationUrl,
  animationFileId,
  extraHtml = "",          // for multi-hop route info
  includeFooter = true,
  destination = "MAIN_ALERTS",
}) {
try {
  const txUrl = `${EXPLORER_BASE_URL}/tx/${txHash}`;
  const traderUrl = `${EXPLORER_BASE_URL}/address/${trader}`;

  const emoji = side === "SELL" ? "🔴" : "🟢";
  const action = side === "SELL" ? "SELL" : "BUY";

// repeat emoji 10 times
const emojiLine = emoji.repeat(10);

const titleLine =
  usdValue != null
    ? `${emojiLine}\n<b>${escapeHtml(symbol)} ${action}</b> ($${formatUsd(usdValue)})\n`
    : `${emojiLine}\n<b>${escapeHtml(symbol)} ${action}</b>\n`;

  const priceLine =
    tokenPriceUsd != null && Number.isFinite(tokenPriceUsd)
      ? `💵 <b>${escapeHtml(symbol)} Price:</b> $${formatUsdPrice(tokenPriceUsd)}`
      : null;

  let text = [
    titleLine,
    `💰 <b>${side === "SELL" ? "Received" : "Paid"}:</b> ${escapeHtml(quoteAmount)} ${escapeHtml(quoteSymbol)}`,
    `🔢 <b>Amount:</b> ${escapeHtml(baseAmount)} ${escapeHtml(symbol)}`,
    priceLine,
    "",
    `👤 <b>Buyer:</b> <a href="${traderUrl}">${escapeHtml(shortAddr(trader))}</a>`,
    `🔗 <a href="${txUrl}">View Transaction</a>`,
    "",
  ].filter(Boolean).join("\n");

  if (includeFooter) {
    text += buildClubFooter();
  }

const { chatId, threadId } = getSwapTelegramDestination(destination);

if (!CLUB_TELEGRAM_BOT_TOKEN || !chatId) {
  console.warn(`[Telegram] Swap destination not configured: ${destination}`);
  return null;
}

const basePayload = {
  chat_id: chatId,
  parse_mode: "HTML",
  disable_web_page_preview: true,
};

if (threadId != null && Number.isFinite(threadId)) {
  basePayload.message_thread_id = threadId;
}

const shouldSendMedia = destination !== "ALL_SWAPS" && side !== "SELL";

    // Animation / Photo / Text fallback (same as before)
    if (shouldSendMedia && (animationFileId || animationUrl)) {
      try {
        await axios.post(`https://api.telegram.org/bot${CLUB_TELEGRAM_BOT_TOKEN}/sendAnimation`, {
          ...basePayload,
          animation: animationFileId || animationUrl,
          caption: text,
        });
        return;
      } catch (err) {
        console.error("[Telegram] Animation failed:", err.message);
      }
    }

    if (shouldSendMedia && (imageFileId || image)) {
      try {
        await axios.post(`https://api.telegram.org/bot${CLUB_TELEGRAM_BOT_TOKEN}/sendPhoto`, {
          ...basePayload,
          photo: imageFileId || image,
          caption: text,
        });
        return;
      } catch (err) {
        console.error("[Telegram] Photo failed:", err.message);
      }
    }

    // Plain text fallback
    await axios.post(`https://api.telegram.org/bot${CLUB_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      ...basePayload,
      text,
    });

  } catch (err) {
    console.error("[Telegram] sendSwapMessage error:", err.response?.data || err.message || err);
  }
}

// New function to send the weekly leaderboard message to Telegram
export async function sendTelegramWeeklyLeaderboard() {
  const { weekKey } = await rebuildWeeklyLeaderboardForDate(new Date());
  const sorted = await getWeeklyLeaderboardsSorted();
  const top3 = sorted[weekKey] || [];

  const text = buildWeeklyLeaderboardText(weekKey, top3);
  return sendTelegramGroupMessage(text);
}

// New function to send the all-time leaderboard message to Telegram
export async function sendTelegramAllTimeLeaderboard() {
  const top10 = buildAllTimeTop10();

  let text =
    `🏆 <b>All-Time Leaderboard</b>\n\n`;

  if (!top10.length) {
    text += `No games have been settled yet.`;
    text += buildFooter();
    return sendTelegramGroupMessage(text);
  }

  const medals = ["🥇", "🥈", "🥉"];

  top10.forEach((entry, i) => {
    const rank = i + 1;

    text +=
      `${medals[i] || `#${rank}`} <code>${escapeHtml(shortWallet(entry.address))}</code>\n` +
      `Played: <b>${escapeHtml(entry.played)}</b> | ` +
      `Wins: <b>${escapeHtml(entry.wins)}</b> | ` +
      `Win Rate: <b>${escapeHtml(entry.winRate)}%</b>\n\n`;
  });

  return sendTelegramGroupMessage(text);
}

export async function sendTelegramRevealDeadlineSoon({
  gameId,
  player1,
  player2,
  deadlineAt,
}) {
  const deadlineLabel = new Date(deadlineAt).toUTCString();

  const text =
    `⏳ <b>Reveal deadline approaching</b>\n` +
    `Game: <b>#${escapeHtml(gameId)}</b>\n` +
    `P1: <code>${escapeHtml(shortWallet(player1))}</code>\n` +
    `P2: <code>${escapeHtml(shortWallet(player2))}</code>\n` +
    `Deadline: <b>${escapeHtml(deadlineLabel)}</b>\n\n` +
    `Only 1 day remains to reveal.`;

  return sendTelegramGroupMessage(text);
}

export async function sendTelegramRevealDeadlinePassed({
  gameId,
  player1,
  player2,
  deadlineAt,
}) {
  const deadlineLabel = new Date(deadlineAt).toUTCString();

  const text =
    `⏱ <b>Reveal deadline expired</b>\n` +
    `Game: <b>#${escapeHtml(gameId)}</b>\n` +
    `P1: <code>${escapeHtml(shortWallet(player1))}</code>\n` +
    `P2: <code>${escapeHtml(shortWallet(player2))}</code>\n` +
    `Deadline: <b>${escapeHtml(deadlineLabel)}</b>\n\n` +
    `This game can now be settled.`;

  return sendTelegramGroupMessage(text);
}

// New function to send an NFT photo to the Zephyros Telegram topic, which is separate from the main group thread and can be used for NFT announcements related to Planet Zephyros that aren't tied to specific games
export async function sendZephyrosNftPhoto({ caption, imagePath }) {
  if (!isZephyrosTelegramConfigured()) {
    console.warn("Zephyros Telegram bot not configured; skipping NFT photo:", caption);
    return null;
  }

  if (!imagePath || !fs.existsSync(imagePath)) {
    throw new Error(`NFT image not found: ${imagePath}`);
  }

  const formData = new FormData();
  formData.append("chat_id", TELEGRAM_GROUP_CHAT_ID);
  formData.append("caption", caption + buildFooter());
  formData.append("parse_mode", "HTML");
  formData.append("disable_web_page_preview", "true");
  formData.append("message_thread_id", String(ZEPHYROS_NFT_MESSAGE_THREAD_ID));

  const fileBuffer = fs.readFileSync(imagePath);
  const fileName = path.basename(imagePath);
  const blob = new Blob([fileBuffer]);
  formData.append("photo", blob, fileName);

  const res = await fetch(`${ZEPHYROS_TELEGRAM_API_BASE}/sendPhoto`, {
    method: "POST",
    body: formData,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok) {
    throw new Error(
      data?.description || `Telegram sendPhoto failed with status ${res.status}`
    );
  }

  return data.result;
}

// New function to send messages to the Zephyros Telegram topic, which is separate from the main group thread and can be used for more general announcements that aren't tied to specific games
export async function sendZephyrosNftMessage(text) {
  if (!isZephyrosTelegramConfigured()) {
    console.warn("Zephyros Telegram bot not configured; skipping NFT message:", text);
    return null;
  }

  const payload = {
    chat_id: TELEGRAM_GROUP_CHAT_ID,
    text: text + buildFooter(),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    message_thread_id: ZEPHYROS_NFT_MESSAGE_THREAD_ID,
  };

  try {
    return await telegramRequest(
      ZEPHYROS_TELEGRAM_API_BASE,
      "sendMessage",
      payload
    );
  } catch (err) {
    console.error("sendZephyrosNftMessage failed:", err.message);
    throw err;
  }
}

function tokenUrl(contractAddress, tokenId) {
  return `${ELECTROSWAP_BASE_URL}/nfts/asset/${contractAddress}/${tokenId}`;
}

function txUrl(txHash) {
  return `${EXPLORER_BASE_URL}/tx/${txHash}`;
}

function addrUrl(address) {
  return `${EXPLORER_BASE_URL}/address/${address}`;
}

export async function sendTelegramNftMint({
  collectionName,
  contractAddress,
  tokenId,
  buyer,
  txHash,
  tokenURI,
}) {
  const caption =
    `🧬 <b>${escapeHtml(collectionName)} Mint</b>\n\n` +
    `Token: <b>#${escapeHtml(tokenId)}</b>\n` +
    `Collector: <a href="${addrUrl(buyer)}">${escapeHtml(shortWallet(buyer))}</a>\n` +
    `NFT: <a href="${tokenUrl(contractAddress, tokenId)}">View NFT</a>\n` +
    `Tx: <a href="${txUrl(txHash)}">View Transaction</a>`;

  const image = resolveExistingNftImage({
    contractAddress,
    tokenId,
    tokenURI,
  });

  if (image.absolutePath) {
    return sendZephyrosNftPhotoMessage({
      caption,
      photoPath: image.absolutePath,
    });
  }

  return sendZephyrosNftMessage(caption);
}

export async function sendTelegramNftSale({
  collectionName,
  contractAddress,
  tokenId,
  seller,
  buyer,
  price,
  currencySymbol = "ETN",
  txHash,
  tokenURI,
}) {
  const caption =
    `💰 <b>${escapeHtml(collectionName)} Sale</b>\n\n` +
    `Token: <b>#${escapeHtml(tokenId)}</b>\n` +
    `Seller: <a href="${addrUrl(seller)}">${escapeHtml(shortWallet(seller))}</a>\n` +
    `Buyer: <a href="${addrUrl(buyer)}">${escapeHtml(shortWallet(buyer))}</a>\n` +
    `Price: <b>${escapeHtml(price)} ${escapeHtml(currencySymbol)}</b>\n` +
    `NFT: <a href="${tokenUrl(contractAddress, tokenId)}">View NFT</a>\n` +
    `Tx: <a href="${txUrl(txHash)}">View Transaction</a>`;

  const image = resolveExistingNftImage({
    contractAddress,
    tokenId,
    tokenURI,
  });

  if (image.absolutePath) {
    return sendZephyrosNftPhotoMessage({
      caption,
      photoPath: image.absolutePath,
    });
  }

  return sendZephyrosNftMessage(caption);
}

const ADVERT_MESSAGES = [
  `🎮 <b>Core Clash</b>\n\n` +
    `Ready for another battle?\n\n` +
    `Stake, Reveal, Battle, Win with your playable cards.\n\n` +
    `⚔️ <a href="https://coreclash.planetzephyros.xyz">Play Core Clash</a>`,

  `🧬 <b>Mint Aether Scions</b>\n\n` +
    `Aether Scions are playable cards in Core Clash.\n\n` +
    `Build your team, test your matchups, and bring them into battle.\n\n` +
    `🌍 <a href="https://app.electroswap.io/nfts/collection/0xAc620b1A3dE23F4EB0A69663613baBf73F6C535D">Mint / Learn More</a>`,

  `🔥 <b>Build Your XP</b>\n\n` +
    `Keep playing Core Clash to build XP and climb the ranks.\n\n` +
    `XP helps you work toward earning $CORE and <b>Guardians of Erevos</b> playable cards.\n\n` +
    `🎮 <a href="https://coreclash.planetzephyros.xyz">Play Core Clash</a>`,
];

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function randomDelayWithinDayMs() {
  return Math.floor(Math.random() * ONE_DAY_MS);
}

export async function sendZephyrosAdvertByIndex(index) {
  const text = ADVERT_MESSAGES[index % ADVERT_MESSAGES.length];
  return sendZephyrosNftMessage(text);
}

function getDateKey(date = new Date()) {
  return date.toISOString().split("T")[0];
}

function buildDailyAdvertQueue(date = new Date()) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  return ADVERT_MESSAGES.map((_, index) => ({
    index,
    sendAt: new Date(dayStart.getTime() + randomDelayWithinDayMs()).toISOString(),
    sent: false,
  })).sort((a, b) => new Date(a.sendAt) - new Date(b.sendAt));
}

export function startZephyrosAdvertScheduler() {
  let state = readAdvertState();
  const todayKey = getDateKey(new Date());

  if (!state.firstStartupSent) {
    console.log("[TG AD] First startup → sending first advert immediately");

    sendZephyrosAdvertByIndex(0)
      .then(() => {
        const fresh = readAdvertState();
        writeAdvertState({
          ...fresh,
          firstStartupSent: true,
          lastSentAt: new Date().toISOString(),
        });
      })
      .catch((err) =>
        console.error("[TG AD] Initial send failed:", err.message || err)
      );
  }

  if (!state.scheduleDate || state.scheduleDate !== todayKey) {
    state = {
      ...state,
      scheduleDate: todayKey,
      dailyQueue: buildDailyAdvertQueue(new Date()),
    };

    writeAdvertState(state);
  }

  const tick = async () => {
    const fresh = readAdvertState();
    const currentDateKey = getDateKey(new Date());

    if (fresh.scheduleDate !== currentDateKey) {
      writeAdvertState({
        ...fresh,
        scheduleDate: currentDateKey,
        dailyQueue: buildDailyAdvertQueue(new Date()),
      });
      return;
    }

    const queue = Array.isArray(fresh.dailyQueue) ? fresh.dailyQueue : [];
    const now = Date.now();
    let dirty = false;

    for (const item of queue) {
      if (!item.sent && new Date(item.sendAt).getTime() <= now) {
        await sendZephyrosAdvertByIndex(item.index);
        item.sent = true;
        dirty = true;
      }
    }

    if (dirty) {
      writeAdvertState({
        ...fresh,
        dailyQueue: queue,
        lastSentAt: new Date().toISOString(),
      });
    }
  };

  setInterval(() => {
    tick().catch((err) =>
      console.error("[TG AD] Daily scheduler failed:", err.message || err)
    );
  }, 60 * 1000);

  tick().catch((err) =>
    console.error("[TG AD] Initial scheduler tick failed:", err.message || err)
  );
}

export {
  isTelegramConfigured,
  isZephyrosTelegramConfigured,
  escapeHtml,
  shortWallet,
  formatTokenAmount,
};