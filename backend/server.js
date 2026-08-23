import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import "dotenv/config";

import { generateMapping } from "./utils/generateMapping.js";
import { checkFrontendMapping } from "../src/checkFrontendMapping.js";
import { initAdminWallet } from "./admin.js";
import { loadMapping, METADATA_JSON_DIR, METADATA_IMAGES_DIR, ensureDataPaths, FRONTEND_MAPPING_FILE } from "./paths.js";
import { readBurnTotal } from "./store/burnStore.js";
import { restoreDataFromR2 } from "./utils/r2Sync.js";

import gamesRouter from "./routes/games.js";
import sseRouter from "./routes/sse.js";
import nftsRouter from "./routes/nfts.js";
import leaderboardRouter from "./routes/leaderboard.js";
import xpRouter from "./routes/xp.js";
import authRouter from "./routes/auth.js";
import testTelegramRoutes from "./routes/testTelegram.js";

// startCoreBurnListener, startSwapListener, startNftMintListener, startNftMarketplaceListener,
// startZephyrosAdvertScheduler, and startDripBot moved to ETNSubdomainService
// (backend/utils/coreClash*.js) — see disable-migrated-telegram-bots branch / PR for why. Left
// unimported here (not deleted) so re-enabling is a one-line revert if ever needed; the modules
// themselves are untouched.
import { startInactiveXpReminderScheduler } from "./utils/inactiveXpReminder.js";

import { reconcileActiveGamesScheduled } from "./reconcile.js";
import { backfillWeeklyLeaderboardsFromGames } from "./store/weeklyLeaderboardStore.js";
import { processRevealDeadlineNotifications } from "./utils/revealDeadlineNotifier.js";
import { sendTelegramWeeklyLeaderboard, sendTelegramFinalWeeklyLeaderboard, sendTelegramAllTimeLeaderboard } from "./utils/telegramBot.js";

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
app.use("/auth", authRouter);
app.use("/games", gamesRouter);
app.use("/leaderboard", leaderboardRouter);
app.use("/events", sseRouter);
app.use("/nfts", nftsRouter);
app.use("/xp", xpRouter);
app.use("/admin", testTelegramRoutes);

// ---------------- METADATA ROUTE ----------------
        const COLLECTION_IMAGE_FORMATS = {
            EVG: "webp",
            VQLE: "png",
            SCIONS: "png",
            VKIN: "png",
        };

app.get("/metadata/:collection/:tokenId", (req, res) => {
    try {
        const { collection, tokenId } = req.params;
        const mapping = loadMapping();
        const collectionKey = collection.toUpperCase();

const normalizeTokenId = (id) =>
  String(id).trim().replace(/^0+/, "");

const mapped = mapping[collectionKey]?.[normalizeTokenId(tokenId)];

        const jsonFile = `${tokenId}.json`;

        const format = COLLECTION_IMAGE_FORMATS[collectionKey] || "png";
const imageFile =
  mapped?.image_file ??
  `${tokenId}.${format}`;

        const filePath = path.join(METADATA_JSON_DIR, collectionKey, jsonFile);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Metadata file missing" });
        }

        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

        return res.json({
            ...data,
            image_file: imageFile,
        });
    } catch (err) {
        console.error("Metadata route error:", err);
        return res.status(500).json({ error: "Failed to load metadata" });
    }
});

// ---------------- VALIDATE ROUTE ----------------
app.post("/games/validate", (req, res) => {
    try {
        const { nfts } = req.body;

        if (!Array.isArray(nfts)) {
            return res.status(400).json({ error: "Invalid NFTs payload" });
        }

        const mapping = loadMapping();

        const metadata = nfts.map(({ address, tokenId }) => {
            const collection = address?.toLowerCase().includes("8cfbb04c") ? "VQLE" : "VKIN";
            const mapped = mapping[collection]?.[String(tokenId)];

            if (!mapped) {
                throw new Error(`Missing mapping for ${collection} token ${tokenId}`);
            }

            const jsonFile = mapped.token_uri || `${tokenId}.json`;
            const filePath = path.join(METADATA_JSON_DIR, collection, jsonFile);

            if (!fs.existsSync(filePath)) {
                throw new Error(`Metadata file missing for ${collection} token ${tokenId}`);
            }

            const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

            const traits = {};
            for (const attr of data.attributes || []) {
                traits[attr.trait_type.toLowerCase()] = attr.value;
            }

            return {
                tokenId,
                traits: [
                    Number(traits.attack),
                    Number(traits.defense),
                    Number(traits.vitality),
                    Number(traits.agility),
                    Number(traits.core),
                ],
                background: traits.background || "Unknown",
                tokenURI: `metadata/${collection}/${tokenId}`,
            };
        });

        return res.json({ metadata });
    } catch (err) {
        console.error("POST /games/validate error:", err);
        return res.status(500).json({ error: err.message || "Validation failed" });
    }
});

