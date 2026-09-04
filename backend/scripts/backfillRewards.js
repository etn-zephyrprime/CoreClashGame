// backend/scripts/backfillRewards.js
//
// Pays out CORE token, ETN, and EVG NFT rewards that were legitimately
// earned (per the restored playerXp.json) but never sent — the pre-existing
// silent-failure bug in adjustXp()'s reward loop (try/catch, log-and-move-on,
// no retry) meant most level-ups never got their reward. This is unrelated
// to the data wipe; it's a real backlog.
//
// MUST be run on the server, after scripts/reconstructPlayerXp.js --write
// has already run — it needs the real BACKEND_PRIVATE_KEY env var to send
// these, and it needs playerXp.json's rewardedLevels/evgRewardedLevels/
// etnLevel1Rewarded to already reflect what's *actually* been paid
// on-chain (verified independently), or it will double-pay.
//
// This SENDS REAL FUNDS/NFTS. Dry-run first and read the output carefully —
// each `[owed]` line is a payment this run will make with --write.
//
//   node scripts/backfillRewards.js            # dry run — lists what's owed, sends nothing
//   node scripts/backfillRewards.js --write     # sends every owed CORE/ETN/EVG reward

import {
  readPlayerXp,
  backfillCoreEtnRewardsForExistingPlayers,
  backfillEvgRewardsForExistingPlayers,
  CORE_REWARD_LEVELS,
  ETN_REWARD_LEVEL,
  NFT_REWARD_LEVELS,
} from "../utils/playerXp.js";
import { flushR2Uploads } from "../utils/r2Sync.js";

const WRITE = process.argv.includes("--write");

function printOwed() {
  const all = readPlayerXp();
  let totalCore = 0;
  let totalEtn = 0;
  let totalNft = 0;

  for (const [wallet, player] of Object.entries(all)) {
    const level = Number(player.level || 0);
    const rewardedLevels = player.rewardedLevels || [];
    const evgRewardedLevels = player.evgRewardedLevels || [];

    const owedCore = CORE_REWARD_LEVELS.filter((lvl) => level >= lvl && !rewardedLevels.includes(lvl));
    const owedEtn = level >= ETN_REWARD_LEVEL && !player.etnLevel1Rewarded;
    const owedNft = NFT_REWARD_LEVELS.filter((lvl) => level >= lvl && !evgRewardedLevels.includes(lvl));

    if (owedCore.length || owedEtn || owedNft.length) {
      console.log(
        `[owed] ${wallet}  level=${level}` +
          (owedCore.length ? `  CORE levels ${owedCore.join(",")} (${owedCore.length * 10} CORE)` : "") +
          (owedEtn ? `  ETN level-1 (1 ETN)` : "") +
          (owedNft.length ? `  EVG NFT levels ${owedNft.join(",")}` : "")
      );
      totalCore += owedCore.length;
      totalEtn += owedEtn ? 1 : 0;
      totalNft += owedNft.length;
    }
  }

  console.log(`\nTotals owed: ${totalCore * 10} CORE across ${totalCore} level-crossings, ${totalEtn} ETN payment(s), ${totalNft} EVG NFT(s).`);
}

async function main() {
  printOwed();

  if (!WRITE) {
    console.log("\nDry run only — pass --write to actually send these.");
    return;
  }

  console.log("\nSending CORE + ETN backfill...");
  const coreEtnResults = await backfillCoreEtnRewardsForExistingPlayers();
  console.log(`CORE/ETN backfill done: ${coreEtnResults.filter((r) => r.success).length}/${coreEtnResults.length} succeeded.`);
  const coreEtnFailed = coreEtnResults.filter((r) => !r.success);
  if (coreEtnFailed.length) {
    console.log("Failed CORE/ETN sends (re-run this script to retry — already-sent ones won't be repeated):");
    coreEtnFailed.forEach((r) => console.log(`  ${r.wallet} ${r.token} level ${r.level}: ${r.error}`));
  }

  console.log("\nSending EVG NFT backfill...");
  const nftResults = await backfillEvgRewardsForExistingPlayers();
  console.log(`EVG backfill done: ${nftResults.filter((r) => r.success).length}/${nftResults.length} succeeded.`);
  const nftFailed = nftResults.filter((r) => !r.success);
  if (nftFailed.length) {
    console.log("Failed NFT sends (re-run this script to retry):");
    nftFailed.forEach((r) => console.log(`  ${r.wallet} level ${r.level}: ${r.error}`));
  }

  // Both backfill functions above call writePlayerXp() repeatedly (once per successful send) --
  // each of those queues an R2 upload but doesn't wait for it. Drain the whole queue here before
  // the process exits, or the rewardedLevels/evgRewardedLevels/etnLevel1Rewarded bookkeeping for
  // everything just sent may never actually reach R2, and the next cold start on Render's free
  // tier would revert it -- which would make the next run of this script think those rewards
  // were never sent and pay them again.
  console.log("\nFlushing to R2...");
  await flushR2Uploads();
  console.log("R2 upload confirmed.");
}

main().catch((err) => {
  console.error("backfillRewards failed:", err);
  process.exit(1);
});
