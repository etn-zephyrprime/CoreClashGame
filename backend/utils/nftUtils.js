import { ethers } from "ethers";
import { RPC_URL, VKIN_CONTRACT_ADDRESS, VQLE_CONTRACT_ADDRESS } from "../config.js";
import VKIN_ABI from "../../src/abis/VKINABI.json" with { type: "json" };
import VQLE_ABI from "../../src/abis/VQLEABI.json" with { type: "json" };
import SCIONS_ABI from "../../src/abis/SCIONSABI.json" with { type: "json" };
import EVG_ABI from "../../src/abis/EVGABI.json" with { type: "json" };

const provider = new ethers.JsonRpcProvider(RPC_URL);

const delay = ms => new Promise(r => setTimeout(r, ms));

export async function fetchOwnedTokenIds(contract, wallet, collection) {
  console.log("fetchOwnedTokenIds called:", { wallet, collection });

  const tokenIds = [];
  const walletLc = wallet.toLowerCase();

  if (!["VKIN", "VQLE", "SCIONS", "EVG"].includes(collection)) {
    throw new Error(`Unknown collection: ${collection}`);
  }

  if (collection === "VKIN") {
    const rawBalance = await contract.balanceOf(wallet);
    const balance = Number(rawBalance);

    if (!Number.isInteger(balance) || balance < 0) {
      throw new Error(`Invalid ${collection} balance for ${wallet}: ${rawBalance}`);
    }

    console.log(`${collection} balance: ${balance}`);

    for (let i = 0; i < balance; i++) {
      await delay(200);
      try {
        const tokenId = await contract.tokenOfOwnerByIndex(wallet, i);
        tokenIds.push(tokenId.toString());
      } catch (err) {
        console.warn(`Failed ${collection} index ${i}: ${err.message}`);
      }
    }
  } else if (collection === "VQLE") {
    const MAX_TOKEN_ID = 30;
    console.log(`Scanning VQLE 1 to ${MAX_TOKEN_ID}`);

    for (let t = 1; t <= MAX_TOKEN_ID; t++) {
      await delay(200);
      try {
        const owner = await contract.ownerOf(BigInt(t));
        if (owner.toLowerCase() === walletLc) {
          tokenIds.push(t.toString());
        }
      } catch {
        continue;
      }
    }
  } else if (collection === "SCIONS") {
    const rawTotalSupply = await contract.totalSupply();
    const totalSupply = Number(rawTotalSupply);

    if (!Number.isInteger(totalSupply) || totalSupply < 0) {
      throw new Error(`Invalid SCIONS totalSupply: ${rawTotalSupply}`);
    }

    console.log(`Scanning SCIONS 1 to ${totalSupply}`);

    for (let t = 1; t <= totalSupply; t++) {
      await delay(200);
      try {
        const owner = await contract.ownerOf(BigInt(t));
        if (owner.toLowerCase() === walletLc) {
          tokenIds.push(t.toString());
        }
      } catch (err) {
        continue;
      }
    }
  } else if (collection === "EVG") {
    const MAX_TOKEN_ID = 1000;
    console.log(`Scanning EVG 1 to ${MAX_TOKEN_ID}`);

    for (let t = 1; t <= MAX_TOKEN_ID; t++) {
      await delay(200);
      try {
        const owner = await contract.ownerOf(BigInt(t));
        if (owner.toLowerCase() === walletLc) {
          tokenIds.push(t.toString());
        }
      } catch {
        continue;
      }
    }
  }

  console.log(`Fetched ${tokenIds.length} ${collection} tokens for ${wallet}`);
  return tokenIds;
}