import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { RPC_URL, BACKEND_PRIVATE_KEY, CORE_TOKEN_ADDRESS, EVG_CONTRACT_ADDRESS } from "../config.js";

const DATA_DIR = "/backend/data";
const XP_FILE = path.join(DATA_DIR, "playerXp.json");
const XP_ACTIONS_FILE = path.join(DATA_DIR, "xpActions.json");

const CORE_REWARD_LEVELS = [1, 2, 3, 4, 5];
const CORE_REWARD_AMOUNT = "10";
const ETN_REWARD_LEVEL = 1;
const ETN_REWARD_AMOUNT = "1";

const ERC20ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
];

const EVGABI = [
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

export const XP_REWARDS = {
  LOGIN: 5,
  ECOSYSTEM_CLICK: 5,
  CREATE_GAME: 25,
  JOIN_GAME: 15,
  REVEAL: 25,
  SETTLE: 30,
};

export const XP_LEVELS = [
  { level: 0, minXp: 0, bonuses: { attack: 0, defense: 0, vitality: 0, agility: 0 } },
  { level: 1, minXp: 50, bonuses: { attack: 2, defense: 0, vitality: 0, agility: 0 } },
  { level: 2, minXp: 100, bonuses: { attack: 2, defense: 4, vitality: 0, agility: 0 } },
  { level: 3, minXp: 200, bonuses: { attack: 2, defense: 4, vitality: 5, agility: 0 } },
  { level: 4, minXp: 400, bonuses: { attack: 2, defense: 4, vitality: 5, agility: 5 } },
  { level: 5, minXp: 800, bonuses: { attack: 7, defense: 4, vitality: 5, agility: 5 } },
  { level: 6, minXp: 1600, bonuses: { attack: 7, defense: 9, vitality: 5, agility: 5 } },
  { level: 7, minXp: 3200, bonuses: { attack: 7, defense: 9, vitality: 10, agility: 5 } },
  { level: 8, minXp: 6400, bonuses: { attack: 7, defense: 9, vitality: 10, agility: 15 } },
  { level: 9, minXp: 12800, bonuses: { attack: 17, defense: 9, vitality: 10, agility: 15 } },
  { level: 10, minXp: 25600, bonuses: { attack: 17, defense: 19, vitality: 10, agility: 15 } },
];

// Weekly leaderboard bonuses are additive on top of regular level bonuses and last for 7 days. They are awarded based on the player's rank in the weekly leaderboard snapshot:
export const WEEKLY_LEADERBOARD_BONUSES = {
  1: { attack: 1, defense: 1, vitality: 1, agility: 1 },
  2: { attack: 0.5, defense: 0.5, vitality: 0.5, agility: 0.5 },
  3: { attack: 0.1, defense: 0.1, vitality: 0.1, agility: 0.1 },
};

export function awardWeeklyLeaderboardBonuses(weekKey, top3 = []) {
  const all = readPlayerXp();

  for (let i = 0; i < top3.length; i++) {
    const rank = i + 1;
    const walletLc = top3[i].address?.toLowerCase();
    const bonus = WEEKLY_LEADERBOARD_BONUSES[rank];

    if (!walletLc || !bonus) continue;

    if (!all[walletLc]) {
      const levelData = getLevelData(0);
      all[walletLc] = {
        wallet: walletLc,
        xp: 0,
        level: levelData.level,
        statsBonus: levelData.bonuses,
        weeklyLeaderboardBonus: { attack: 0, defense: 0, vitality: 0, agility: 0 },
        weeklyLeaderboardRewards: [],
        rewardedLevels: [],
        evgRewardedLevels: [],
        etnLevel1Rewarded: false,
        updatedAt: new Date().toISOString(),
      };
    }

    if (!Array.isArray(all[walletLc].weeklyLeaderboardRewards)) {
      all[walletLc].weeklyLeaderboardRewards = [];
    }

    const alreadyRewarded = all[walletLc].weeklyLeaderboardRewards.some(
      (r) => r.weekKey === weekKey
    );

    if (alreadyRewarded) continue;

    const current = all[walletLc].weeklyLeaderboardBonus || {
      attack: 0,
      defense: 0,
      vitality: 0,
      agility: 0,
    };

    all[walletLc].weeklyLeaderboardBonus = {
      attack: Number((current.attack + bonus.attack).toFixed(2)),
      defense: Number((current.defense + bonus.defense).toFixed(2)),
      vitality: Number((current.vitality + bonus.vitality).toFixed(2)),
      agility: Number((current.agility + bonus.agility).toFixed(2)),
    };

    all[walletLc].weeklyLeaderboardRewards.push({
      weekKey,
      rank,
      bonus,
      awardedAt: new Date().toISOString(),
    });

    all[walletLc].updatedAt = new Date().toISOString();
  }

  writePlayerXp(all);
}

///* ---------------- Core Token Reward Logic ---------------- */
function getRewardableLevelsCrossed(oldLevel, newLevel, rewardedLevels = []) {
  const alreadyRewarded = new Set(rewardedLevels);
  const crossed = [];

  for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
    if (CORE_REWARD_LEVELS.includes(lvl) && !alreadyRewarded.has(lvl)) {
      crossed.push(lvl);
    }
  }

  return crossed;
}

