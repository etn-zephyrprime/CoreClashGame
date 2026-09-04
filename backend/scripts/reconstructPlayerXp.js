// backend/scripts/reconstructPlayerXp.js
//
// One-time data-recovery script for the R2-migration gap that wiped
// backend/data/playerXp.json and backend/data/xpActions.json.
//
// Run this ON THE SERVER (Render shell, or wherever BASE_DATA_DIR points at
// the real data), so it reads/writes the actual live files via the app's
// own store helpers — never a manually copied snapshot.
//
//   node scripts/reconstructPlayerXp.js            # dry run — prints the table only
//   node scripts/reconstructPlayerXp.js --write     # also writes playerXp.json
//
// ---------------------------------------------------------------------------
// WHAT THIS DOES
// ---------------------------------------------------------------------------
// 1. Replays backend/games/games.json (the on-chain-resynced game history —
//    unaffected by the wipe, since creator/joiner/settled/revealed/cancelled
//    all live on the Game contract itself) through the exact same XP rules
//    routes/games.js uses live: CREATE_GAME/JOIN_GAME/REVEAL/SETTLE. A game
//    that was created and never joined, then reclaimed (on-chain: settled
//    with no player2), nets to zero XP — matching the CREATE_GAME revert in
//    the real cancel-unjoined flow.
//
// 2. Separately, reads the reward treasury wallet's *actual* on-chain
//    transfer history (CORE token, ETN, EVG NFT) via the Blockscout API.
//    This is used ONLY to set rewardedLevels / evgRewardedLevels /
//    etnLevel1Rewarded to what has REALLY been paid — never inferred from
//    XP alone — so adjustXp() can't double-pay a level that was already
//    rewarded. Levels crossed-but-unpaid are left OFF those arrays on
//    purpose, so scripts/backfillCoreEtnRewards.js (and the existing
//    backfillEvgRewardsForExistingPlayers) can pay out what's still owed.
//
// 3. Any wallet that received a reward transfer but never appears in
//    games.json (i.e. they leveled purely off daily-login/ecosystem-click
//    XP, which is NOT recoverable — xpActions.json was wiped too) is added
//    at the conservative floor implied by what they're proven to have
//    reached: the minXp of the highest level whose reward they verifiably
//    received. This mirrors the original "floor of level" recovery policy,
//    scoped to exactly the cases with no exact data.
//
// A known pre-existing bug (see CoreClash audit finding #4 — duplicate
// reward on a level crossing that throws before bookkeeping persists) means
// a couple of wallets hold one extra EVG NFT / ETN payment. Per decision,
// this script does NOT try to claw anything back — it just marks those
// levels paid so nothing further is sent for them.
// ---------------------------------------------------------------------------

import { readGames } from "../store/gamesStore.js";
import { flushR2Uploads } from "../utils/r2Sync.js";
import {
  XP_LEVELS,
  getLevelData,
  readPlayerXp,
  writePlayerXp,
  CORE_REWARD_LEVELS,
  CORE_REWARD_AMOUNT,
  ETN_REWARD_LEVEL,
  ETN_REWARD_AMOUNT,
  NFT_REWARD_LEVELS,
  NFT_TOKEN_RANGES,
} from "../utils/playerXp.js";
import { EVG_CONTRACT_ADDRESS, CORE_TOKEN_ADDRESS, EXPLORER_BASE_URL } from "../config.js";

const WRITE = process.argv.includes("--write");
const ZERO = "0x0000000000000000000000000000000000000000";

// The wallet the backend's reward functions (sendCoreReward/sendEtnReward/
// sendNftReward) actually send from — i.e. BACKEND_PRIVATE_KEY's address.
// Confirmed independently: holds the EVG reward inventory and is the `from`
// on every reward transfer below. Not read from env here on purpose — this
// script only needs to READ its public transfer history, never its key.
const REWARD_TREASURY = "0x21e0056663f3f1d237353F0bbA7ED5cf62D09637";

function levelIndexFor(xp) {
  return getLevelData(xp).level;
}

