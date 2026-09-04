// backend/utils/walletLock.js
//
// Per-wallet serialization for XP-awarding operations (see adjustXp() in
// playerXp.js). A separate lock from utils/mutex.js's global withLock() on
// purpose: routes/games.js already calls awardXp()/adjustXp() from *inside*
// an active withLock() block (the settle route holds the games-store lock
// while awarding SETTLE XP) -- reusing that same non-reentrant global lock
// here would deadlock the entire backend the moment a game settled, since
// the lock can only be released by code that itself is waiting on it.
//
// Locking per-wallet (instead of one more global lock) also keeps different
// players' XP awards concurrent -- only two operations racing for the SAME
// wallet are serialized, which is exactly what closes the double-reward
// race: two near-simultaneous awards reading the same pre-award
// rewardedLevels/evgRewardedLevels/etnLevel1Rewarded state and both sending
// the same level's reward before either persists it.

const queues = new Map(); // wallet (lowercase) -> tail promise of its queue

export function withWalletLock(wallet, fn) {
  const key = String(wallet).toLowerCase();
  const prior = queues.get(key) || Promise.resolve();

  // Run fn() once whatever was queued before it has settled, regardless of
  // whether that prior operation succeeded or failed.
  const run = prior.then(() => fn(), () => fn());

  // Keep the queue's tail pointing at this call (via a version that never
  // rejects) so the next caller for this wallet waits for it too, without a
  // failed operation poisoning the queue for everyone after it.
  queues.set(key, run.then(() => {}, () => {}));

  return run;
}
