import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" })); // Support large base64 attachments

  const CONFIRM_FILE = path.join(process.cwd(), "confirmations.json");
  const BIN_ID_FILE = path.join(process.cwd(), "jsonbin_id.json");
  const MASTER_KEY = process.env.JSONBIN_MASTER_KEY || "$2a$10$X1exKkrNnD9odupJCg4WTe377IlWpM9JLr4PwRj0lGqOFWEivZOqa";
  let cachedBinId: string | null = null;

  // Cloudflare R2 / S3 Storage client lazy initialization
  let s3Client: S3Client | null = null;
  function getS3Client(): S3Client | null {
    if (s3Client) return s3Client;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const endpoint = process.env.R2_ENDPOINT || "https://f30f579da7e8adde5634a88b4ce28a47.r2.cloudflarestorage.com";
    
    if (!accessKeyId || !secretAccessKey) {
      console.warn("R2: Environment variables R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY are empty. Cloudflare R2 storage syncing is deferred.");
      return null;
    }

    try {
      s3Client = new S3Client({
        region: "auto",
        endpoint,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      console.log("R2: Successfully initialized Cloudflare R2 Client.");
      return s3Client;
    } catch (err: any) {
      console.error("R2: Failed to instantiate S3 client:", err);
      return null;
    }
  }

  // Pull data array from Cloudflare R2 bucket with fallback
  async function pullFromR2(key: string): Promise<any[] | null> {
    const client = getS3Client();
    if (!client) return null;

    const bucket = process.env.R2_BUCKET || "penyatasaham";
    try {
      console.log(`R2: Fetching object '${key}' from bucket '${bucket}'...`);
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      const response = await client.send(command);
      const bodyStr = await response.Body?.transformToString();
      if (bodyStr) {
        const parsed = JSON.parse(bodyStr);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (err: any) {
      if (err.name === "NoSuchKey" || err.Code === "NoSuchKey") {
        console.log(`R2: Object Key '${key}' is not found yet in bucket '${bucket}'.`);
        return [];
      }
      console.warn(`R2: Fetch key '${key}' failed on bucket '${bucket}':`, err.message || err);
    }
    return null;
  }

  // Push data array to Cloudflare R2 bucket with fallback
  async function pushToR2(key: string, data: any[]): Promise<boolean> {
    const client = getS3Client();
    if (!client) return false;

    const bucket = process.env.R2_BUCKET || "penyatasaham";
    try {
      console.log(`R2: Putting object '${key}' with ${data.length} records into bucket '${bucket}'...`);
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(data, null, 2),
        ContentType: "application/json",
      });
      await client.send(command);
      console.log(`R2: Successfully uploaded key '${key}' to bucket '${bucket}'.`);
      return true;
    } catch (err: any) {
      console.error(`R2: Push key '${key}' failed on bucket '${bucket}':`, err.message || err);
      return false;
    }
  }

  // Dual Cloud Synchronizer on startup
  async function syncWithR2OnStartup() {
    console.log("R2: Starting Cloudflare R2 dynamic database synchronization check (Dual Cloud Sync)...");
    
    // 1. Sync confirmations.json database
    try {
      const r2Conf = await pullFromR2("confirmations.json");
      if (r2Conf && r2Conf.length > 0) {
        console.log(`R2: Received ${r2Conf.length} confirmations from R2 cloud. Synchronizing...`);
        const localConf = getConfirmations();
        
        // Merge records (deduplicate by IC number)
        const mergedMap = new Map();
        localConf.forEach((c: any) => {
          if (c && c.icNumber) {
            const cleanIc = c.icNumber.replace(/\D/g, "");
            if (cleanIc) mergedMap.set(cleanIc, c);
          }
        });
        r2Conf.forEach((c: any) => {
          if (c && c.icNumber) {
            const cleanIc = c.icNumber.replace(/\D/g, "");
            if (cleanIc) mergedMap.set(cleanIc, c);
          }
        });

        const mergedList = Array.from(mergedMap.values());
        fs.writeFileSync(CONFIRM_FILE, JSON.stringify(mergedList, null, 2), "utf-8");
        console.log(`R2: Merged local and Cloudflare confirmations database to ${mergedList.length} items.`);
        
        // Ensure both cloud storage platforms are fully aligned
        await pushToR2("confirmations.json", mergedList);
        await pushToCloud(mergedList);
      } else {
        // If R2 is empty, upload our current local integrations (including JSONBin pull matches)
        const localConf = getConfirmations();
        if (localConf.length > 0) {
          console.log(`R2: Populating Cloudflare R2 bucket with ${localConf.length} confirmations...`);
          await pushToR2("confirmations.json", localConf);
        }
      }
    } catch (err) {
      console.warn("R2: Startup confirmations cloud synchronisation suspended (awaiting keys or connection):", err);
    }

    // 2. Sync members.json database
    try {
      const membersPath = path.join(process.cwd(), "src", "members.json");
      const r2Members = await pullFromR2("members.json");
      if (r2Members && r2Members.length > 0) {
        console.log(`R2: Received ${r2Members.length} co-op member records from R2 cloud. Syncing local members roster.`);
        fs.writeFileSync(membersPath, JSON.stringify(r2Members, null, 2), "utf-8");
      } else {
        // If R2 has no members.json, push our robust 1450+ pre-filled local co-op roster to seed it!
        if (fs.existsSync(membersPath)) {
          const localMembers = JSON.parse(fs.readFileSync(membersPath, "utf-8"));
          if (localMembers && localMembers.length > 0) {
            console.log(`R2: Creating & copying entire members roster (${localMembers.length} items) to Cloudflare R2...`);
            await pushToR2("members.json", localMembers);
          }
        }
      }
    } catch (err) {
      console.warn("R2: Startup members roster cloud synchronisation suspended:", err);
    }
  }

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
      
      // JSONBin background sync
      pushToCloud(list).catch((err) => {
        console.error("JSONBin background push failed:", err);
      });

      // Cloudflare R2 background sync
      pushToR2("confirmations.json", list).catch((err) => {
        console.error("Cloudflare R2 background push failed:", err);
      });
    } catch (e) {
      console.error("Error writing confirmations file", e);
    }
  }

  // On startup, pull latest cloud confirmations to sync local file state
  pullFromCloud()
    .then(async (cloudRecords) => {
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

      // Now run double-sync with Cloudflare R2 which merges R2 and local/JSONBin data sets in real-time
      await syncWithR2OnStartup();
    })
    .catch(async (err) => {
      console.warn("JSONBin: Startup pull failed, proceeding to R2 sync...", err);
      await syncWithR2OnStartup();
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

  // API Route - Manual Trigger Cloudflare R2 Cloud Synchronisation & Verification
  app.post("/api/admin/sync-r2", async (req, res) => {
    try {
      const client = getS3Client();
      if (!client) {
        return res.status(400).json({
          status: "error",
          message: "Akses Tergendala. Sila masukkan R2_ACCESS_KEY_ID dan R2_SECRET_ACCESS_KEY di portal konfigurasi Settings."
        });
      }

      console.log("R2 Admin: Manual cloud sync triggered...");
      
      const results: any = {
        r2Connected: true,
        confirmationsSynced: 0,
        membersSynced: 0,
        pullDetails: "",
        pushDetails: ""
      };

      // 1. Synchronize confirmations.json
      const r2Conf = await pullFromR2("confirmations.json");
      const localConf = getConfirmations();
      
      const mergedMap = new Map();
      localConf.forEach((c: any) => {
        if (c && c.icNumber) {
          const cleanIc = c.icNumber.replace(/\D/g, "");
          if (cleanIc) mergedMap.set(cleanIc, c);
        }
      });
      if (r2Conf && r2Conf.length > 0) {
        r2Conf.forEach((c: any) => {
          if (c && c.icNumber) {
            const cleanIc = c.icNumber.replace(/\D/g, "");
            if (cleanIc) mergedMap.set(cleanIc, c);
          }
        });
        results.pullDetails = `Berjaya memuat turun ${r2Conf.length} pengesahan daripada cloud. `;
      } else {
        results.pullDetails = `Tiada rekod sedia ada di cloud R2 atau cubaan muat turun kosong. `;
      }

      const mergedList = Array.from(mergedMap.values());
      fs.writeFileSync(CONFIRM_FILE, JSON.stringify(mergedList, null, 2), "utf-8");
      results.confirmationsSynced = mergedList.length;

      // Push back up to R2 & JSONBin
      const pushSuccess = await pushToR2("confirmations.json", mergedList);
      if (pushSuccess) {
        results.pushDetails += `Berjaya memuat naik ${mergedList.length} pengesahan ke Cloudflare R2. `;
      }
      await pushToCloud(mergedList);

      // 2. Synchronize members.json
      const membersPath = path.join(process.cwd(), "src", "members.json");
      const r2Members = await pullFromR2("members.json");
      
      if (r2Members && r2Members.length > 0) {
        fs.writeFileSync(membersPath, JSON.stringify(r2Members, null, 2), "utf-8");
        results.membersSynced = r2Members.length;
        results.pullDetails += `Berjaya memuat turun senarai ${r2Members.length} ahli daripada cloud.`;
      } else {
        // Seed
        if (fs.existsSync(membersPath)) {
          const localMembers = JSON.parse(fs.readFileSync(membersPath, "utf-8"));
          if (localMembers && localMembers.length > 0) {
            const seedSuccess = await pushToR2("members.json", localMembers);
            if (seedSuccess) {
              results.membersSynced = localMembers.length;
              results.pushDetails += `Berjaya memuat naik senarai ${localMembers.length} ahli ke cloud R2 sebagai fail permulaan (seeding).`;
            }
          }
        }
      }

      res.json({
        status: "success",
        message: "Sinkronisasi Cloudflare R2 selesai dengan jaya!",
        details: results
      });
    } catch (error: any) {
      console.error("Error in /api/admin/sync-r2:", error);
      res.status(500).json({
        status: "error",
        message: error.message || "Gagal melakukan koordinasi cloud R2."
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
