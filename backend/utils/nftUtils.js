import { ethers } from "ethers";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const OWNER_SCAN_DELAY_MS = 500;

function isRateLimitError(err) {
  const text = JSON.stringify(err || {}).toLowerCase();
  const message = String(err?.message || "").toLowerCase();

  return (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("-32090") ||
    text.includes("rate limit") ||
    text.includes("too many requests") ||
    text.includes("-32090")
  );
}

async function rpcCallWithRetry(fn, label, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || i === attempts - 1) {
        throw err;
      }

      const waitMs = 10_000 * (i + 1);
      console.warn(
        `[RPC RATE LIMIT] ${label} failed. Retrying in ${waitMs / 1000}s...`
      );

      await delay(waitMs);
    }
  }
}

async function safeOwnerOf(contract, tokenId, collection) {
  try {
    return await rpcCallWithRetry(
      () => contract.ownerOf(BigInt(tokenId)),
      `${collection}.ownerOf(${tokenId})`
    );
  } catch (err) {
    // ownerOf can revert for nonexistent/burned tokens.
    // Only throw if this was a rate-limit style failure after retries.
    if (isRateLimitError(err)) {
      throw err;
    }

    return null;
  }
}

export async function fetchOwnedTokenIds(contract, wallet, collection) {
  console.log("fetchOwnedTokenIds called:", { wallet, collection });

  if (!wallet || !ethers.isAddress(wallet)) {
    throw new Error(`Invalid wallet address: ${wallet}`);
  }

  if (!["VKIN", "VQLE", "SCIONS", "EVG"].includes(collection)) {
    throw new Error(`Unknown collection: ${collection}`);
  }

  const tokenIds = [];
  const walletLc = wallet.toLowerCase();

  if (collection === "VKIN") {
    const rawBalance = await rpcCallWithRetry(
      () => contract.balanceOf(wallet),
      `${collection}.balanceOf(${wallet})`
    );

    const balance = Number(rawBalance);

    if (!Number.isInteger(balance) || balance < 0) {
      throw new Error(`Invalid ${collection} balance for ${wallet}: ${rawBalance}`);
    }

    console.log(`${collection} balance: ${balance}`);

    for (let i = 0; i < balance; i++) {
      await delay(OWNER_SCAN_DELAY_MS);

      const tokenId = await rpcCallWithRetry(
        () => contract.tokenOfOwnerByIndex(wallet, i),
        `${collection}.tokenOfOwnerByIndex(${wallet}, ${i})`
      );

      tokenIds.push(tokenId.toString());
    }
  }

  if (collection === "VQLE") {
    const MAX_TOKEN_ID = 30;
    console.log(`Scanning VQLE 1 to ${MAX_TOKEN_ID}`);

    for (let tokenId = 1; tokenId <= MAX_TOKEN_ID; tokenId++) {
      await delay(OWNER_SCAN_DELAY_MS);

      const owner = await safeOwnerOf(contract, tokenId, collection);

      if (owner && owner.toLowerCase() === walletLc) {
        tokenIds.push(String(tokenId));
      }
    }
  }

  if (collection === "SCIONS") {
    const rawTotalSupply = await rpcCallWithRetry(
      () => contract.totalSupply(),
      `SCIONS.totalSupply()`
    );

    const totalSupply = Number(rawTotalSupply);

    if (!Number.isInteger(totalSupply) || totalSupply < 0) {
      throw new Error(`Invalid SCIONS totalSupply: ${rawTotalSupply}`);
    }

    console.log(`Scanning SCIONS 1 to ${totalSupply}`);

    for (let tokenId = 1; tokenId <= totalSupply; tokenId++) {
      await delay(OWNER_SCAN_DELAY_MS);

      const owner = await safeOwnerOf(contract, tokenId, collection);

      if (owner && owner.toLowerCase() === walletLc) {
        tokenIds.push(String(tokenId));
      }
    }
  }

  if (collection === "EVG") {
    const MAX_TOKEN_ID = 1000;
    console.log(`Scanning EVG 1 to ${MAX_TOKEN_ID}`);

    for (let tokenId = 1; tokenId <= MAX_TOKEN_ID; tokenId++) {
      await delay(OWNER_SCAN_DELAY_MS);

      const owner = await safeOwnerOf(contract, tokenId, collection);

      if (owner && owner.toLowerCase() === walletLc) {
        tokenIds.push(String(tokenId));
      }
    }
  }

  console.log(`Fetched ${tokenIds.length} ${collection} tokens for ${wallet}`);
  return tokenIds;
}