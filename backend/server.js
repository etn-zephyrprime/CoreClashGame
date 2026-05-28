import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

import { generateMapping } from "./utils/generateMapping.js";
import { checkFrontendMapping } from "../src/checkFrontendMapping.js";
import { initAdminWallet } from "./admin.js";
import { loadMapping, METADATA_JSON_DIR, METADATA_IMAGES_DIR, ensureDataPaths, FRONTEND_MAPPING_FILE } from "./paths.js";
import { readBurnTotal } from "./store/burnStore.js";

import gamesRouter from "./routes/games.js";
import sseRouter from "./routes/sse.js";
import nftsRouter from "./routes/nfts.js";
import leaderboardRouter from "./routes/leaderboard.js";
import xpRouter from "./routes/xp.js";
import testTelegramRoutes from "./routes/testTelegram.js";

import { startCoreBurnListener } from "./burnListener.js";
import { startSwapListener } from "./swapListener.js";
import { startNftMintListener } from "./nftMintListener.js";
import { startNftMarketplaceListener } from "./nftMarketplaceListener.js";

import { startZephyrosAdvertScheduler } from "./utils/telegramBot.js";
import { startInactiveXpReminderScheduler } from "./utils/inactiveXpReminder.js";
import { startDripBot } from "./utils/dripBot.js";

import { reconcileActiveGamesScheduled } from "./reconcile.js";
import { backfillWeeklyLeaderboardsFromGames } from "./store/weeklyLeaderboardStore.js";

// ---------------- CONFIG ----------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// ---------------- MIDDLEWARE ----------------
app.use(cors({
    origin: [
        "https://coreclash.planetzephyros.xyz",
        "https://planetzephyros.xyz",
        "https://staking.planetzephyros.xyz",
        "http://localhost:3000",
        "http://localhost:5173",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-wallet", "x-address"],
    optionsSuccessStatus: 204,
}));

app.use(express.json());

// ---------------- STATIC FILES ----------------
app.use("/images", express.static(METADATA_IMAGES_DIR));
app.use("/public", express.static(path.join(__dirname, "public")));

// ---------------- ROUTES ----------------
app.use("/games", gamesRouter);
app.use("/leaderboard", leaderboardRouter);
app.use("/events", sseRouter);
app.use("/nfts", nftsRouter);
app.use("/xp", xpRouter);
app.use("/admin", testTelegramRoutes);

// ---------------- METADATA ROUTE ----------------
app.get("/metadata/:collection/:tokenId", (req, res) => {
    try {
        const { collection, tokenId } = req.params;
        const mapping = loadMapping();
        const collectionKey = collection.toUpperCase();

        const mapped = mapping[collectionKey]?.[String(tokenId)];
        if (!mapped) return res.status(404).json({ error: "Token not found" });

        const jsonFile = mapped.token_uri || `${tokenId}.json`;
        const filePath = path.join(METADATA_JSON_DIR, collectionKey, jsonFile);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Metadata file missing" });
        }

        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const imageFile = mapped.image_file || `${tokenId}.png`;

        return res.json({ ...data, image_file: imageFile });
    } catch (err) {
        console.error("Metadata route error:", err);
        return res.status(500).json({ error: "Failed to load metadata" });
    }
});

// ---------------- BURN TOTAL ----------------
app.get("/burn-total", (req, res) => {
    try {
        const total = readBurnTotal();
        return res.json({ totalBurnWei: total.toString() });
    } catch (err) {
        console.error("Burn total error:", err);
        return res.status(500).json({ error: "Failed to read burn total" });
    }
});

// ---------------- VALIDATION ----------------
app.post("/games/validate", (req, res) => { /* ... keep your existing validate logic ... */ });

// ---------------- BACKGROUND SERVICES ----------------
async function startBackgroundServices() {
    console.log("[SERVER] Starting background services...");

    try {
        ensureDataPaths();
        initAdminWallet();
        console.log("✅ Data paths & Admin wallet initialized");
    } catch (err) {
        console.error("❌ Initialization failed:", err.message);
    }

    // Core Listeners
    await startCoreBurnListener().catch(err => console.error("Burn listener failed:", err));
    await startSwapListener().catch(err => console.error("Swap listener failed:", err));
    await startNftMintListener().catch(err => console.error("NFT mint listener failed:", err));
    await startNftMarketplaceListener().catch(err => console.error("NFT marketplace listener failed:", err));

    // Schedulers
    startZephyrosAdvertScheduler();
    startInactiveXpReminderScheduler();
    await startDripBot();

    console.log("✅ All background services started successfully");
}

// ---------------- SCHEDULED JOBS (Cron) ----------------
function startScheduledJobs() {
    console.log("[SCHEDULER] Starting cron jobs...");

    let generateMappingRunning = false;
    let checkFrontendMappingRunning = false;

    // Generate mapping every hour at :50
    cron.schedule("50 * * * *", async () => {
        if (generateMappingRunning) return;
        generateMappingRunning = true;
        await generateMapping("ALL").finally(() => generateMappingRunning = false);
    });

    // Check frontend mapping every hour at :00
    cron.schedule("0 * * * *", async () => {
        if (checkFrontendMappingRunning) return;
        checkFrontendMappingRunning = true;
        await checkFrontendMapping().finally(() => checkFrontendMappingRunning = false);
    });

    // Weekly Leaderboard (Daily 18:00 UTC)
    cron.schedule("0 18 * * *", () => sendTelegramWeeklyLeaderboard(), { timezone: "UTC" });

    // Final Weekly Leaderboard (Sunday 23:59 UTC)
    cron.schedule("59 59 23 * * 0", () => sendTelegramFinalWeeklyLeaderboard(), { timezone: "UTC" });

    // All-Time Leaderboard (Friday 10:00 UTC)
    cron.schedule("0 10 * * 5", () => sendTelegramAllTimeLeaderboard(), { timezone: "UTC" });

    // Reveal deadline notifications
    cron.schedule("*/10 * * * *", () => processRevealDeadlineNotifications(), { timezone: "UTC" });
}

// ---------------- START SERVER ----------------
async function bootstrap() {
    try {
        if (!process.env.BACKEND_PRIVATE_KEY) {
            throw new Error("BACKEND_PRIVATE_KEY is missing");
        }

        await startBackgroundServices();

        // One-time startup tasks
        await reconcileActiveGamesScheduled();
        await backfillWeeklyLeaderboardsFromGames(7);

        app.listen(PORT, () => {
            console.log(`🚀 Backend server running on port ${PORT}`);
            startScheduledJobs();
        });
    } catch (err) {
        console.error("❌ Bootstrap failed:", err.message);
        process.exit(1);
    }
}

bootstrap();