import { ethers } from "ethers";
import { sendCoreDripNotification } from "./telegramBot.js";

import {
    RPC_URL,
    BACKEND_PRIVATE_KEY,
    DRIP_FUNDER_ADDRESS
} from "../config.js";

import dripABI from "../../src/abis/dripABI.json" with { type: "json" };

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

const ABI = dripABI;

let isRunning = false;
let contractWithSigner = null;

export async function startDripBot() {
    if (isRunning) return;

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(BACKEND_PRIVATE_KEY, provider);
    
    const contract = new ethers.Contract(DRIP_FUNDER_ADDRESS, ABI, provider);
    const contractWithSigner = new ethers.Contract(DRIP_FUNDER_ADDRESS, ABI, wallet);

    console.log("\n=== Drip Bot Initialization ===");
    console.log("Bot Wallet Address :", wallet.address);
    console.log("Drip Contract      :", DRIP_FUNDER_ADDRESS);

    // Tightened Owner Check
    try {
        const owner = await contract.owner();
        const normalizedOwner = owner.toLowerCase();
        const normalizedWallet = wallet.address.toLowerCase();

        console.log("Contract Owner     :", owner);
        console.log("Normalized Owner   :", normalizedOwner);
        console.log("Normalized Wallet  :", normalizedWallet);
        console.log("Owner Match?       :", normalizedOwner === normalizedWallet);

        if (normalizedOwner !== normalizedWallet) {
            console.error("❌ CRITICAL: Backend wallet is NOT the contract owner!");
            console.error("   Expected:", normalizedWallet);
            console.error("   Got     :", normalizedOwner);
        } else {
            console.log("✅ Owner verification PASSED");
        }
    } catch (e) {
        console.error("❌ Failed to read contract owner:", e.message);
    }

    isRunning = true;

    setInterval(async () => {
        try {
            const nextDripIn = await contract.nextDripIn();

            if (Number(nextDripIn) === 0) {
                console.log(`\n[${new Date().toLocaleString()}] ✅ Time to drip! Executing...`);

                const tx = await contractWithSigner.drip({
                    gasLimit: 400000   // Higher buffer
                });

                console.log(`📤 Tx sent: ${tx.hash}`);
                const receipt = await tx.wait();
                console.log(`✅ Drip SUCCESS! Block: ${receipt.blockNumber}`);
            } else {
                const hoursLeft = (Number(nextDripIn) / 3600).toFixed(1);
                console.log(`[${new Date().toLocaleString()}] ⏳ Next drip in ~${hoursLeft} hours`);
            }
        } catch (error) {
            console.error("❌ Drip Bot Error:", error.message);
            if (error.data) console.error("   Raw Data:", error.data);
        }
    }, CHECK_INTERVAL_MS);
}