function crossedSpecificLevel(oldLevel, newLevel, targetLevel) {
  return oldLevel < targetLevel && newLevel >= targetLevel;
}

async function sendCoreReward(toWallet, level) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const adminWallet = new ethers.Wallet(BACKEND_PRIVATE_KEY, provider);
  const coreToken = new ethers.Contract(CORE_TOKEN_ADDRESS, ERC20ABI, adminWallet);

  const amountWei = ethers.parseUnits(CORE_REWARD_AMOUNT, 18);

  const tx = await coreToken.transfer(toWallet, amountWei);
  await tx.wait(1);

  return {
    level,
    amount: CORE_REWARD_AMOUNT,
    txHash: tx.hash,
  };
}

async function sendEtnReward(toWallet) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const adminWallet = new ethers.Wallet(BACKEND_PRIVATE_KEY, provider);

  const tx = await adminWallet.sendTransaction({
    to: toWallet,
    value: ethers.parseEther(ETN_REWARD_AMOUNT),
  });

  await tx.wait(1);

  return {
    token: "ETN",
    level: ETN_REWARD_LEVEL,
    amount: ETN_REWARD_AMOUNT,
    txHash: tx.hash,
  };
}

// ---------- EVG REWARDS ------------- //
const NFT_REWARD_LEVELS = [6, 7, 8, 10];

const NFT_TOKEN_RANGES = {
  6: { start: 1, end: 250 },
  7: { start: 251, end: 500 },
  8: { start: 501, end: 750 },
  10: { start: 651, end: 1000 },
};

function getNftRewardableLevelsCrossed(oldLevel, newLevel, evgRewardedLevels = []) {
  const alreadyRewarded = new Set(evgRewardedLevels);
  const crossed = [];

  for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
    if (NFT_REWARD_LEVELS.includes(lvl) && !alreadyRewarded.has(lvl)) {
      crossed.push(lvl);
    }
  }

  return crossed;
}

// ------- BACKFILL ---------- //
export async function backfillEvgRewardsForExistingPlayers() {
  const all = readPlayerXp();
  const results = [];

  for (const [walletLc, player] of Object.entries(all)) {
    const playerLevel = Number(player.level || 0);

    if (!Array.isArray(player.evgRewardedLevels)) {
      player.evgRewardedLevels = [];
    }

    const missingLevels = NFT_REWARD_LEVELS.filter((lvl) => {
      return playerLevel >= lvl && !player.evgRewardedLevels.includes(lvl);
    });

    for (const lvl of missingLevels) {
      try {
        const reward = await sendNftReward(walletLc, lvl);

        player.evgRewardedLevels.push(lvl);
        player.updatedAt = new Date().toISOString();
        writePlayerXp(all);

        results.push({
          wallet: walletLc,
          level: lvl,
          success: true,
          tokenId: reward.tokenId,
          txHash: reward.txHash,
        });

        console.log(
          `Backfilled EVG reward: level ${lvl}, wallet ${walletLc}, tokenId ${reward.tokenId}, tx ${reward.txHash}`
        );
      } catch (err) {
        results.push({
          wallet: walletLc,
          level: lvl,
          success: false,
          error: err.message || String(err),
        });

        console.error(
          `Failed to backfill EVG reward for ${walletLc} level ${lvl}:`,
          err.message || err
        );
      }
    }
  }

  writePlayerXp(all);

  return results;
}

