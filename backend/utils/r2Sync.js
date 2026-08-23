// backend/utils/r2Sync.js
//
// Write-through backup of backend/data to Cloudflare R2, plus restore-on-boot
// so a disk-less free-tier instance picks back up where the last one left
// off instead of starting empty on every restart/redeploy.
import fs from "fs";
import path from "path";
import PQueue from "p-queue";
import { R2_ENABLED, putObject, getObject, listAllKeys } from "./r2Client.js";
import { toDataKey, fromDataKey, ensureDir } from "./dataDir.js";

// Keeps R2 uploads from piling up unbounded if something writes in a hot
// loop (e.g. generateMapping fetching hundreds of NFTs back to back).
const uploadQueue = new PQueue({ concurrency: 8 });

/**
 * Best-effort, fire-and-forget mirror of a local file to R2. Never throws —
 * a failed backup must never take down a write that already succeeded on
 * local disk, which stays the source of truth for the running process.
 *
 * Call this right after any fs.writeFileSync/fs.renameSync that lands under
 * BASE_DATA_DIR.
 */
export function queueR2Upload(absolutePath) {
  if (!R2_ENABLED) return;

  const key = toDataKey(absolutePath);

  uploadQueue
    .add(async () => {
      const body = await fs.promises.readFile(absolutePath);
      await putObject(key, body);
    })
    .catch((err) => {
      console.error(`[R2] failed to sync ${key}:`, err.message || err);
    });
}

/** Waits for any uploads still in flight. Mostly useful in tests/scripts. */
export async function flushR2Uploads() {
  await uploadQueue.onIdle();
}

/**
 * Restores every object in the bucket that's missing locally, into its
 * corresponding path under BASE_DATA_DIR. Safe to call every boot — files
 * that already exist locally are left alone (local disk always wins; this
 * only fills in gaps left by a fresh/ephemeral filesystem).
 */
export async function restoreDataFromR2() {
  if (!R2_ENABLED) {
    console.log("[R2] disabled, skipping restore-from-R2");
    return { restored: 0, skipped: 0 };
  }

  console.log("[R2] checking for data to restore...");

  const keys = await listAllKeys();
  const missing = keys.filter((key) => !fs.existsSync(fromDataKey(key)));

  if (missing.length === 0) {
    console.log(`[R2] ${keys.length} object(s) in bucket, all already present locally`);
    return { restored: 0, skipped: keys.length };
  }

  console.log(`[R2] restoring ${missing.length} missing file(s) out of ${keys.length}...`);

  const restoreQueue = new PQueue({ concurrency: 8 });
  let restored = 0;

  await Promise.all(
    missing.map((key) =>
      restoreQueue.add(async () => {
        try {
          const body = await getObject(key);
          if (!body) return;

          const localPath = fromDataKey(key);
          ensureDir(path.dirname(localPath));
          fs.writeFileSync(localPath, body);
          restored++;
        } catch (err) {
          console.error(`[R2] failed to restore ${key}:`, err.message || err);
        }
      })
    )
  );

  console.log(`[R2] restore complete — ${restored}/${missing.length} file(s) restored`);
  return { restored, skipped: keys.length - missing.length };
}