// ---------------- BURN TOTAL ----------------
app.get("/burn-total", (req, res) => {
    try {
        const total = readBurnTotal();
        return res.json({ totalBurnWei: total.toString() });
    } catch (err) {
        console.error("Failed to read burn total:", err);
        return res.status(500).json({ error: "Failed to read burn total" });
    }
});

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

    // === Safe Listener Starting ===
    const safeStart = async (name, startFn) => {
        try {
            console.log(`[SERVICE] Starting ${name}...`);
            const result = startFn();
            
            // If it returns a promise, await it
            if (result instanceof Promise) {
                await result;
            }
            
            console.log(`✅ ${name} started`);
        } catch (err) {
            console.error(`❌ ${name} failed:`, err.message || err);
        }
    };

    // CORE Burn Listener, Swap Listener, NFT Mint Listener, NFT Marketplace Listener, Zephyros
    // Advert Scheduler, and CORE Drip Bot moved to ETNSubdomainService — see the (now-unused)
    // imports note above. Commented out rather than deleted so re-enabling here is a one-line
    // revert if ever needed.
    // await safeStart("CORE Burn Listener", startCoreBurnListener);
    // await safeStart("Swap Listener", startSwapListener);
    // await safeStart("NFT Mint Listener", startNftMintListener);
    // await safeStart("NFT Marketplace Listener", startNftMarketplaceListener);
    // safeStart("Zephyros Advert Scheduler", startZephyrosAdvertScheduler);
    // await safeStart("CORE Drip Bot", startDripBot);

    // Schedulers (these are usually synchronous)
    safeStart("Inactive XP Reminder Scheduler", startInactiveXpReminderScheduler);

    console.log("✅ All background services initialized");
}

// ---------------- SCHEDULED JOBS (Cron) ----------------
function startScheduledJobs() {
    console.log("[SCHEDULER] Starting cron jobs...");

    let generateMappingRunning = false;
    let checkFrontendMappingRunning = false;

    cron.schedule("50 * * * *", async () => {
        if (generateMappingRunning) return;
        generateMappingRunning = true;
        try {
            await generateMapping("ALL");
        } finally {
            generateMappingRunning = false;
        }
    });

    cron.schedule("0 * * * *", async () => {
        if (checkFrontendMappingRunning) return;
        checkFrontendMappingRunning = true;
        try {
            await checkFrontendMapping();
        } finally {
            checkFrontendMappingRunning = false;
        }
    });

    cron.schedule("0 18 * * *", () => sendTelegramWeeklyLeaderboard(), { timezone: "UTC" });
    cron.schedule("59 59 23 * * 0", () => sendTelegramFinalWeeklyLeaderboard(), { timezone: "UTC" });
    cron.schedule("0 10 * * 5", () => sendTelegramAllTimeLeaderboard(), { timezone: "UTC" });
    cron.schedule("*/10 * * * *", () => processRevealDeadlineNotifications(), { timezone: "UTC" });
}

// ---------------- BOOTSTRAP ----------------
async function bootstrap() {
    try {
        if (!process.env.BACKEND_PRIVATE_KEY) {
            throw new Error("BACKEND_PRIVATE_KEY is missing");
        }

        // Free-tier instances have no persistent disk, so backend/data starts
        // empty on every restart/redeploy. Pull back anything that was
        // mirrored to R2 by a previous run before anything else touches disk.
        await restoreDataFromR2().catch(err =>
            console.error("R2 restore failed:", err.message)
        );

        await startBackgroundServices();

        // One-time startup tasks
        await reconcileActiveGamesScheduled().catch(err => 
            console.error("Reconcile failed:", err.message)
        );
        
        await backfillWeeklyLeaderboardsFromGames(7).catch(err => 
            console.error("Backfill failed:", err.message)
        );

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