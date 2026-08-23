// backend/utils/dataDir.js
//
// Single source of truth for where backend state lives on disk.
//
// On Render's paid tier a persistent disk was mounted at /backend/data, so
// every store module hardcoded that path (some with no fallback at all,
// which crashed the app if the disk wasn't there). The free tier has no
// persistent disk, so /backend/data may not exist at all — in that case we
// fall back to a "data" directory inside the project itself. That directory
// is ephemeral (wiped on every redeploy/restart), which is fine: r2Sync.js
// mirrors everything under BASE_DATA_DIR to Cloudflare R2 on write and
// restores it back on boot.
//
// DATA_DIR / RENDER_DISK_PATH still let you point at a specific mount if
// you ever add a disk back.
import fs from "fs";
import path from "path";

export const BASE_DATA_DIR =
  process.env.DATA_DIR ||
  process.env.RENDER_DISK_PATH ||
  (fs.existsSync("/backend/data")
    ? "/backend/data"
    : path.join(process.cwd(), "data"));

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Every module that imports BASE_DATA_DIR gets a guarantee it already exists.
ensureDir(BASE_DATA_DIR);

console.log("[dataDir] BASE_DATA_DIR =", BASE_DATA_DIR);

/**
 * Turn an absolute path under BASE_DATA_DIR into a forward-slash-separated
 * relative key, e.g. "cache/owners.json". Used as the R2 object key so the
 * bucket mirrors the on-disk layout 1:1.
 */
export function toDataKey(absolutePath) {
  return path
    .relative(BASE_DATA_DIR, absolutePath)
    .split(path.sep)
    .join("/");
}

/** Inverse of toDataKey: R2 key -> absolute local path under BASE_DATA_DIR. */
export function fromDataKey(key) {
  return path.join(BASE_DATA_DIR, ...key.split("/"));
}