///* ---------------- XP & Leveling Logic ---------------- */
export async function adjustXp(wallet, amount) {
  const walletLc = String(wallet).toLowerCase();
  const all = readPlayerXp();

  if (!all[walletLc]) {
    const levelData = getLevelData(0);
all[walletLc] = {
  wallet: walletLc,
  xp: 0,
  level: levelData.level,
  statsBonus: levelData.bonuses,
  rewardedLevels: [],
  evgRewardedLevels: [],
  etnLevel1Rewarded: false,
  updatedAt: new Date().toISOString(),
};
  }

  const oldLevel = all[walletLc].level || 0;

  const rewardedLevels = Array.isArray(all[walletLc].rewardedLevels)
    ? all[walletLc].rewardedLevels
    : [];

  const evgRewardedLevels = Array.isArray(all[walletLc].evgRewardedLevels)
  ? all[walletLc].evgRewardedLevels
  : [];

  const etnLevel1Rewarded = Boolean(all[walletLc].etnLevel1Rewarded);

  all[walletLc].xp = Math.max(0, all[walletLc].xp + amount);

  const levelData = getLevelData(all[walletLc].xp);
  const newLevel = levelData.level;

  all[walletLc].level = newLevel;
  all[walletLc].statsBonus = levelData.bonuses;
  all[walletLc].rewardedLevels = rewardedLevels;
  all[walletLc].evgRewardedLevels = evgRewardedLevels;
  all[walletLc].etnLevel1Rewarded = etnLevel1Rewarded;
  all[walletLc].updatedAt = new Date().toISOString();

  writePlayerXp(all);

  // Declared before any reward loop uses it — this used to be declared
  // further down, after the NFT-reward loop already referenced it, which
  // threw a "Cannot access 'rewardResults' before initialization" error
  // on every level-up that crossed an NFT-reward level. That error was
  // thrown *after* sendNftReward() had already transferred a real NFT
  // on-chain but *before* evgRewardedLevels.push(lvl) ran, so the "already
  // rewarded" bookkeeping never persisted and the same level could be
  // rewarded again on a later crossing. See CoreClash audit finding #4.
  const rewardResults = [];

  const crossedRewardLevels = getRewardableLevelsCrossed(
    oldLevel,
    newLevel,
    rewardedLevels
  );

const crossedNftRewardLevels = getNftRewardableLevelsCrossed(
  oldLevel,
  newLevel,
  evgRewardedLevels
);

for (const lvl of crossedNftRewardLevels) {
  try {
    const reward = await sendNftReward(walletLc, lvl);
    rewardResults.push(reward);

    all[walletLc].evgRewardedLevels.push(lvl);
    all[walletLc].updatedAt = new Date().toISOString();
    writePlayerXp(all);

    console.log(
      `NFT reward sent: level ${lvl}, wallet ${walletLc}, tokenId ${reward.tokenId}, tx ${reward.txHash}`
    );
  } catch (err) {
    console.error(
      `Failed to send NFT reward for wallet ${walletLc} at level ${lvl}:`,
      err.message || err
    );
  }
}

  const shouldSendEtnLevel1 =
    !etnLevel1Rewarded && crossedSpecificLevel(oldLevel, newLevel, ETN_REWARD_LEVEL);

  for (const lvl of crossedRewardLevels) {
    try {
      const reward = await sendCoreReward(walletLc, lvl);
      rewardResults.push(reward);

      all[walletLc].rewardedLevels.push(lvl);
      all[walletLc].updatedAt = new Date().toISOString();
      writePlayerXp(all);

      console.log(
        `CORE reward sent: level ${lvl}, wallet ${walletLc}, tx ${reward.txHash}`
      );
    } catch (err) {
      console.error(
        `Failed to send CORE reward for wallet ${walletLc} at level ${lvl}:`,
        err.message || err
      );
    }
  }

  if (shouldSendEtnLevel1) {
    try {
      const reward = await sendEtnReward(walletLc);
      rewardResults.push(reward);

      all[walletLc].etnLevel1Rewarded = true;
      all[walletLc].updatedAt = new Date().toISOString();
      writePlayerXp(all);

      console.log(
        `ETN reward sent: level 1, wallet ${walletLc}, tx ${reward.txHash}`
      );
    } catch (err) {
      console.error(
        `Failed to send ETN reward for wallet ${walletLc} at level 1:`,
        err.message || err
      );
    }
  }
  
  return {
    ...all[walletLc],
    rewardResults,
  };
}

export async function awardXp(wallet, amount) {
  return adjustXp(wallet, Math.abs(amount));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureFile(filePath) {
  ensureDir(path.dirname(filePath));

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({}, null, 2), "utf8");
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) {
    fs.writeFileSync(filePath, JSON.stringify({}, null, 2), "utf8");
  }
}

