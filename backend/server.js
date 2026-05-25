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
import { loadMapping, METADATA_JSON_DIR, METADATA_IMAGES_DIR, ensureDataPaths, FRONTEND_MAPPING_FILE, } from "./paths.js";
import { readBurnTotal } from "./store/burnStore.js";
import gamesRouter from "./routes/games.js";
import sseRouter from "./routes/sse.js";
import nftsRouter from "./routes/nfts.js";
import leaderboardRouter from "./routes/leaderboard.js";
import { backfillWeeklyLeaderboardsFromGames } from "./store/weeklyLeaderboardStore.js";
import { reconcileActiveGamesScheduled } from "./reconcile.js";
import "./eventListener.js";
import xpRouter from "./routes/xp.js";
import testTelegramRoutes from "./routes/testTelegram.js";
import { startCoreBurnListener } from "./burnListener.js";
import { startSwapListener } from "./swapListener.js";
import { sendTelegramWeeklyLeaderboard, sendTelegramFinalWeeklyLeaderboard, sendTelegramAllTimeLeaderboard } from "./utils/telegramBot.js";
import { processRevealDeadlineNotifications } from "./utils/revealDeadlineNotifier.js";
import { startNftMintListener } from "./nftMintListener.js";
import { startNftMarketplaceListener } from "./nftMarketplaceListener.js";
import { startZephyrosAdvertScheduler } from "./utils/telegramBot.js";
import { startInactiveXpReminderScheduler } from "./utils/inactiveXpReminder.js";

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
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));

app.options("*", cors());
app.use(express.json());

// ---------------- STATIC ----------------
app.use("/images", express.static(METADATA_IMAGES_DIR));

app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/mapping.json", (req, res) => {
  res.sendFile(FRONTEND_MAPPING_FILE);
});

// ---------------- ROUTES ----------------
app.use("/games", gamesRouter);
app.use("/leaderboard", leaderboardRouter);
app.use("/events", sseRouter);
app.use("/nfts", nftsRouter);
app.use("/xp", xpRouter);
app.use("/admin", testTelegramRoutes);

