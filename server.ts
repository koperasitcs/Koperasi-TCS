import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" })); // Support large base64 attachments

  const CONFIRM_FILE = path.join(process.cwd(), "confirmations.json");
  const BIN_ID_FILE = path.join(process.cwd(), "jsonbin_id.json");
  const MASTER_KEY = process.env.JSONBIN_MASTER_KEY || "$2a$10$X1exKkrNnD9odupJCg4WTe377IlWpM9JLr4PwRj0lGqOFWEivZOqa";
  let cachedBinId: string | null = null;

  // Load Cached Bin ID if any
  function getCachedBinId(): string | null {
    if (cachedBinId) return cachedBinId;
    try {
      if (fs.existsSync(BIN_ID_FILE)) {
        const data = JSON.parse(fs.readFileSync(BIN_ID_FILE, "utf-8"));
        if (data && data.binId) {
          cachedBinId = data.binId;
          return cachedBinId;
        }
      }
    } catch (e) {
      console.error("Error reading JSONBin ID cache file", e);
    }
    return null;
  }

  // Save Cached Bin ID
  function saveCachedBinId(binId: string) {
    cachedBinId = binId;
    try {
      fs.writeFileSync(BIN_ID_FILE, JSON.stringify({ binId }, null, 2), "utf-8");
    } catch (e) {
      console.error("Error saving JSONBin ID cache file", e);
    }
  }

  // Auto-discover bin or create if not exists
  async function getOrCreateBinId(): Promise<string> {
    const existingId = getCachedBinId();
    if (existingId) return existingId;

    const bName = "ahli_kptntb_confirmations";

    // Step 1: scan uncategorized bins to find one with this name
    try {
      const listRes = await fetch("https://api.jsonbin.io/v3/c/uncategorized/bins", {
        headers: {
          "X-Master-Key": MASTER_KEY
        }
      });
      if (listRes.ok) {
        const listData: any = await listRes.json();
        const bins = Array.isArray(listData) ? listData : (listData.bins || listData.records || []);
        const matchedBin = bins.find((b: any) => {
          const name = b.snippetMeta?.name || b.name || (b.metadata && b.metadata.name);
          return name === bName;
        });
        if (matchedBin) {
          const binId = matchedBin.id || matchedBin.record || matchedBin.binId;
          if (binId) {
            console.log(`JSONBin: Found existing bin with name '${bName}': ${binId}`);
            saveCachedBinId(binId);
            return binId;
          }
        }
      } else {
        console.warn("JSONBin: Failed to list bins", await listRes.text());
      }
    } catch (err) {
      console.warn("JSONBin: Error trying to list bins, falling back...", err);
    }

    // Step 2: Create a new bin since it is not found
    try {
      console.log(`JSONBin: Creating a new bin for '${bName}'...`);
      const createRes = await fetch("https://api.jsonbin.io/v3/b", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Master-Key": MASTER_KEY,
          "X-Bin-Private": "true",
          "X-Bin-Name": bName
        },
        body: JSON.stringify([])
      });

      if (createRes.ok) {
        const createData: any = await createRes.json();
        const binId = createData.metadata?.id;
        if (binId) {
          console.log(`JSONBin: Successfully created new bin: ${binId}`);
          saveCachedBinId(binId);
          return binId;
        }
      }
      throw new Error(`JSONBin: Creation failed with status ${createRes.status}`);
    } catch (err: any) {
      console.error("JSONBin: Failed to create new bin", err);
      throw err;
    }
  }

  // Fetch latest data from JSONBin & sync locally
  async function pullFromCloud(): Promise<any[]> {
    try {
      const binId = await getOrCreateBinId();
      console.log(`JSONBin: Pulling confirmations from bin: ${binId}`);
      const res = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
        headers: {
          "X-Master-Key": MASTER_KEY,
          "X-Bin-Meta": "false" // ONLY retrieve the array list itself cleanly!
        }
      });

      if (res.ok) {
        const cloudData: any = await res.json();
        if (Array.isArray(cloudData)) {
          return cloudData;
        } else if (cloudData && Array.isArray(cloudData.confirmations)) {
          return cloudData.confirmations;
        } else if (cloudData && typeof cloudData === "object" && Array.isArray(cloudData.record)) {
          return cloudData.record;
        }
      } else {
        console.warn(`JSONBin: Pull failed with status ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      console.error("JSONBin: Failed to pull from cloud", err);
    }
    return [];
  }

  // Save data to JSONBin cloud
  async function pushToCloud(data: any[]) {
    try {
      const binId = await getOrCreateBinId();
      console.log(`JSONBin: Pushing ${data.length} confirmations to bin: ${binId}`);
      const res = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Master-Key": MASTER_KEY
        },
        body: JSON.stringify(data)
      });

      if (res.ok) {
        console.log("JSONBin: Cloud database update successful!");
      } else {
        console.warn(`JSONBin: Push failed with status ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      console.error("JSONBin: Failed to push to cloud", err);
    }
  }

  // Helper to read confirmations
  function getConfirmations() {
    try {
      if (fs.existsSync(CONFIRM_FILE)) {
        const data = fs.readFileSync(CONFIRM_FILE, "utf-8");
        return JSON.parse(data);
      }
    } catch (e) {
      console.error("Error reading confirmations file", e);
    }
    return [];
  }

  // Helper to save confirmations
  function saveConfirmations(list: any[]) {
    try {
      fs.writeFileSync(CONFIRM_FILE, JSON.stringify(list, null, 2), "utf-8");
      pushToCloud(list).catch((err) => {
        console.error("JSONBin background push failed:", err);
      });
    } catch (e) {
      console.error("Error writing confirmations file", e);
    }
  }

  // On startup, pull latest cloud confirmations to sync local file state
  pullFromCloud()
    .then((cloudRecords) => {
      if (cloudRecords && cloudRecords.length > 0) {
        console.log(`JSONBin: Received ${cloudRecords.length} records dynamically. Overwriting local cache.`);
        // Write file quietly without triggering another pushToCloud immediately
        try {
          fs.writeFileSync(CONFIRM_FILE, JSON.stringify(cloudRecords, null, 2), "utf-8");
        } catch (e) {
          console.error("Error pre-writing confirmations on startup", e);
        }
      } else {
        console.log("JSONBin: No cloud records found or empty, using existing local files if any.");
      }
    })
    .catch((err) => {
      console.warn("JSONBin: Startup pull failed", err);
    });

  // API Route - Get all confirmations for admin
  app.get("/api/confirmations", (req, res) => {
    try {
      const records = getConfirmations();
      res.json({
        status: "success",
        confirmations: records
      });
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  // API Route - Record new confirmation
  app.post("/api/confirmations", (req, res) => {
    try {
      const { 
        fullName, 
        icNumber, 
        shares, 
        fees, 
        currentYearFees, 
        totalAccumulated, 
        confirmationDate 
      } = req.body;

      if (!fullName || !icNumber) {
        return res.status(400).json({ status: "error", message: "Maklumat tidak lengkap." });
      }

      const records = getConfirmations();
      
      // Prevent duplicates by IC, replace if existing
      const filtered = records.filter((r: any) => r.icNumber.replace(/\D/g, "") !== icNumber.replace(/\D/g, ""));
      
      const newConfirmation = {
        fullName,
        icNumber,
        shares,
        fees,
        currentYearFees,
        totalAccumulated,
        confirmationDate: confirmationDate || new Date().toLocaleString()
      };

      filtered.push(newConfirmation);
      saveConfirmations(filtered);

      res.json({
        status: "success",
        message: "Pengesahan disimpan di pengkalan data."
      });
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  // API Route - Delete/Reset confirmation for admin
  app.delete("/api/confirmations/:ic", (req, res) => {
    try {
      const icNumber = req.params.ic;
      if (!icNumber) {
        return res.status(400).json({ status: "error", message: "No. KP diperlukan." });
      }
      
      const records = getConfirmations();
      const cleanTargetIc = icNumber.replace(/\D/g, "");
      const filtered = records.filter((r: any) => r.icNumber.replace(/\D/g, "") !== cleanTargetIc);
      
      saveConfirmations(filtered);
      
      res.json({
        status: "success",
        message: "Pengesahan telah dibuang dan diset semula."
      });
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });



  // API Route - Get Cooperative Members from local database
  app.get("/api/members", (req, res) => {
    try {
      const membersPath = path.join(process.cwd(), "src", "members.json");
      if (fs.existsSync(membersPath)) {
        const fileContent = fs.readFileSync(membersPath, "utf-8");
        const cleaned = JSON.parse(fileContent);
        console.log(`Successfully loaded ${cleaned.length} records from local members.json.`);
        res.json({
          status: "success",
          count: cleaned.length,
          members: cleaned
        });
      } else {
        throw new Error("Fail members.json tidak dijumpai.");
      }
    } catch (error: any) {
      console.error("Error in /api/members:", error);
      res.status(500).json({
        status: "error",
        message: error.message || "Internal server error fetching members"
      });
    }
  });

  // Serve static assets / Vite dev middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