function readJsonFile(filePath) {
  ensureFile(filePath);

  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error(`Corrupt JSON detected in ${filePath}:`, err.message);

    fs.writeFileSync(filePath, JSON.stringify({}, null, 2), "utf8");
    return {};
  }
}

function writeJsonFile(filePath, data) {
  ensureFile(filePath);

  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

export function readPlayerXp() {
  return readJsonFile(XP_FILE);
}

export function writePlayerXp(data) {
  writeJsonFile(XP_FILE, data);
}

export function readXpActions() {
  return readJsonFile(XP_ACTIONS_FILE);
}

export function writeXpActions(data) {
  writeJsonFile(XP_ACTIONS_FILE, data);
}

export function getLevelData(xp = 0) {
  let current = XP_LEVELS[0];

  for (const lvl of XP_LEVELS) {
    if (xp >= lvl.minXp) current = lvl;
    else break;
  }

  return current;
}

export function ensurePlayer(wallet) {
  const walletLc = String(wallet).toLowerCase();
  const all = readPlayerXp();

  if (!all[walletLc]) {
    const levelData = getLevelData(0);
    all[walletLc] = {
      wallet: walletLc,
      xp: 0,
      level: levelData.level,
      statsBonus: levelData.bonuses,
      rewardedLevels: [],
      evgRewardedLevels: [],
      etnLevel1Rewarded: false,
      updatedAt: new Date().toISOString(),
    };
    writePlayerXp(all);
  }

  return all[walletLc];
}

export function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

///* ---------------- Daily Login XP ---------------- */
export async function awardDailyLoginXp(wallet) {
  const walletLc = String(wallet).toLowerCase();
  const actions = readXpActions();
  const today = getTodayDateString();

  if (!actions[walletLc]) {
    actions[walletLc] = {
      dailyLogin: { lastClaimedDate: null },
      ecosystemClicks: {},
    };
  }

  if (actions[walletLc].dailyLogin?.lastClaimedDate === today) {
    return { awarded: false, reason: "already_claimed_today" };
  }

  actions[walletLc].dailyLogin = { lastClaimedDate: today };
  writeXpActions(actions);

  const player = await awardXp(walletLc, XP_REWARDS.LOGIN);
  return { awarded: true, amount: XP_REWARDS.LOGIN, player };
}

///* ---------------- Ecosystem Click XP ---------------- */
export async function awardEcosystemClickXp(wallet, linkKey) {
  const walletLc = String(wallet).toLowerCase();
  const actions = readXpActions();
  const today = getTodayDateString();

  if (!actions[walletLc]) {
    actions[walletLc] = {
      dailyLogin: { lastClaimedDate: null },
      ecosystemClicks: {},
    };
  }

  const clicks = actions[walletLc].ecosystemClicks || {};

  if (clicks[linkKey] === today) {
    return { awarded: false, reason: "already_claimed_for_link_today" };
  }

  clicks[linkKey] = today;
  actions[walletLc].ecosystemClicks = clicks;
  writeXpActions(actions);

  const player = await awardXp(walletLc, XP_REWARDS.ECOSYSTEM_CLICK);
  return { awarded: true, amount: XP_REWARDS.ECOSYSTEM_CLICK, player };
}

// ----------- EVG REWARDS ------------- //
async function findAvailableNftTokenId(level, adminAddress, nftContract) {
  const range = NFT_TOKEN_RANGES[level];
  if (!range) return null;

  for (let tokenId = range.start; tokenId <= range.end; tokenId++) {
    try {
      const owner = await nftContract.ownerOf(tokenId);

      if (owner.toLowerCase() === adminAddress.toLowerCase()) {
        return tokenId;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function sendNftReward(toWallet, level) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const adminWallet = new ethers.Wallet(BACKEND_PRIVATE_KEY, provider);
  const evgContract = new ethers.Contract(EVG_CONTRACT_ADDRESS, EVGABI, adminWallet);

  const tokenId = await findAvailableNftTokenId(
    level,
    adminWallet.address,
    evgContract
  );

  if (!tokenId) {
    throw new Error(`No available NFT left for level ${level}`);
  }

  const tx = await evgContract.safeTransferFrom(
    adminWallet.address,
    toWallet,
    tokenId
  );

  await tx.wait(1);

  return {
    token: "XP_NFT",
    level,
    tokenId,
    txHash: tx.hash,
  };
}

console.log("[XP] DATA_DIR:", DATA_DIR);
console.log("[XP] XP_FILE:", XP_FILE);
console.log("[XP] XP_ACTIONS_FILE:", XP_ACTIONS_FILE);