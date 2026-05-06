import { ethers } from "ethers";
import {
  RPC_URL,
  BACKEND_PRIVATE_KEY,
  EVG_CONTRACT_ADDRESS,
} from "../backend/config.js";

const EVGABI = [
  "function presaleMint(uint256 quantity, bytes32[] proof) payable",
  "function totalSupply() view returns (uint256)",
  "function presale() view returns (uint256 startTimestamp,uint256 endTimestamp,uint256 price,uint256 maxSupply,bytes32 merkleRoot)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(BACKEND_PRIVATE_KEY, provider);
  const evg = new ethers.Contract(EVG_CONTRACT_ADDRESS, EVGABI, wallet);

  const presale = await evg.presale();
  const price = presale.price;

  const targetSupply = 1000;
  const batchSize = 20;

  // Because only the backend wallet is whitelisted, proof should be empty.
  const proof = [];

  let currentSupply = Number(await evg.totalSupply());

  while (currentSupply < targetSupply) {
    const remaining = targetSupply - currentSupply;
    const qty = Math.min(batchSize, remaining);
    const value = price * BigInt(qty);

    console.log(`Presale minting ${qty} NFTs...`);

    const tx = await evg.presaleMint(qty, proof, { value });
    await tx.wait(1);

    currentSupply = Number(await evg.totalSupply());
    console.log(`Total supply now: ${currentSupply}`);
  }

  console.log("Done. Backend wallet now owns minted EVG NFTs.");
}

main().catch(console.error);