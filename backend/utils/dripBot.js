import { ethers } from "ethers";
import { sendCoreDripNotification } from "./telegramBot.js";

import {
    RPC_URL,
    BACKEND_PRIVATE_KEY,
    DRIP_FUNDER_ADDRESS
} from "../config.js";

import dripABI from "../../src/abis/dripABI.json" with { type: "json" };

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let isRunning = false;

export async function startDripBot() {
    if (isRunning) return;

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(BACKEND_PRIVATE_KEY, provider);
    
    const contract = new ethers.Contract(DRIP_FUNDER_ADDRESS, dripABI, provider);
    const contractWithSigner = new ethers.Contract(DRIP_FUNDER_ADDRESS, dripABI, wallet);

    console.log("\n=== Drip Bot Initialization ===");
    console.log("Bot Wallet Address :", wallet.address);
    console.log("Drip Contract      :", DRIP_FUNDER_ADDRESS);

    // Owner check
    try {
        const owner = await contract.owner();
        if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
            console.error("❌ CRITICAL: Backend wallet is NOT the contract owner!");
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
                    gasLimit: 400000
                });

                console.log(`📤 Tx sent: ${tx.hash}`);

                const receipt = await tx.wait();
                console.log(`✅ Drip SUCCESS! Block: ${receipt.blockNumber}`);

                // === ADD THIS: Send Telegram Notification ===
                await sendDripNotification(contract, tx.hash);

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

// Helper function to get drip stats and send notification
async function sendDripNotification(contract, txHash) {
    try {
        // Get current drip stats from contract
        const totalDripped = await contract.totalDripped();
        const remainingDrips = await contract.remainingDrips(); // assuming this exists

        const amount = "500"; // Most drip contracts drip fixed 500 CORE

        await sendCoreDripNotification({
            amount,
            txHash,
            remainingDrips: Number(remainingDrips),
            totalDripped: totalDripped.toString()
        });

        console.log("✅ Telegram drip notification sent");
    } catch (err) {
        console.error("❌ Failed to send drip notification:", err.message);
        // Don't throw — we don't want notification failure to break the drip
    }
}