// ---------------- METADATA ----------------
app.get("/metadata/:collection/:tokenId", (req, res) => {
  try {
    const { collection, tokenId } = req.params;
    const mapping = loadMapping();
    const collectionKey = collection.toUpperCase();

    const mapped = mapping[collectionKey]?.[String(tokenId)];
    if (!mapped) {
      return res.status(404).json({ error: "Token not found in mapping" });
    }

    const jsonFile = mapped.token_uri || `${tokenId}.json`;

const COLLECTION_IMAGE_FORMATS = {
  EVG: "webp",
  VQLE: "png",
  SCIONS: "png",
  VKIN: "png",
};

const format = COLLECTION_IMAGE_FORMATS[collection] || "png";

const imageFile = mapped.image_file || `${tokenId}.${format}`;

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

// ---------------- VALIDATE ----------------
app.post("/games/validate", (req, res) => {
  try {
    const { nfts } = req.body;

    if (!Array.isArray(nfts)) {
      return res.status(400).json({ error: "Invalid NFTs payload" });
    }

    const mapping = loadMapping();

    const metadata = nfts.map(({ address, tokenId }) => {
      const collection =
        address?.toLowerCase().includes("8cfbb04c") ? "VQLE" : "VKIN";

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

// ---------------- STARTUP ----------------
try {
  if (!process.env.BACKEND_PRIVATE_KEY) {
    throw new Error("Missing BACKEND_PRIVATE_KEY environment variable");
  }

  ensureDataPaths();
  initAdminWallet();
} catch (err) {
  console.error("❌ Failed to initialize backend:", err.message);
  process.exit(1);
}

// ---------------- SCHEDULED JOBS ----------------
try {
  await startNftMintListener();
  console.log("[SERVER] NFT mint listener started");
} catch (err) {
  console.error("Failed to start NFT mint listener:", err);
}

try {
  await startNftMarketplaceListener();
  console.log("[SERVER] NFT marketplace listener started");
} catch (err) {
  console.error("Failed to start NFT marketplace listener:", err);
}

try {
  startZephyrosAdvertScheduler();
  console.log("[SERVER] Zephyros advert scheduler started");
} catch (err) {
  console.error("Failed to start Zephyros advert scheduler:", err);
}

try {
  startInactiveXpReminderScheduler();
  console.log("[SERVER] Inactive XP reminder scheduler started");
} catch (err) {
  console.error("Failed to start inactive XP reminder scheduler:", err);
}

// ---------------- DEBUG ROUTE LOGGING ----------------
setTimeout(() => {
  try {
    const routes = app._router?.stack
      ?.filter((r) => r.route)
      ?.map(
        (r) =>
          `${Object.keys(r.route.methods)[0].toUpperCase()} ${r.route.path}`
      );

    console.log("✅ Mounted direct app routes:", routes || []);
  } catch (err) {
    console.error("Route logging error:", err);
  }
}, 0);

// ---------------- Backfill Leaderboard ---------- //
(async () => {
  try {
    await reconcileActiveGamesScheduled();
    await backfillWeeklyLeaderboardsFromGames(7); // current + previous 6
    console.log("[SERVER] Reconciliation + weekly backfill complete");
  } catch (err) {
    console.error("[SERVER] Startup backfill failed", err);
  }
})();

// ---------------- SCHEDULED JOBS ----------------
// Add these lock flags near your startup section
let generateMappingRunning = false;
let checkFrontendMappingRunning = false;

// Add this function somewhere below your helper functions
function startScheduledJobs() {
  console.log("[SCHEDULER] Starting scheduled NFT jobs...");

  // generateMapping every hour at minute 50
  cron.schedule("50 * * * *", async () => {
    if (generateMappingRunning) {
      console.log("[SCHEDULER] generateMapping skipped: previous run still active");
      return;
    }

    generateMappingRunning = true;
    console.log("[SCHEDULER] generateMapping started");

    try {
      await generateMapping("ALL");
      console.log("[SCHEDULER] generateMapping finished");
    } catch (err) {
      console.error("[SCHEDULER] generateMapping failed:", err);
    } finally {
      generateMappingRunning = false;
    }
  });

  // checkFrontendMapping every hour at minute 00
  cron.schedule("0 * * * *", async () => {
    if (checkFrontendMappingRunning) {
      console.log("[SCHEDULER] checkFrontendMapping skipped: previous run still active");
      return;
    }

    checkFrontendMappingRunning = true;
    console.log("[SCHEDULER] checkFrontendMapping started");

    try {
      await checkFrontendMapping();
      console.log("[SCHEDULER] checkFrontendMapping finished");
    } catch (err) {
      console.error("[SCHEDULER] checkFrontendMapping failed:", err);
    } finally {
      checkFrontendMappingRunning = false;
    }
  });
}
  try {
    startCoreBurnListener();
    console.log("[SERVER] CORE burn listener started");
  } catch (err) {
    console.error("Failed to start CORE burn listener:", err);
  }

  // send weekly leaderboard every day at 18:00 UTC
  cron.schedule(
    "0 18 * * *",
    async () => {
      console.log("[SCHEDULER] daily weekly leaderboard started");

      try {
        await sendTelegramWeeklyLeaderboard();
        console.log("[SCHEDULER] daily weekly leaderboard finished");
      } catch (err) {
        console.error("[SCHEDULER] daily weekly leaderboard failed:", err);
      }
    },
    {
      timezone: "UTC",
    }
  );

  // final weekly leaderboard every Sunday at 23:59:59 UTC
  cron.schedule(
    "59 59 23 * * 0",
    async () => {
      console.log("[SCHEDULER] final weekly leaderboard started");

      try {
        await sendTelegramFinalWeeklyLeaderboard();
        console.log("[SCHEDULER] final weekly leaderboard finished");
      } catch (err) {
        console.error("[SCHEDULER] final weekly leaderboard failed:", err);
      }
    },
    {
      timezone: "UTC",
    }
  );

// all-time leaderboard every Friday at 10:00 UTC
cron.schedule(
  "0 10 * * 5",
  async () => {
    console.log("[SCHEDULER] all-time leaderboard started");

    try {
      await sendTelegramAllTimeLeaderboard();
      console.log("[SCHEDULER] all-time leaderboard finished");
    } catch (err) {
      console.error("[SCHEDULER] all-time leaderboard failed:", err);
    }
  },
  {
    timezone: "UTC",
  }
);  

  // reveal deadline notification scan every 10 minutes
  cron.schedule(
    "*/10 * * * *",
    async () => {
      console.log("[SCHEDULER] reveal deadline notifier started");

      try {
        const result = await processRevealDeadlineNotifications();
        console.log(
          `[SCHEDULER] reveal deadline notifier finished, sent ${result.sent} message(s)`
        );
      } catch (err) {
        console.error("[SCHEDULER] reveal deadline notifier failed:", err);
      }
    },
    {
      timezone: "UTC",
    }
  );

// ---------------- START SWAP LISTENER ----------------
async function bootstrap() {
  try {
    await startSwapListener();
    console.log("Swap listener started");
  } catch (err) {
    console.error("Failed to start swap listener:", err);
  }

  try {
    await startNftMintListener();
    console.log("NFT mint listener started");
  } catch (err) {
    console.error("Failed to start NFT mint listener:", err);
  }

  try {
    await startNftMarketplaceListener();
    console.log("NFT marketplace listener started");
  } catch (err) {
    console.error("Failed to start NFT marketplace listener:", err);
  }
}

bootstrap();

// Replace your existing app.listen block with this:
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
  startScheduledJobs();
  });