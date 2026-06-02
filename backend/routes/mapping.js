import express from "express";
import fs from "fs";
import csvParser from "csv-parser";
import { MAPPING_FILE } from "../paths.js";

const router = express.Router();

function loadMappingSafe(filePath) {
  return new Promise((resolve, reject) => {
    const results = {};

    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on("data", (row) => {
        const collection = (row.collection || "").toUpperCase();
        const tokenId = String(row.token_id).replace(/^0+/, "");

        if (!collection || !tokenId) return;

        if (!results[collection]) results[collection] = {};

        results[collection][tokenId] = {
          token_uri: row.token_uri?.trim() || null,
          image_file: row.image_file?.trim() || null,
        };
      })
      .on("end", () => resolve(results))
      .on("error", reject);
  });
}

router.get("/mapping", async (req, res) => {
  try {
    if (!fs.existsSync(MAPPING_FILE)) {
      return res.status(404).json({ error: "mapping.csv not found" });
    }

    const data = await loadMappingSafe(MAPPING_FILE);

    res.setHeader("Cache-Control", "no-store"); // important
    return res.json(data);
  } catch (err) {
    console.error("GET /mapping error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;