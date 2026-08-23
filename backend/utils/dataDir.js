// backend/utils/dataDir.js
//
// Single source of truth for where backend state lives on disk.
//
// On Render's paid tier a persistent disk was mounted at /backend/data, so
// every store module hardcoded that path (some with no fallback at all,
// which crashed the app if the disk wasn't there). The free tier has no
// persistent disk, so /backend/data may not exist — or may exist as a
// leftover, unwritable mount point after a disk was detached — in which
// case we fall back to a "data" directory inside the project itself. That
// directory is ephemeral (wiped on every redeploy/restart), which is fine:
// r2Sync.js mirrors everything under BASE_DATA_DIR to Cloudflare R2 on
// write and restores it back on boot.
//
// DATA_DIR / RENDER_DISK_PATH still let you point at a specific mount if
// you ever add a disk back. Each candidate is verified to actually be
// creatable/writable before we commit to it — a stale env var pointing at
// a path the process no longer has permission to touch (e.g. left set
// after removing a Render disk) falls through to the next candidate
// instead of crashing the whole process at import time.
import fs from "fs";
import path from "path";

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isUsableDataDir(dir) {
  try {
    ensureDir(dir);
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (err) {
    console.warn(`[dataDir] "${dir}" is not usable (${err.code || err.message}), trying next candidate`);
    return false;
  }
}

function resolveBaseDataDir() {
  const candidates = [
    process.env.DATA_DIR,
    process.env.RENDER_DISK_PATH,
    "/backend/data",
  ].filter(Boolean);

  for (const dir of candidates) {
    if (isUsableDataDir(dir)) return dir;
  }

  // Nothing configured/mounted worked — fall back to a directory inside
  // the project itself, which the process always owns.
  const fallback = path.join(process.cwd(), "data");
  ensureDir(fallback);
  return fallback;
}

export const BASE_DATA_DIR = resolveBaseDataDir();

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
