import { ethers } from "ethers";
import { sendCoreDripNotification } from "./telegramBot.js";

import {
    RPC_URL,
    BACKEND_PRIVATE_KEY,
    DRIP_FUNDER_ADDRESS
} from "../config.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

const ABI = [
    "function drip()",
    "function nextDripIn() view returns (uint256)",
    "function totalDripped() view returns (uint256)",
    "function totalToDrip() view returns (uint256)",
    "function startTimestamp() view returns (uint256)"
];

let isRunning = false;

export async function startDripBot() {
    if (isRunning) {
        console.log("✅ Drip Bot is already running");
        return;
    }

    if (!BACKEND_PRIVATE_KEY) {
        console.error("❌ BACKEND_PRIVATE_KEY is missing in .env");
        return;
    }

    if (!DRIP_FUNDER_ADDRESS || DRIP_FUNDER_ADDRESS.startsWith("0xYour")) {
        console.error("❌ DRIP_FUNDER_ADDRESS is not properly set in config.js");
        return;
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(BACKEND_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(DRIP_FUNDER_ADDRESS, ABI, wallet);

    console.log(`🚀 Core Drip Bot Started Successfully`);
    console.log(`📍 Wallet: ${wallet.address}`);
    console.log(`📍 Drip Contract: ${DRIP_FUNDER_ADDRESS}`);
    console.log(`🔄 Checking every 5 minutes...\n`);

    isRunning = true;

    setInterval(async () => {
        try {
            const nextDripIn = await contract.nextDripIn();
            const totalDripped = await contract.totalDripped();
            const totalToDrip = await contract.totalToDrip();

            const now = new Date();

            if (Number(nextDripIn) === 0) {
                console.log(`[${now.toLocaleString()}] ✅ Time to drip! Executing...`);

                const tx = await contract.drip();
                console.log(`📤 Transaction sent: ${tx.hash}`);

                const receipt = await tx.wait();
                console.log(`✅ Drip executed successfully! Block: ${receipt.blockNumber}`);

                // Send Telegram Notification
                const amount = 500;
                const remainingDrips = Number((totalToDrip - totalDripped) / BigInt(500 * 10 ** 18));

                await sendCoreDripNotification({
                    amount,
                    txHash: tx.hash,
                    remainingDrips,
                    totalDripped: Number(totalDripped)
                }).catch(err => console.error("Telegram notification failed:", err.message));

            } else {
                const hoursLeft = (Number(nextDripIn) / 3600).toFixed(1);
                console.log(`[${now.toLocaleString()}] ⏳ Next drip in ~${hoursLeft} hours`);
            }

            const remainingDrips = Number((totalToDrip - totalDripped) / BigInt(500 * 10 ** 18));
            console.log(`📊 Remaining drips: ${remainingDrips}\n`);

        } catch (error) {
            console.error(`❌ Drip Bot Error:`, error.message);
        }
    }, CHECK_INTERVAL_MS);
}