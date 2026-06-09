import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" })); // Support large base64 attachments

  const CONFIRM_FILE = path.join(process.cwd(), "confirmations.json");

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
    } catch (e) {
      console.error("Error writing confirmations file", e);
    }
  }

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