// ---------------------------------------------------------------------------
// STEP 1 — replay games.json into raw per-wallet XP
// ---------------------------------------------------------------------------
function reconstructGameXp() {
  const games = readGames();
  const REWARDS = { CREATE_GAME: 25, JOIN_GAME: 15, REVEAL: 25, SETTLE: 30 };
  const xp = {};
  const detail = {};

  const add = (wallet, amount, reason) => {
    if (!wallet) return;
    const w = wallet.toLowerCase();
    xp[w] = (xp[w] || 0) + amount;
    detail[w] = detail[w] || {};
    detail[w][reason] = (detail[w][reason] || 0) + amount;
  };

  const hasP2 = (g) => g.player2 && g.player2.toLowerCase() !== ZERO;

  let selfCancelled = 0;
  for (const game of games) {
    const p1 = game.player1 ? game.player1.toLowerCase() : null;
    const p2 = hasP2(game) ? game.player2.toLowerCase() : null;

    // On-chain fingerprint of a creator reclaiming their own unfilled game:
    // no player2, but a terminal "settled" state. CREATE_GAME XP was
    // awarded then reverted by the real cancel-unjoined flow -> nets to 0.
    const isSelfCancelled = !p2 && game.settled;
    if (isSelfCancelled) {
      selfCancelled++;
      continue;
    }

    if (p1) add(p1, REWARDS.CREATE_GAME, "CREATE_GAME");
    if (p2) add(p2, REWARDS.JOIN_GAME, "JOIN_GAME");
    if (game.player1Revealed && p1) add(p1, REWARDS.REVEAL, "REVEAL");
    if (game.player2Revealed && p2) add(p2, REWARDS.REVEAL, "REVEAL");
    if (game.settled && p2) {
      add(p1, REWARDS.SETTLE, "SETTLE");
      add(p2, REWARDS.SETTLE, "SETTLE");
    }
  }

  console.log(`[reconstruct] replayed ${games.length} games (${selfCancelled} self-cancelled/net-zero excluded)`);
  return { xp, detail };
}

// ---------------------------------------------------------------------------
// STEP 2 — pull the treasury's real reward-transfer history
// ---------------------------------------------------------------------------
async function fetchAllPages(url) {
  const items = [];
  let next = url;
  let guard = 0;
  while (next && guard < 50) {
    guard++;
    const res = await fetch(next);
    if (!res.ok) throw new Error(`${next} -> HTTP ${res.status}`);
    const j = await res.json();
    items.push(...(j.items || []));
    if (j.next_page_params) {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(j.next_page_params)) p.set(k, v);
      next = `${url}&${p.toString()}`;
    } else {
      next = null;
    }
  }
  return items;
}

async function fetchTreasuryRewardReceipts() {
  const base = `${EXPLORER_BASE_URL}/api/v2/addresses/${REWARD_TREASURY}`;

  const [nftTransfers, tokenTransfers, txs] = await Promise.all([
    fetchAllPages(`${base}/token-transfers?filter=from&type=ERC-721`),
    fetchAllPages(`${base}/token-transfers?filter=from&type=ERC-20`),
    fetchAllPages(`${base}/transactions?filter=from`),
  ]);

  // wallet(lowercase) -> Set<level> actually confirmed paid an EVG NFT
  const evgPaid = {};
  for (const t of nftTransfers) {
    if ((t.token?.address || "").toLowerCase() !== EVG_CONTRACT_ADDRESS.toLowerCase()) continue;
    const tokenId = Number(t.total?.token_id);
    const to = (t.to?.hash || "").toLowerCase();
    if (!to || Number.isNaN(tokenId)) continue;

    const level = NFT_REWARD_LEVELS.find((lvl) => {
      const range = NFT_TOKEN_RANGES[lvl];
      return range && tokenId >= range.start && tokenId <= range.end;
    });
    if (level == null) continue; // outside any known range — skip rather than guess

    evgPaid[to] = evgPaid[to] || new Set();
    evgPaid[to].add(level);
  }

  // wallet(lowercase) -> count of confirmed 10-CORE reward payments
  const coreRewardCount = {};
  for (const t of tokenTransfers) {
    if ((t.token?.address || "").toLowerCase() !== CORE_TOKEN_ADDRESS.toLowerCase()) continue;
    if (t.token?.symbol !== "CORE") continue;
    const raw = BigInt(t.total?.value || "0");
    const expected = BigInt(CORE_REWARD_AMOUNT) * 10n ** 18n;
    if (raw !== expected) continue; // ignore other-purpose CORE transfers (liquidity, drip funding, etc.)
    const to = (t.to?.hash || "").toLowerCase();
    if (!to) continue;
    coreRewardCount[to] = (coreRewardCount[to] || 0) + 1;
  }

  // wallet(lowercase) -> confirmed ETN level-1 reward received (possibly more than once)
  const etnPaidCount = {};
  const expectedEtnWei = BigInt(ETN_REWARD_AMOUNT) * 10n ** 18n;
  for (const t of txs) {
    if (BigInt(t.value || "0") !== expectedEtnWei) continue;
    if (t.method) continue; // plain value transfer only, not a contract call that happens to move 1 ETN
    const to = (t.to?.hash || "").toLowerCase();
    if (!to) continue;
    etnPaidCount[to] = (etnPaidCount[to] || 0) + 1;
  }

  return { evgPaid, coreRewardCount, etnPaidCount };
}

