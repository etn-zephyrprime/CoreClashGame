import { ethers } from "ethers";
import { sendCoreDripNotification } from "./telegramBot.js";

import {
    RPC_URL,
    BACKEND_PRIVATE_KEY,
    DRIP_FUNDER_ADDRESS
} from "../config.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Updated ABI with event
const ABI = [
    "function drip()",
    "function nextDripIn() view returns (uint256)",
    "function totalDripped() view returns (uint256)",
    "function totalToDrip() view returns (uint256)",
    "function startTimestamp() view returns (uint256)",
    
    // Event
    "event Dripped(uint256 amount, uint256 remainingToDrip, uint256 dripCount)"
];

let isRunning = false;
let contractWithSigner = null;

export async function startDripBot() {
    if (isRunning) return;

    if (!BACKEND_PRIVATE_KEY || !DRIP_FUNDER_ADDRESS || DRIP_FUNDER_ADDRESS.startsWith("0xYour")) {
        console.error("❌ Missing BACKEND_PRIVATE_KEY or DRIP_FUNDER_ADDRESS");
        return;
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(BACKEND_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(DRIP_FUNDER_ADDRESS, ABI, provider);
    contractWithSigner = new ethers.Contract(DRIP_FUNDER_ADDRESS, ABI, wallet);

    console.log(`🚀 Core Drip Bot Started (Event + Polling Mode)`);
    console.log(`📍 Contract: ${DRIP_FUNDER_ADDRESS}`);

    isRunning = true;

    // === Event Listener (Best way - catches manual calls too) ===
    contract.on("Dripped", async (amount, remainingToDrip, dripCount) => {
        console.log(`🔔 Dripped Event Detected! Amount: ${Number(amount) / 1e18} CORE`);

        await sendCoreDripNotification({
            amount: Number(amount) / 1e18,
            txHash: "Event", // We can improve this later with tx hash
            remainingDrips: Number(remainingToDrip) / (500 * 1e18),
            totalDripped: Number(amount) * Number(dripCount)
        }).catch(err => console.error("Telegram failed:", err.message));
    });

    // === Polling fallback (in case event misses) ===
    setInterval(async () => {
        try {
            const nextDripIn = await contract.nextDripIn();

            if (Number(nextDripIn) === 0) {
                console.log(`[${new Date().toLocaleString()}] ✅ Time to drip! Executing...`);

                const tx = await contractWithSigner.drip();
                console.log(`📤 Bot drip sent: ${tx.hash}`);
                await tx.wait();
            } else {
                const hoursLeft = (Number(nextDripIn) / 3600).toFixed(1);
                console.log(`[${new Date().toLocaleString()}] ⏳ Next drip in ~${hoursLeft} hours`);
            }
        } catch (error) {
            console.error(`❌ Drip Bot Error:`, error.message);
        }
    }, CHECK_INTERVAL_MS);
}