// ---------------------------------------------------------------------------
// STEP 3 — combine, and print/write
// ---------------------------------------------------------------------------
async function main() {
  const { xp: gameXp, detail } = reconstructGameXp();
  const { evgPaid, coreRewardCount, etnPaidCount } = await fetchTreasuryRewardReceipts();

  const allWallets = new Set([
    ...Object.keys(gameXp),
    ...Object.keys(evgPaid),
    ...Object.keys(coreRewardCount),
    ...Object.keys(etnPaidCount),
  ]);

  const existing = readPlayerXp();
  const rows = [];

  for (const wallet of allWallets) {
    const fromGames = Object.prototype.hasOwnProperty.call(gameXp, wallet);
    let xp, level, source;

    if (fromGames) {
      xp = gameXp[wallet];
      level = levelIndexFor(xp);
      source = "games.json replay";
    } else {
      // "Ghost" wallet: never appears in games.json (leveled purely off
      // wiped login/ecosystem-click XP). Floor them at the minXp of the
      // highest level their reward receipts prove they reached.
      const provenCoreLevel = Math.min(coreRewardCount[wallet] || 0, CORE_REWARD_LEVELS.length);
      const provenNftLevel = evgPaid[wallet] ? Math.max(...evgPaid[wallet]) : 0;
      level = Math.max(provenCoreLevel, provenNftLevel, etnPaidCount[wallet] ? ETN_REWARD_LEVEL : 0);
      xp = XP_LEVELS[level]?.minXp ?? 0;
      source = "reward-receipt floor (not in games.json)";
    }

    const levelData = getLevelData(xp);

    // rewardedLevels: only levels with a matching CORE-reward transfer,
    // assigned to the lowest crossed-and-unpaid levels first (rewards are
    // sent in ascending order as thresholds are crossed, so N receipts
    // covers the first N eligible levels).
    const eligibleCoreLevels = CORE_REWARD_LEVELS.filter((lvl) => level >= lvl);
    const paidCoreCount = Math.min(coreRewardCount[wallet] || 0, eligibleCoreLevels.length);
    const rewardedLevels = eligibleCoreLevels.slice(0, paidCoreCount);

    const evgRewardedLevels = NFT_REWARD_LEVELS.filter((lvl) => level >= lvl && evgPaid[wallet]?.has(lvl));

    const etnLevel1Rewarded = Boolean(etnPaidCount[wallet]);

    rows.push({
      wallet,
      xp,
      level,
      statsBonus: levelData.bonuses,
      rewardedLevels,
      evgRewardedLevels,
      etnLevel1Rewarded,
      source,
      _coreReceiptsSeen: coreRewardCount[wallet] || 0,
      _coreLevelsOwedAfterThis: eligibleCoreLevels.filter((l) => !rewardedLevels.includes(l)),
      _nftLevelsOwedAfterThis: NFT_REWARD_LEVELS.filter((l) => level >= l && !evgRewardedLevels.includes(l)),
    });
  }

  rows.sort((a, b) => b.xp - a.xp);

  console.log("\n=== Reconstructed player XP ===\n");
  for (const r of rows) {
    console.log(
      `${r.wallet}  xp=${r.xp}  level=${r.level}  [${r.source}]` +
        (r._coreLevelsOwedAfterThis.length ? `  CORE STILL OWED: ${r._coreLevelsOwedAfterThis}` : "") +
        (r._nftLevelsOwedAfterThis.length ? `  NFT STILL OWED: ${r._nftLevelsOwedAfterThis}` : "")
    );
  }

  if (!WRITE) {
    console.log("\nDry run only — pass --write to save this into playerXp.json");
    return;
  }

  const now = new Date().toISOString();
  const merged = { ...existing };
  for (const r of rows) {
    merged[r.wallet] = {
      wallet: r.wallet,
      xp: r.xp,
      level: r.level,
      statsBonus: r.statsBonus,
      rewardedLevels: r.rewardedLevels,
      evgRewardedLevels: r.evgRewardedLevels,
      etnLevel1Rewarded: r.etnLevel1Rewarded,
      updatedAt: now,
    };
  }

  writePlayerXp(merged);

  // queueR2Upload() is fire-and-forget -- a short-lived CLI process like this one exiting before
  // the queued PUT actually lands means the write only ever hit local disk. On Render's free
  // tier that's not durable: it spins down on idle and cold-starts fresh from R2 on the next
  // request, so anything never actually confirmed in the bucket quietly reverts. Wait for the
  // queue to drain before letting the process exit.
  console.log("\nFlushing to R2...");
  await flushR2Uploads();
  console.log(`Wrote ${rows.length} wallet(s) to playerXp.json and confirmed the R2 upload.`);
}

main().catch((err) => {
  console.error("reconstructPlayerXp failed:", err);
  process.exit(1);
});
