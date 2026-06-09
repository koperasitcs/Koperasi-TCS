import { useState, useEffect, ChangeEvent, FormEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  User, 
  LogOut, 
  Printer, 
  CheckCircle2, 
  FileText, 
  Calendar, 
  CreditCard,
  Building,
  Info,
  ChevronDown,
  Check,
  Award,
  Trash2,
  Lock,
  Search,
  AlertTriangle,
  ShieldCheck,
  Download
} from "lucide-react";
import { jsPDF } from "jspdf";
import { helperMemberPDFData, HelperMemberPDFData } from "./pdfData";
import { WebMember } from "./types";

// Firebase Integration
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  doc as firestoreDoc, 
  setDoc, 
  getDocs, 
  deleteDoc, 
  getDoc 
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize client-side Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const CONFIRMATIONS_COLLECTION = "confirmations";

enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {},
    operationType,
    path
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [icInput, setIcInput] = useState("");
  const [dbMembers, setDbMembers] = useState<WebMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Login auth states
  const [loggedInMember, setLoggedInMember] = useState<WebMember | null>(null);
  const [matchedFinancials, setMatchedFinancials] = useState<HelperMemberPDFData | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  
  // Reveal parameters
  const [showFinancials, setShowFinancials] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [confirmationDate, setConfirmationDate] = useState<string | null>(null);

  // Email and PDF auto-delivery states
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSuccessMessage, setEmailSuccessMessage] = useState<string | null>(null);
  const [emailErrorMessage, setEmailErrorMessage] = useState<string | null>(null);

  // Database state for confirmations check
  const [confirmedList, setConfirmedList] = useState<any[]>([]);

  // Member interactive confirmation states
  const [hasTickedAkuJanji, setHasTickedAkuJanji] = useState(false);

  // Admin section states
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminUser, setAdminUser] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminSuccessMsg, setAdminSuccessMsg] = useState<string | null>(null);
  const [deleteConfirmIc, setDeleteConfirmIc] = useState<string | null>(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminTab, setAdminTab] = useState<"semua" | "sudah" | "belum">("semua");

  // Fetch cooperative members and backend confirmations on mount
  useEffect(() => {
    async function loadInitialData() {
      try {
        setIsLoading(true);
        console.log("Loading members from /api/members...");
        const response = await fetch("/api/members");
        if (response.ok) {
          const data = await response.json();
          if (data.status === "success") {
            const mapped: WebMember[] = data.members.map((m: any) => ({
              memberNo: m["No. Ahli"] || "",
              fullName: m["Nama Penuh"] || "",
              icNumber: m["No. Kad Pengenalan"] || ""
            }));
            setDbMembers(mapped);
            console.log(`Loaded ${mapped.length} members successfully.`);
          } else {
            throw new Error(data.message || "Gagal memproses data.");
          }
        } else {
          throw new Error(`Server returned status ${response.status}`);
        }
      } catch (err: any) {
        console.warn("API Fetch error, using static pdfData as fallback members dataset:", err);
        const mappedStatic: WebMember[] = helperMemberPDFData.map(f => ({
          memberNo: "KOP-A" + f.ic.substring(6, 10),
          fullName: f.name,
          icNumber: f.ic
        }));
        setDbMembers(mappedStatic);
      } finally {
        setIsLoading(false);
      }

      // Load confirmation lists
      await refreshConfirmations();
    }
    loadInitialData();
  }, []);

  // Helper method to load current server-side confirmations database
  const refreshConfirmations = async () => {
    let localConf: any[] = [];
    try {
      const saved = localStorage.getItem("koperasi_confirmations_2026");
      if (saved) {
        localConf = JSON.parse(saved);
      }
    } catch (e) {
      console.error("Error reading localStorage confirmations:", e);
    }

    const mergedMap = new Map<string, any>();

    // Step 1: Pre-fill with localStorage records
    localConf.forEach((c) => {
      if (c && c.icNumber) {
        const cleanIc = c.icNumber.replace(/\D/g, "");
        if (cleanIc) {
          mergedMap.set(cleanIc, c);
        }
      }
    });

    // Step 2: Merge with Express backend database if accessible
    try {
      const response = await fetch("/api/confirmations");
      if (response.ok) {
        const data = await response.json();
        if (data && data.status === "success" && Array.isArray(data.confirmations)) {
          data.confirmations.forEach((item: any) => {
            if (item && item.icNumber) {
              const cleanIc = item.icNumber.replace(/\D/g, "");
              if (cleanIc) {
                mergedMap.set(cleanIc, item);
              }
            }
          });
        }
      }
    } catch (e) {
      console.warn("Could not load confirmations from Express backend. Using backup flow:", e);
    }

    // Step 3: Core Cloud Sync - Retrieve from Firebase Firestore and overwrite with latest cloud state
    try {
      const querySnapshot = await getDocs(collection(db, CONFIRMATIONS_COLLECTION));
      querySnapshot.forEach((document) => {
        const item = document.data();
        const icNum = document.id; // doc id is clean icNumber
        if (item && icNum) {
          const cleanIc = icNum.replace(/\D/g, "");
          if (cleanIc) {
            mergedMap.set(cleanIc, {
              fullName: item.fullName || "",
              icNumber: item.icNumber || icNum,
              shares: item.shares || 0,
              fees: item.fees || 0,
              currentYearFees: item.currentYearFees || 0,
              totalAccumulated: item.totalAccumulated || 0,
              confirmationDate: item.confirmationDate || ""
            });
          }
        }
      });
      console.log("Durable Cloud (Firebase) confirmations synchronized successfully.");
    } catch (fbErr: any) {
      console.warn("Could not sync from Firebase (using handleFirestoreError callback):", fbErr);
    }

    setConfirmedList(Array.from(mergedMap.values()));
  };

  // Format IC number as user types: XXXXXX-XX-XXXX
  const handleICChange = (e: ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    // Keep only numbers up to 12 digits
    const cleaned = rawVal.replace(/\D/g, "").substring(0, 12);
    
    let formatted = cleaned;
    if (cleaned.length > 6) {
      formatted = cleaned.slice(0, 6) + "-" + cleaned.slice(6, 8) + (cleaned.length > 8 ? "-" + cleaned.slice(8) : "");
    }
    setIcInput(formatted);
    setLoginError(null);
  };

  // Perform secure login matching
  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    const cleanInput = icInput.replace(/\D/g, "");
    
    if (cleanInput.length !== 12) {
      setLoginError("Sila masukkan nombor kad pengenalan yang lengkap (12 digit).");
      return;
    }

    // Try finding in local members list first, fallback to compiled PDF list
    let matchedMember = dbMembers.find(m => m.icNumber.replace(/\D/g, "") === cleanInput);
    
    // Find financials in the compiled PDF dataset
    const financials = helperMemberPDFData.find(f => f.ic.replace(/\D/g, "") === cleanInput);

    if (!matchedMember && financials) {
      // If found in PDF database but not in local database, construct proxy member
      matchedMember = {
        memberNo: "KOP-A" + financials.ic.substring(6, 10),
        fullName: financials.name,
        icNumber: financials.ic
      };
    }

    if (matchedMember) {
      setLoggedInMember(matchedMember);
      setMatchedFinancials(financials || null);
      setLoginError(null);
      setShowFinancials(true);
      
      const checkIC = matchedMember.icNumber.replace(/\D/g, "");

      // Direct check against Cloud Firestore for real-time consistency
      const checkRealtimeConfirmation = async () => {
        try {
          const docRef = firestoreDoc(db, CONFIRMATIONS_COLLECTION, checkIC);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            setIsConfirmed(true);
            setConfirmationDate(data.confirmationDate);
            setHasTickedAkuJanji(true);
            return;
          }
        } catch (e) {
          console.warn("Direct Cloud Firestore check failed (falling back to memory list):", e);
        }

        // Fallback to pre-loaded memory list 
        const matchedConfirmation = confirmedList.find((c: any) => c.icNumber.replace(/\D/g, "") === checkIC);
        if (matchedConfirmation) {
          setIsConfirmed(true);
          setConfirmationDate(matchedConfirmation.confirmationDate);
          setHasTickedAkuJanji(true);
        } else {
          setIsConfirmed(false);
          setConfirmationDate(null);
          setHasTickedAkuJanji(false);
        }
      };

      checkRealtimeConfirmation();
    } else {
      setLoginError(
        "Nombor kad pengenalan tidak dijumpai dalam pangkalan data Ahli Koperasi Pegawai-Pegawai Tadbir Negeri Terengganu Berhad. Sila pastikan IC betul atau hubungi urusetia."
      );
    }
  };

  const handleLogout = () => {
    setLoggedInMember(null);
    setMatchedFinancials(null);
    setIcInput("");
    setShowFinancials(false);
    setIsConfirmed(false);
    setConfirmationDate(null);
    setHasTickedAkuJanji(false);
    setEmailSuccessMessage(null);
    setEmailErrorMessage(null);
  };

  const handlePrint = async () => {
    if (!loggedInMember || !matchedFinancials) return;
    
    setIsSendingEmail(true);
    setEmailSuccessMessage(null);
    setEmailErrorMessage(null);

    // Save timestamp on the fly representing Malaysia timezone Standard Time
    const now = new Date();
    const formattedDate = now.toLocaleDateString("ms-MY", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }) + " (Standard Malaysia)";

    try {
      // 1. Initialize jsPDF in A4 format (210 x 297 mm)
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      // Page bounding border (outer frame)
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.4);
      doc.rect(8, 8, 194, 281);

      // Fetch / Embedded Image for reliable PDF rendering
      let logoData: string | HTMLImageElement | null = null;
      try {
        const logoResponse = await fetch("https://i.postimg.cc/kDP75HR2/LOGO-SEDANG.png");
        if (logoResponse.ok) {
          const blob = await logoResponse.blob();
          logoData = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
      } catch (err) {
        console.warn("Soft fallback: direct fetch of logo failed, using DOM reference", err);
      }

      if (!logoData) {
        logoData = document.getElementById("koperasi-logo") as HTMLImageElement;
      }

      if (logoData) {
        try {
          if (typeof logoData === "string") {
            const format = logoData.includes("image/jpeg") || logoData.includes("image/jpg") ? "JPEG" : "PNG";
            doc.addImage(logoData, format, 92.5, 14, 25, 32);
          } else {
            doc.addImage(logoData, "PNG", 92.5, 14, 25, 32);
          }
        } catch (err) {
          console.error("Failed to add logo image to PDF:", err);
        }
      }

      // Title header Centered (match temp pks.pdf title exactly)
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(13);
      doc.text("PENYATA KEDUDUKAN SAHAM DAN LAIN-LAIN", 105, 54, { align: "center" });
      doc.text("BAYARAN SEHINGGA 31 MAC 2026", 105, 62, { align: "center" });

      // Member Name Left aligned like NAMA placeholder in mockup
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`${loggedInMember.fullName.toUpperCase()}`, 15, 78);

      // Generate pristine table matching temp pks.pdf structural specifications
      // Start Y height for table: Y = 84mm
      // Width: 180mm (starts at X=15, ends at X=195)
      // Headers: PERKARA (width 70mm), MODAL SAHAM (width 55mm), MODAL YURAN (width 55mm)
      // Row 1 Y height: 84 to 96 (Header, 12mm)
      // Row 2 Y height: 96 to 114 (Row 1, 18mm)
      // Row 3 Y height: 114 to 132 (Row 2, 18mm)
      // Row 4 Y height: 132 to 146 (Row 3, 14mm)
      // Total table height = 62mm (84 to 146)
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      doc.rect(15, 84, 180, 62);

      // Table line dividers
      // Horizontal dividers
      doc.line(15, 96, 195, 96);   // header divider
      doc.line(15, 114, 195, 114); // row 1 divider
      doc.line(15, 132, 195, 132); // row 2 divider

      // Vertical dividers
      doc.line(85, 84, 85, 132);   // divider 1 (PERKARA | MODAL SAHAM) for Header & Row 1 & 2 only
      doc.line(140, 84, 140, 146); // divider 2 (MODAL SAHAM | MODAL YURAN) for all rows

      // Headers Texts (Centered)
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(10);
      doc.text("PERKARA", 50, 91.5, { align: "center" });
      doc.text("MODAL SAHAM", 112.5, 91.5, { align: "center" });
      doc.text("MODAL YURAN", 167.5, 91.5, { align: "center" });

      // Row 1 Texts
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(9.5);
      const row1TextSplit = doc.splitTextToSize("Bayaran terkumpul modal saham sehingga 31 Mac 2026", 64);
      doc.text(row1TextSplit, 18, 103);
      
      doc.setFont("Helvetica", "bold");
      doc.text(formatCurrency(matchedFinancials.saham), 112.5, 105, { align: "center" });
      doc.text(formatCurrency(matchedFinancials.yuran), 167.5, 105, { align: "center" });

      // Row 2 Texts
      doc.setFont("Helvetica", "normal");
      doc.text("Bayaran diterima dalam tahun kewangan", 18, 121);
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text("(April 2025 - Mac 2026)", 18, 127);
      
      // Middle cell of row 2 is empty
      // Right cell of row 2
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text(formatCurrency(matchedFinancials.terima), 167.5, 123, { align: "center" });

      // Row 3 Text (Total accumulated)
      doc.setFont("Helvetica", "bold");
      doc.text("JUMLAH TERKUMPUL SEHINGGA 31 MAC 2026:", 18, 140);
      doc.text(formatCurrency(matchedFinancials.jumlah), 167.5, 140, { align: "center" });

      // If already confirmed or this is the first submission
      const activeConfirmDate = isConfirmed ? confirmationDate : formattedDate;

      // Draw official Digital Confirmation block if either already confirmed or confirming right now
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text("PENGESAHAN AKUAN AKU JANJI DIGITAL (SAH DIGITAL)", 15, 174);

      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      // Increased box height to 31 to cleanly display Nama, IC, SAYA SAHKAN statement & confirmation date
      doc.rect(15, 178, 180, 31);

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`Nama Pemohon: ${loggedInMember.fullName.toUpperCase()}`, 20, 185);
      doc.text(`No. Kad Pengenalan: ${loggedInMember.icNumber}`, 20, 191);
      doc.text("SAYA SAHKAN PENYATA DI ATAS ADALAH BENAR", 20, 197);
      doc.setFont("Helvetica", "normal");
      doc.text(`Tarikh & Masa Disahkan: ${activeConfirmDate}`, 20, 203);

      // Footnote text placed at the very bottom
      doc.setFont("Helvetica", "oblique");
      doc.setFontSize(8.5);
      doc.text("“Pengesahan penyata ini adalah cetakan komputer dan tandatangan tidak diperlukan”", 105, 275, { align: "center" });

      // 2. Extract base64 PDF
      const pdfBase64 = doc.output("datauristring");

      // Save PDF instantly on member's host machine
      doc.save(`Penyata_Saham_2026_${loggedInMember.icNumber}.pdf`);

      // If already confirmed previously, do not make any backend updates
      if (isConfirmed) {
        setIsSendingEmail(false);
        return;
      }

      // 3. Save confirmation with multi-cloud redundancy (Firebase, Express API, local storage fallback)
      const confirmationPayload = {
        fullName: loggedInMember.fullName,
        icNumber: loggedInMember.icNumber,
        shares: matchedFinancials.saham,
        fees: matchedFinancials.yuran,
        currentYearFees: matchedFinancials.terima,
        totalAccumulated: matchedFinancials.jumlah,
        confirmationDate: formattedDate
      };

      let cloudSaveSucceeded = false;

      // Try Firebase Firestore Cloud Save (Works everywhere - Cloudflare, GitHub Pages, etc.)
      try {
        const cleanIcForDb = loggedInMember.icNumber.replace(/\D/g, "");
        const docRef = firestoreDoc(db, CONFIRMATIONS_COLLECTION, cleanIcForDb);
        await setDoc(docRef, {
          fullName: loggedInMember.fullName,
          icNumber: loggedInMember.icNumber,
          shares: matchedFinancials.saham,
          fees: matchedFinancials.yuran,
          currentYearFees: matchedFinancials.terima,
          totalAccumulated: matchedFinancials.jumlah,
          confirmationDate: formattedDate
        });
        cloudSaveSucceeded = true;
        console.log("Firebase Firestore Cloud save succeeded!");
      } catch (fbErr: any) {
        console.warn("Firebase Firestore Cloud save bypassed or failed:", fbErr);
        try {
          handleFirestoreError(fbErr, OperationType.WRITE, `${CONFIRMATIONS_COLLECTION}/${loggedInMember.icNumber}`);
        } catch (_) {}
      }

      // Try Express backend save (Works when custom server is running)
      try {
        const response = await fetch("/api/confirmations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(confirmationPayload)
        });

        if (response.ok) {
          const resData = await response.json();
          if (resData && resData.status === "success") {
            cloudSaveSucceeded = true;
            console.log("Express API backend save succeeded!");
          }
        }
      } catch (apiErr: any) {
        console.warn("Express API backend save bypassed or not supported in this host:", apiErr);
      }

      // Safe LocalStorage fallback (Makes sure progress remains local on current device no matter what)
      try {
        const savedLocally = localStorage.getItem("koperasi_confirmations_2026");
        const list = savedLocally ? JSON.parse(savedLocally) : [];
        const cleanIcNum = loggedInMember.icNumber.replace(/\D/g, "");
        const exists = list.some((c: any) => c.icNumber.replace(/\D/g, "") === cleanIcNum);
        if (!exists) {
          list.push(confirmationPayload);
          localStorage.setItem("koperasi_confirmations_2026", JSON.stringify(list));
        }
      } catch (localErr: any) {
        console.error("LocalStorage write failed:", localErr);
      }

      if (cloudSaveSucceeded) {
        setEmailSuccessMessage("Penyata PDF telah berjaya dimuat turun dan disahkan secara selamat dalam pangkalan data awan!");
      } else {
        setEmailSuccessMessage("Penyata PDF telah berjaya dimuat turun dan disahkan secara selamat pada peranti anda!");
      }

      setConfirmationDate(formattedDate);
      setIsConfirmed(true);
      await refreshConfirmations();

    } catch (err: any) {
      console.error("PDF generation or saving failed:", err);
      setEmailErrorMessage(err.message || "Gagal memproses dan memuat turun penyata PDF.");
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Format currency in RM
  const formatCurrency = (val: number | undefined) => {
    if (val === undefined) return "RM 0.00";
    return new Intl.NumberFormat("ms-MY", {
      style: "currency",
      currency: "MYR",
      minimumFractionDigits: 2
    }).format(val);
  };

  // Administrative event handlers
  const handleAdminLogin = (e: FormEvent) => {
    e.preventDefault();
    if (adminUser.trim() === "koperasitcs@gmail.com" && adminPass === "kooptcs211") {
      setIsAdminLoggedIn(true);
      setAdminError(null);
      // Clear fields for privacy
      setAdminUser("");
      setAdminPass("");
    } else {
      setAdminError("E-mel atau Kata Laluan Pentadbir tidak sah.");
    }
  };

  const handleAdminLogout = () => {
    setIsAdminLoggedIn(false);
    setAdminError(null);
    setAdminSearch("");
  };

  const handleAdminPrint = async (record: any) => {
    try {
      // Reconstruct financials or lookup in database
      const matched = helperMemberPDFData.find(f => f.ic.replace(/\D/g, "") === record.icNumber.replace(/\D/g, ""));
      const financials: HelperMemberPDFData = matched || {
        digits6: record.icNumber.replace(/\D/g, "").substring(0, 6) || "",
        name: record.fullName,
        ic: record.icNumber,
        saham: Number(record.shares || record.saham || 0),
        yuran: Number(record.fees || record.yuran || 0),
        terima: Number(record.currentYearFees || record.terima || 0),
        jumlah: Number(record.totalAccumulated || record.jumlah || 0)
      };

      const tempMember: WebMember = {
        memberNo: record.memberNo || "KOP-A" + record.icNumber.replace(/\D/g, "").substring(6, 10),
        fullName: record.fullName,
        icNumber: record.icNumber
      };

      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      // Page bounding border (outer frame)
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.4);
      doc.rect(8, 8, 194, 281);

      // Fetch / Embedded Image for reliable PDF rendering
      let logoData: string | HTMLImageElement | null = null;
      try {
        const logoResponse = await fetch("https://i.postimg.cc/kDP75HR2/LOGO-SEDANG.png");
        if (logoResponse.ok) {
          const blob = await logoResponse.blob();
          logoData = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
      } catch (err) {
        console.warn("Soft fallback: direct fetch of logo failed, using DOM reference", err);
      }

      if (!logoData) {
        logoData = document.getElementById("koperasi-logo") as HTMLImageElement;
      }

      if (logoData) {
        try {
          if (typeof logoData === "string") {
            const format = logoData.includes("image/jpeg") || logoData.includes("image/jpg") ? "JPEG" : "PNG";
            doc.addImage(logoData, format, 92.5, 14, 25, 32);
          } else {
            doc.addImage(logoData, "PNG", 92.5, 14, 25, 32);
          }
        } catch (err) {
          console.error("Failed to add logo image to PDF:", err);
        }
      }

      // Title header Centered
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(13);
      doc.text("PENYATA KEDUDUKAN SAHAM DAN LAIN-LAIN", 105, 54, { align: "center" });
      doc.text("BAYARAN SEHINGGA 31 MAC 2026", 105, 62, { align: "center" });

      // Member Name Left aligned
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`${tempMember.fullName.toUpperCase()}`, 15, 78);

      // Generate pristine table matching temp pks.pdf structural specifications
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      doc.rect(15, 84, 180, 62);

      // Table line dividers
      doc.line(15, 96, 195, 96);   // header divider
      doc.line(15, 114, 195, 114); // row 1 divider
      doc.line(15, 132, 195, 132); // row 2 divider

      // Vertical dividers
      doc.line(85, 84, 85, 132);   // divider 1
      doc.line(140, 84, 140, 146); // divider 2

      // Headers Texts
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(10);
      doc.text("PERKARA", 50, 91.5, { align: "center" });
      doc.text("MODAL SAHAM", 112.5, 91.5, { align: "center" });
      doc.text("MODAL YURAN", 167.5, 91.5, { align: "center" });

      // Row 1 Texts
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(9.5);
      const row1TextSplit = doc.splitTextToSize("Bayaran terkumpul modal saham sehingga 31 Mac 2026", 64);
      doc.text(row1TextSplit, 18, 103);
      
      doc.setFont("Helvetica", "bold");
      doc.text(formatCurrency(financials.saham), 112.5, 105, { align: "center" });
      doc.text(formatCurrency(financials.yuran), 167.5, 105, { align: "center" });

      // Row 2 Texts
      doc.setFont("Helvetica", "normal");
      doc.text("Bayaran diterima dalam tahun kewangan", 18, 121);
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text("(April 2025 - Mac 2026)", 18, 127);
      
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text(formatCurrency(financials.terima), 167.5, 123, { align: "center" });

      // Row 3 Text
      doc.setFont("Helvetica", "bold");
      doc.text("JUMLAH TERKUMPUL SEHINGGA 31 MAC 2026:", 18, 140);
      doc.text(formatCurrency(financials.jumlah), 167.5, 140, { align: "center" });

      const activeConfirmDate = record.isConfirmed && record.confirmationDate ? record.confirmationDate : "Belum Disahkan";

      // Draw official Digital Confirmation block
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text("PENGESAHAN AKUAN AKU JANJI DIGITAL (SAH DIGITAL)", 15, 174);

      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      // Increased box height to 31 to cleanly display Nama, IC, SAYA SAHKAN statement & confirmation date
      doc.rect(15, 178, 180, 31);

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`Nama Pemohon: ${tempMember.fullName.toUpperCase()}`, 20, 185);
      doc.text(`No. Kad Pengenalan: ${tempMember.icNumber}`, 20, 191);
      doc.text("SAYA SAHKAN PENYATA DI ATAS ADALAH BENAR", 20, 197);
      doc.setFont("Helvetica", "normal");
      doc.text(`Tarikh & Masa Disahkan: ${activeConfirmDate}`, 20, 203);

      // Footnote text placed at the very bottom
      doc.setFont("Helvetica", "oblique");
      doc.setFontSize(8.5);
      doc.text("“Pengesahan penyata ini adalah cetakan komputer dan tandatangan tidak diperlukan”", 105, 275, { align: "center" });

      // Download
      doc.save(`Penyata_Saham_2026_${tempMember.icNumber}.pdf`);
    } catch (err: any) {
      console.error("Gagal menjana PDF", err);
    }
  };

  const handleDeleteConfirmation = async (ic: string) => {
    const cleanIcNum = ic.replace(/\D/g, "");

    // 1. Delete from Cloud Firestore (Primary serverless database)
    try {
      const docRef = firestoreDoc(db, CONFIRMATIONS_COLLECTION, cleanIcNum);
      await deleteDoc(docRef);
      console.log("Successfully deleted confirmation from Cloud Firestore.");
    } catch (fbErr: any) {
      console.warn("Firebase Cloud Firestore delete failed:", fbErr);
      try {
        handleFirestoreError(fbErr, OperationType.DELETE, `${CONFIRMATIONS_COLLECTION}/${cleanIcNum}`);
      } catch (_) {}
    }

    // 2. Delete from browser's localStorage
    try {
      const savedLocally = localStorage.getItem("koperasi_confirmations_2026");
      if (savedLocally) {
        const list = JSON.parse(savedLocally);
        const filtered = list.filter((c: any) => c.icNumber.replace(/\D/g, "") !== cleanIcNum);
        localStorage.setItem("koperasi_confirmations_2026", JSON.stringify(filtered));
      }
    } catch (e) {
      console.error("Ralat membuang dari penyimpanan tempatan pelayar:", e);
    }

    // 3. Try to delete from the Express backend API
    try {
      const response = await fetch(`/api/confirmations/${cleanIcNum}`, {
        method: "DELETE"
      });
      if (response.ok) {
        const data = await response.json();
        if (data.status === "success") {
          setAdminSuccessMsg("Pengesahan ahli berjaya diset semula.");
          setDeleteConfirmIc(null);
          await refreshConfirmations();
          setTimeout(() => setAdminSuccessMsg(null), 4000);
          return;
        }
      }
    } catch (err: any) {
      console.warn("Ralat pelayan Express semasa pemadaman:", err);
    }
    
    // Always fallback to standard local reset visual feedback & refresh
    setAdminSuccessMsg("Pengesahan ahli berjaya diset semula.");
    setDeleteConfirmIc(null);
    await refreshConfirmations();
    setTimeout(() => setAdminSuccessMsg(null), 4000);
  };

  // Derived state: Entire member roster with physical/digital confirmation mapping
  const rosterWithStatus = helperMemberPDFData.map((member) => {
    const cleanMemberIc = member.ic.replace(/\D/g, "");
    const match = confirmedList.find(
      (c) => c.icNumber.replace(/\D/g, "") === cleanMemberIc
    );
    return {
      fullName: member.name,
      icNumber: member.ic,
      saham: member.saham,
      yuran: member.yuran,
      terima: member.terima,
      totalAccumulated: member.jumlah,
      isConfirmed: !!match,
      confirmationDate: match ? match.confirmationDate : null,
    };
  });

  const filteredRoster = rosterWithStatus.filter((item) => {
    // 1. Tab filter
    if (adminTab === "sudah" && !item.isConfirmed) return false;
    if (adminTab === "belum" && item.isConfirmed) return false;

    // 2. Search filter
    const query = adminSearch.toLowerCase();
    if (!query) return true;

    return (
      (item.fullName || "").toLowerCase().includes(query) ||
      (item.icNumber || "").replace(/\D/g, "").includes(query)
    );
  });

  const handleDownloadRosterCSV = () => {
    try {
      const headers = [
        "Nama Anggota",
        "No Kad Pengenalan",
        "Bayaran Modal Saham (RM)",
        "Bayaran Modal Yuran (RM)",
        "Yuran Diterima (RM)",
        "Jumlah Terkumpul (RM)",
        "Status Pengesahan",
        "Tarikh & Masa Disahkan"
      ];

      const csvRows = [headers.join(",")];

      rosterWithStatus.forEach((item) => {
        const row = [
          `"${item.fullName.toUpperCase().replace(/"/g, '""')}"`,
          `="${item.icNumber}"`,
          item.saham,
          item.yuran,
          item.terima,
          item.totalAccumulated,
          `"${item.isConfirmed ? 'SUDAH PENGESAHAN' : 'BELUM PENGESAHAN'}"`,
          `"${item.confirmationDate || ''}"`
        ];
        csvRows.push(row.join(","));
      });

      const csvContent = "\uFEFF" + csvRows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `Data_Keseluruhan_Ahli_Koperasi_TCS_2026.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      console.error("Gagal muat turun data CSV", err);
      setAdminError("Gagal memuat turun data CSV: " + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col justify-between font-sans text-black selection:bg-black selection:text-white">
      
      {/* Upper Navigation/Header Bar */}
      <header className="no-print bg-white border-b-2 border-black py-4 px-4 md:py-6 md:px-6 md:sticky md:top-0 z-50">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          
          {/* Geometric Balance Logo Box and Title Pairing */}
          <div className="flex items-center gap-3 md:gap-4">
            <div className="relative w-[48px] h-[48px] md:w-[60px] md:h-[60px] flex items-center justify-center select-none overflow-hidden shrink-0">
              <img 
                src="https://i.postimg.cc/kDP75HR2/LOGO-SEDANG.png" 
                alt="Logo Koperasi" 
                className="w-full h-full object-contain" 
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.src = "https://i.postimg.cc/kDP75HR2/LOGO-SEDANG.png";
                }}
              />
            </div>
            <div>
              <h1 className="text-sm md:text-lg font-black tracking-tight text-black leading-tight uppercase">
                Koperasi Pegawai-Pegawai Tadbir Negeri Terengganu Berhad
              </h1>
              <p className="text-[10px] md:text-xs font-mono text-stone-600 tracking-widest uppercase font-bold">
                PENYATA KEDUDUKAN SAHAM DAN LAIN-LAIN BAYARAN SEHINGGA MAC 2026
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-30"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-black"></span>
            </span>
            <span className="text-xs font-mono font-bold text-black bg-white px-3 py-1 border-2 border-black uppercase tracking-widest">
              Setakat: 31 Mac 2026
            </span>
          </div>

        </div>
      </header>

      {/* Main Container Area with Grid Layout representing Geometric Balance */}
      <main className="flex-grow flex items-center justify-center py-12 px-4 md:px-8 bg-white min-h-[70vh]">
        <div className="w-full max-w-4xl">
          
          <AnimatePresence mode="wait">
            {isAdminLoggedIn ? (
              
              /* Dedicated Admin Panel displaying list of confirmed members */
              <motion.div
                key="admin-panel-view"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                
                {/* Admin Header and Stats Summary Grid */}
                <div className="bg-white border-2 border-black p-6 md:p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 border-2 border-black bg-stone-900 text-white flex items-center justify-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] select-none">
                        <ShieldCheck className="w-8 h-8" />
                      </div>
                      <div>
                        <p className="text-[10px] text-stone-500 font-mono font-bold tracking-widest uppercase mb-1">
                          Sistem Pengesahan Digital Ahli
                        </p>
                        <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight text-black">
                          Panel Pentadbir Koperasi (TCS COOP)
                        </h2>
                      </div>
                    </div>
                    
                    <button
                      onClick={handleAdminLogout}
                      className="bg-white hover:bg-black text-black hover:text-white border-2 border-black font-black uppercase tracking-widest py-2.5 px-6 transition-all duration-200 select-none cursor-pointer text-xs shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 inline-flex items-center gap-2"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Log Keluar Admin</span>
                    </button>
                  </div>
                </div>

                {/* Database Metrics and Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white border-2 border-black p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <span className="text-[9px] font-mono font-black text-stone-500 uppercase tracking-widest block mb-1">
                      Jumlah Roster Ahli
                    </span>
                    <span className="text-2xl font-black font-mono block text-black">
                      {rosterWithStatus.length} AHLI
                    </span>
                    <span className="text-[10px] font-bold text-stone-500 block mt-1 uppercase">
                      Rekod Penuh Ahli
                    </span>
                  </div>

                  <div className="bg-white border-2 border-black p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <span className="text-[9px] font-mono font-black text-emerald-600 uppercase tracking-widest block mb-1">
                      Sudah Pengesahan
                    </span>
                    <span className="text-2xl font-black font-mono block text-emerald-600">
                      {confirmedList.length} AHLI
                    </span>
                    <span className="text-[10px] font-bold text-stone-500 block mt-1 uppercase">
                      Telah Melakukan Sah Digital
                    </span>
                  </div>

                  <div className="bg-white border-2 border-black p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <span className="text-[9px] font-mono font-black text-amber-600 uppercase tracking-widest block mb-1">
                      Belum Pengesahan
                    </span>
                    <span className="text-2xl font-black font-mono block text-amber-650">
                      {rosterWithStatus.length - confirmedList.length} AHLI
                    </span>
                    <span className="text-[10px] font-bold text-stone-500 block mt-1 uppercase">
                      Belum Melakukan Sah Digital
                    </span>
                  </div>
                </div>

                {/* Search and Tabs Filter Controls Container */}
                <div className="bg-white border-2 border-black p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-4">
                  <div>
                    <span className="text-[9px] font-mono font-black text-stone-500 uppercase tracking-widest block mb-1.5">
                      Pencarian Pantas Ahli (Nama / No. KP tanpa sengkang)
                    </span>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-4 w-4 text-stone-600" />
                      </div>
                      <input
                        type="text"
                        value={adminSearch}
                        onChange={(e) => setAdminSearch(e.target.value)}
                        placeholder="Cari Nama Anggota atau Kad Pengenalan..."
                        className="w-full bg-white text-black placeholder:text-stone-300 font-mono text-xs border border-stone-300 focus:border-black p-2.5 pl-9 outline-none rounded-none"
                      />
                    </div>
                  </div>

                  {/* Filter Tabs */}
                  <div className="flex flex-wrap gap-2 pt-3 border-t border-stone-100">
                    <button
                      onClick={() => setAdminTab("semua")}
                      className={`font-mono text-[10px] font-black uppercase tracking-wider py-1.5 px-4 border shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all ${
                        adminTab === "semua"
                          ? "bg-black text-white border-black"
                          : "bg-white text-black border-stone-350 hover:bg-stone-50"
                      }`}
                    >
                      Semua Ahli ({rosterWithStatus.length})
                    </button>
                    <button
                      onClick={() => setAdminTab("sudah")}
                      className={`font-mono text-[10px] font-black uppercase tracking-wider py-1.5 px-4 border shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all ${
                        adminTab === "sudah"
                          ? "bg-emerald-650 text-white border-emerald-700"
                          : "bg-white text-black border-stone-350 hover:bg-stone-50"
                      }`}
                    >
                      Sudah Pengesahan ({confirmedList.length})
                    </button>
                    <button
                      onClick={() => setAdminTab("belum")}
                      className={`font-mono text-[10px] font-black uppercase tracking-wider py-1.5 px-4 border shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all ${
                        adminTab === "belum"
                          ? "bg-amber-600 text-white border-amber-700"
                          : "bg-white text-black border-stone-350 hover:bg-stone-50"
                      }`}
                    >
                      Belum Pengesahan ({rosterWithStatus.length - confirmedList.length})
                    </button>
                  </div>
                </div>

                {/* Operation Messages feed */}
                {adminSuccessMsg && (
                  <motion.div
                    initial={{ scale: 0.98, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="p-3.5 bg-emerald-50 border-2 border-emerald-600 text-emerald-850 font-bold uppercase font-mono tracking-wide text-xs text-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <span>{adminSuccessMsg}</span>
                  </motion.div>
                )}

                {adminError && (
                  <motion.div
                    initial={{ scale: 0.98, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="p-3.5 bg-red-50 border-2 border-red-650 text-red-700 font-bold uppercase font-mono tracking-wide text-xs text-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <span>{adminError}</span>
                  </motion.div>
                )}

                {/* Core Datatable of Confirmed & Unconfirmed Members */}
                <div className="bg-white border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                  <div className="bg-black text-white p-4 font-black text-xs uppercase tracking-wider block">
                    Senarai Anggota Koperasi (Roster Semakan Sah Digital)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse font-sans">
                      <thead>
                        <tr className="bg-stone-50 font-black border-b border-black font-mono uppercase text-stone-850">
                          <th className="py-3.5 px-4 border-r border-stone-200 text-center w-[50px]">Bil</th>
                          <th className="py-3.5 px-4 border-r border-stone-200">Nama Anggota</th>
                          <th className="py-3.5 px-4 border-r border-stone-200 w-[140px]">Kad Pengenalan</th>
                          <th className="py-3.5 px-4 border-r border-stone-200 w-[110px] text-center">Status</th>
                          <th className="py-3.5 px-4 border-r border-stone-200 w-[210px]">Tarikh & Masa Disahkan</th>
                          <th className="py-3.5 px-4 text-center w-[230px]">Tindakan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200 font-medium text-black">
                        {filteredRoster.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-12 text-center text-stone-500 font-mono uppercase tracking-widest text-xs">
                              Tiada rekod ahli koperasi ditemui berdasarkan penapis pencarian "{adminSearch || ""}".
                            </td>
                          </tr>
                        ) : (
                          filteredRoster.map((item, idx) => (
                            <tr key={item.icNumber} className="hover:bg-stone-50/50 transition-colors">
                              <td className="py-3 px-4 border-r border-stone-200 text-center font-mono font-bold text-stone-600">
                                {idx + 1}
                              </td>
                              <td className="py-3 px-4 border-r border-stone-200 truncate max-w-[200px] font-bold uppercase text-black">
                                {item.fullName}
                              </td>
                              <td className="py-3 px-4 border-r border-stone-200 font-mono font-bold text-stone-700">
                                {item.icNumber}
                              </td>
                              <td className="py-3 px-4 border-r border-stone-200 text-center">
                                {item.isConfirmed ? (
                                  <span className="inline-block px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[9px] font-black uppercase">
                                    SUDAH
                                  </span>
                                ) : (
                                  <span className="inline-block px-1.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-200 font-mono text-[9px] font-black uppercase">
                                    BELUM
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-4 border-r border-stone-200 font-mono font-bold text-stone-600">
                                {item.isConfirmed ? (
                                  item.confirmationDate
                                ) : (
                                  <span className="text-stone-300 italic">- (Tiada Rekod)</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center h-full">
                                {item.isConfirmed ? (
                                  <div className="flex justify-center items-center gap-1.5">
                                    {/* Print PDF Statement action */}
                                    <button
                                      onClick={() => handleAdminPrint(item)}
                                      className="bg-stone-900 hover:bg-black text-white font-black text-[9px] uppercase border border-black px-2.5 py-1.5 rounded-none tracking-wide transition-all duration-150 flex items-center h-7 gap-1 cursor-pointer"
                                    >
                                      <Printer className="w-3 h-3" />
                                      Cetak
                                    </button>

                                    {/* Confirmation-guarded delete action */}
                                    {deleteConfirmIc === item.icNumber ? (
                                      <div className="flex gap-1">
                                        <button
                                          onClick={() => handleDeleteConfirmation(item.icNumber)}
                                          className="bg-red-650 text-white font-black text-[9px] uppercase border border-red-700 px-2.5 py-1.5 rounded-none hover:bg-red-700 h-7 cursor-pointer"
                                        >
                                          Ya
                                        </button>
                                        <button
                                          onClick={() => setDeleteConfirmIc(null)}
                                          className="bg-stone-100 text-stone-700 font-black text-[9px] uppercase border border-stone-300 px-2.5 py-1.5 rounded-none hover:bg-stone-200 h-7 cursor-pointer"
                                        >
                                          Batal
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => setDeleteConfirmIc(item.icNumber)}
                                        className="bg-white hover:bg-red-50 text-red-600 font-black text-[9px] uppercase border border-red-200 px-2.5 py-1.5 rounded-none tracking-wide transition-all duration-150 flex items-center h-7 gap-1 cursor-pointer"
                                      >
                                        <Trash2 className="w-3 h-3 text-red-600" />
                                        Batal Sah
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-stone-300 font-mono text-[9px] italic">Sedia diakses ahli</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Export Button Block */}
                  <div className="p-5 bg-stone-50 border-t-2 border-black flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="text-stone-700 text-xs font-semibold leading-relaxed">
                      Eksport dan muat turun senarai penuh maklumat kewangan dan status pengesahan seluruh ahli koperasi untuk rekod pentadbiran.
                    </div>
                    <button
                      onClick={handleDownloadRosterCSV}
                      className="whitespace-nowrap bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-wider py-3.5 px-6 border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 active:translate-x-1 active:translate-y-1 transition-all text-xs flex items-center justify-center gap-2 cursor-pointer w-full md:w-auto select-none"
                    >
                      <Download className="w-4 h-4 shrink-0 text-white" />
                      <span>Muat Turun Semua Data Ahli (CSV)</span>
                    </button>
                  </div>
                </div>

                {/* Disclaimer */}
                <div className="p-4 border-2 border-stone-100 text-stone-500 font-bold italic text-[10px] md:text-xs tracking-wider leading-relaxed text-center font-mono">
                  Sistem pengurusan data ini dipasang secara langsung bersama sistem pelayan pendaftaran automatik. Sebarang tindakan "Batal Sah" akan menetapkan status ahli agar mereka bersedia untuk memproses semula rukun pengesahan digital mereka pada halaman hadapan.
                </div>

              </motion.div>

            ) : !loggedInMember ? (
              
              /* Public / Member Login section + Minimal, secure Admin Log In box at the very bottom */
              <div className="space-y-12">
                <motion.div
                  key="login-view"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="bg-white border-2 border-black p-5 sm:p-8 md:p-12 max-w-lg mx-auto shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
                >
                  
                  {/* Embedded Geometric Crest */}
                  <div className="flex flex-col items-center justify-center text-center mb-8">
                    {/* Symmetrical logo block */}
                    <div className="relative w-20 h-20 flex items-center justify-center mb-4 overflow-hidden">
                      <img 
                        src="https://i.postimg.cc/kDP75HR2/LOGO-SEDANG.png" 
                        alt="Logo Koperasi" 
                        className="w-full h-full object-contain" 
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.src = "https://i.postimg.cc/kDP75HR2/LOGO-SEDANG.png";
                        }}
                      />
                    </div>
                    
                    <h2 className="text-2xl font-black uppercase tracking-tight text-black">
                      Penyata Kedudukan Saham 2026
                    </h2>
                  </div>

                  <div className="bg-white border border-black p-5 mb-6 text-black space-y-4">
                    <div className="flex gap-3">
                      <Info className="w-5 h-5 text-black shrink-0 mt-0.5" />
                      <p className="text-xs leading-relaxed font-semibold">
                        Kerjasama sepenuhnya diharapkan untuk membuat pengesahan ini bagi tujuan audit. Selepas membuat pengesahan, penyata kedudukan saham akan dimuat turun secara automatik ke peranti anda. Jika ada sebarang masalah sila hubungi kami di Tel No : <strong>09-6285951</strong> atau melalui email kami : <span className="underline">koperasitcs@gmail.com</span>.
                      </p>
                    </div>
                    <div className="text-center font-black text-[10px] tracking-wider uppercase pt-2 border-t border-stone-200">
                      @ KOPERASI PEGAWAI-PEGAWAI TADBIR NEGERI TERENGGANU BERHAD
                    </div>
                  </div>

                  <form onSubmit={handleLogin} className="space-y-6">
                    <div>
                      <label htmlFor="ic-input" className="block text-xs font-bold text-black mb-2.5 tracking-wider uppercase">
                        Nombor Kad Pengenalan (No. KP)
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                          <CreditCard className="h-5 w-5 text-black" />
                        </div>
                        <input
                          id="ic-input"
                          type="text"
                          value={icInput}
                          onChange={handleICChange}
                          placeholder="XXXXXX-XX-XXXX"
                          maxLength={14}
                          className="w-full bg-white text-black placeholder:text-stone-300 text-lg font-mono focus:ring-0 border-2 border-black rounded-none pl-11 pr-4 py-3.5 transition-all text-center tracking-widest outline-none font-black"
                          autoFocus
                        />
                      </div>
                      {/* User Instruction specified in requirements */}
                      <p className="text-xs text-stone-700 mt-3.5 text-center leading-relaxed font-semibold">
                        Sila masukkan nombor kad pengenalan anda untuk mengakses maklumat ahli
                      </p>
                      <span className="block text-[10px] text-center text-stone-500 font-mono font-bold mt-1 uppercase tracking-wider">
                        Contoh: 890101-10-5000
                      </span>
                    </div>

                    {loginError && (
                      <motion.div
                        initial={{ scale: 0.98, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="p-3 bg-white border-2 border-red-600 rounded-none text-xs font-bold text-red-600 flex items-center gap-2.5"
                      >
                        <span className="h-2.5 w-2.5 bg-red-600 shrink-0"></span>
                        <p>{loginError}</p>
                      </motion.div>
                    )}

                    <button
                      id="submit-login-btn"
                      type="submit"
                      className="w-full bg-black hover:bg-white border-2 border-black text-white hover:text-black font-black uppercase tracking-widest py-4 px-6 transition-all duration-200 select-none cursor-pointer text-xs shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none"
                    >
                      <span>Masuk & Log Nama Anggota</span>
                    </button>
                  </form>

                </motion.div>

                {/* Symmetrical Discrete Admin Credentials Entry Box at the very bottom of the front page */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="max-w-md mx-auto bg-white border border-stone-200 hover:border-black p-6 transition-all duration-300 focus-within:border-black"
                >
                  <div className="flex items-center gap-2 mb-4 justify-center text-stone-500">
                    <Lock className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-mono font-black uppercase tracking-widest text-stone-750">
                      Urusetia Pentadbir (Private)
                    </span>
                  </div>
                  <form onSubmit={handleAdminLogin} className="space-y-3">
                    <div>
                      <input
                        type="text"
                        placeholder="E-mel Pentadbir"
                        value={adminUser}
                        onChange={(e) => setAdminUser(e.target.value)}
                        className="w-full bg-white text-black placeholder:text-stone-300 text-xs font-mono font-bold border border-stone-200 p-2.5 outline-none rounded-none focus:border-black text-center"
                      />
                    </div>
                    <div>
                      <input
                        type="password"
                        placeholder="Kata Laluan"
                        value={adminPass}
                        onChange={(e) => setAdminPass(e.target.value)}
                        className="w-full bg-white text-black placeholder:text-stone-300 text-xs font-mono font-bold border border-stone-200 p-2.5 outline-none rounded-none focus:border-black text-center"
                      />
                    </div>
                    {adminError && (
                      <div className="text-[10px] text-center text-red-650 bg-red-50 border border-red-200 font-black uppercase font-mono tracking-wide p-2">
                        {adminError}
                      </div>
                    )}
                    <button
                      type="submit"
                      className="w-full bg-stone-900 border border-stone-950 text-white hover:bg-black font-black uppercase tracking-wider py-2.5 px-4 transition-all duration-200 cursor-pointer text-[10px] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none outline-none active:translate-x-0.5 active:translate-y-0.5"
                    >
                      Log Masuk Pentadbir
                    </button>
                  </form>
                </motion.div>
              </div>

            ) : (

              /* Logged In Member Screen styled in clean geometric columns */
              <motion.div
                key="authenticated-view"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                
                {/* Member Portal Header Card */}
                <div className="no-print bg-white border-2 border-black p-6 md:p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 border-2 border-black bg-white text-black flex items-center justify-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] select-none">
                      <User className="w-7 h-7" />
                    </div>
                    <div>
                      <p className="text-[10px] text-stone-500 font-mono font-bold tracking-widest uppercase mb-1">Nama Penuh Anggota Koperasi</p>
                      <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight text-black">
                        {loggedInMember.fullName}
                      </h2>
                    </div>
                  </div>
                </div>

                {/* ANIMATED FINANCIAL STATEMENT SHEETS DISCLOSED UPON PENGESAHAN CLICK */}
                <AnimatePresence>
                  {showFinancials && (
                    <motion.div
                      key="financial-sheets"
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 30 }}
                      transition={{ type: "spring", damping: 25, stiffness: 120 }}
                      className="print-card bg-white border-4 border-black p-4 sm:p-8 md:p-12 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] relative overflow-hidden"
                    >
                      
                      {/* Geometric background stamp watermark (pure css layout) */}
                      <div className="absolute -right-16 -top-16 w-64 h-64 border-8 border-black/5 rounded-full flex items-center justify-center pointer-events-none select-none">
                        <div className="w-48 h-48 border-4 border-dashed border-black/5 rounded-full" />
                      </div>
                      {/* Header Logo & Crest inside statement */}
                      <div className="flex flex-col items-center justify-center text-center pb-6 mb-8 gap-4">
                        {/* Centered Crest */}
                        <div className="relative w-24 h-24 flex items-center justify-center select-none overflow-hidden">
                          <img 
                            id="koperasi-logo"
                            src="https://i.postimg.cc/kDP75HR2/LOGO-SEDANG.png" 
                            alt="Logo Koperasi" 
                            crossOrigin="anonymous"
                            className="w-full h-full object-contain" 
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.src = "https://i.postimg.cc/kDP75HR2/LOGO-SEDANG.png";
                            }}
                          />
                        </div>
                        
                        <div className="w-full space-y-1">
                          <h2 className="text-lg md:text-2xl font-black tracking-tight text-black uppercase leading-tight">
                            Penyata Kedudukan Saham Dan Lain-lain
                          </h2>
                          <h2 className="text-lg md:text-2xl font-black tracking-tight text-black uppercase leading-tight">
                            Bayaran Sehingga 31 Mac 2026
                          </h2>
                        </div>
                      </div>

                      {/* Display Member Name */}
                      <div className="mb-6 mt-4 text-left border-b border-stone-100 pb-3">
                        <span className="text-sm md:text-lg font-black text-black block tracking-wide font-mono">
                          {loggedInMember.fullName.toUpperCase()}
                        </span>
                      </div>

                      {/* If the financial record doesn't match/fallback */}
                      {!matchedFinancials ? (
                        <div className="p-8 border-2 border-dashed border-black text-center space-y-3 bg-white">
                          <FileText className="w-12 h-12 mx-auto text-black" />
                          <h4 className="font-black text-lg uppercase text-black">Penyata Ringkas (Tiada Maklumat PDF)</h4>
                          <p className="text-xs text-stone-700 max-w-sm mx-auto font-medium">
                            Nama anda disenaraikan sebagai anggota sah koperasi. Walau bagaimanapun, tiada rekod kedudukan saham fizikal ditemui dalam helaian kelayakkan kewangan setakat 31 Mac 2026.
                          </p>
                          <div className="pt-4">
                            <span className="text-xs font-mono font-bold bg-black text-white px-4 py-2 border-2 border-black uppercase tracking-wider">
                              Yuran Permulaan Berdaftar: RM 100.00
                            </span>
                          </div>
                        </div>
                      ) : (
                        
                        /* Renders full columns matching the PDF data physically */
                        <div className="space-y-8">
                          
                          {/* Financial Column breakdown designed exactly like mockup */}
                          <div className="border-2 border-black overflow-x-auto bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                            <table className="w-full text-[10px] sm:text-xs md:text-sm border-collapse text-black font-semibold min-w-[320px]">
                              <thead>
                                <tr className="bg-stone-50 border-b-2 border-black text-center font-black">
                                  <th className="py-2.5 px-2 sm:py-3 sm:px-4 border-r-2 border-black text-left w-1/2 uppercase tracking-wide">PERKARA</th>
                                  <th className="py-2.5 px-2 sm:py-3 sm:px-4 border-r-2 border-black w-1/4 uppercase tracking-wide">MODAL SAHAM</th>
                                  <th className="py-2.5 px-2 sm:py-3 sm:px-4 w-1/4 uppercase tracking-wide">MODAL YURAN</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y-2 divide-black">
                                <tr>
                                  <td className="py-2.5 px-2 sm:py-4 sm:px-4 border-r-2 border-black text-left leading-relaxed">
                                    Bayaran terkumpul modal saham sehingga 31 Mac 2026
                                  </td>
                                  <td className="py-2.5 px-2 sm:py-4 sm:px-4 border-r-2 border-black text-center font-mono font-bold whitespace-nowrap">
                                    {formatCurrency(matchedFinancials.saham)}
                                  </td>
                                  <td className="py-2.5 px-2 sm:py-4 sm:px-4 text-center font-mono font-bold whitespace-nowrap">
                                    {formatCurrency(matchedFinancials.yuran)}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="py-2.5 px-2 sm:py-4 sm:px-4 border-r-2 border-black text-left leading-relaxed">
                                    <div>Bayaran diterima dalam tahun kewangan</div>
                                    <div className="text-[9px] sm:text-[10px] md:text-xs text-stone-600 font-semibold">(April 2025 - Mac 2026)</div>
                                  </td>
                                  <td className="py-2.5 px-2 sm:py-4 sm:px-4 border-r-2 border-black bg-stone-50 text-center text-stone-400 font-bold whitespace-nowrap">
                                    -
                                  </td>
                                  <td className="py-2.5 px-2 sm:py-4 sm:px-4 text-center font-mono font-bold whitespace-nowrap">
                                    {formatCurrency(matchedFinancials.terima)}
                                  </td>
                                </tr>
                                <tr className="bg-stone-50 font-black">
                                  <td colSpan={2} className="py-2.5 px-2 sm:py-4 sm:px-4 border-r-2 border-black text-left tracking-wide uppercase">
                                    JUMLAH TERKUMPUL SEHINGGA 31 MAC 2026:
                                  </td>
                                  <td className="py-2.5 px-2 sm:py-4 sm:px-4 text-center font-mono font-black text-xs md:text-base whitespace-nowrap">
                                    {formatCurrency(matchedFinancials.jumlah)}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>

                          {/* Statement Confirmation Label below table */}
                          <div className="text-left mt-6">
                            <p className="text-[10px] md:text-xs font-bold italic text-stone-600 tracking-wide text-center pt-4 border-t border-dashed border-stone-200 mt-4 leading-relaxed">
                              “Pengesahan penyata ini adalah cetakan komputer dan tandatangan tidak diperlukan”
                            </p>
                          </div>

                          {/* Interactive Approval Block in Radio button style */}
                          {isConfirmed ? (
                            <div className="bg-emerald-50 border-2 border-black p-6 space-y-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                <div className="flex items-center gap-2.5">
                                  <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                                  <div>
                                    <span className="text-xs font-mono font-black text-emerald-700 block uppercase leading-none tracking-wider mb-1.5">
                                      PENGESAHAN MAKLUMAT DISAHKAN & SAH DIGITAL
                                    </span>
                                    <span className="text-[10px] font-mono font-bold text-stone-600 block uppercase leading-none">
                                      ID Pengesah: CONF-{matchedFinancials.ic.substring(0, 6)}-{matchedFinancials.jumlah}
                                    </span>
                                  </div>
                                </div>

                                <div className="text-left md:text-right bg-white px-4 py-2 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                  <span className="text-[9px] font-mono text-stone-500 uppercase block tracking-widest font-black leading-none mb-1.5">
                                    Tarikh & Masa Disahkan:
                                  </span>
                                  <span className="text-xs font-mono font-black text-black block uppercase leading-none">
                                    {confirmationDate}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-white border-2 border-black p-6 space-y-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                              <label className="flex items-start gap-4 cursor-pointer select-none">
                                <div className="shrink-0 mt-1">
                                  <input
                                    type="radio"
                                    name="akuan_aku_janji"
                                    checked={hasTickedAkuJanji}
                                    onChange={() => setHasTickedAkuJanji(true)}
                                    style={{ accentColor: "black" }}
                                    className="w-5 h-5 border-2 border-black cursor-pointer"
                                  />
                                </div>
                                <div className="flex-1">
                                  <h4 className="font-black text-xs text-black uppercase tracking-wider mb-1">
                                    Pengesahan Akuan Aku Janji Digital <span className="text-red-600 font-bold">*</span>
                                  </h4>
                                  <p className="text-xs text-stone-700 leading-relaxed font-semibold">
                                    Saya mengesahkan bahawa Penyata Kedudukan Saham Koperasi Pegawai-Pegawai Tadbir Negeri Terengganu Berhad bertarikh 31 Mac 2026 ini adalah disemak, betul, dan dijajar mengikut rekod caruman kewangan saya.
                                  </p>
                                </div>
                              </label>
                              <div className="pt-2">
                                <span className="text-[10px] font-mono text-stone-500 font-black uppercase tracking-wide">
                                  * Sila klik butang radio di atas untuk pengesahan digital sebelum menekan butang hantar.
                                </span>
                              </div>
                            </div>
                          )}

                        </div>
                      )}

                      {/* Symmetrical digital copy watermark from theme */}
                      <div className="absolute bottom-6 right-6 font-mono text-[9px] text-stone-500 font-bold uppercase tracking-widest transform rotate-[-90deg] origin-bottom-right pointer-events-none select-none">
                        Dokumen Rasmi Koperasi Pegawai-Pegawai Tadbir Negeri Terengganu Berhad - Salinan Digital 2026
                      </div>

                      {/* Email Dispatch Result Notification Overlay */}
                      {isSendingEmail && (
                        <div className="no-print mt-6 p-4 border border-black bg-stone-50 text-black flex items-center justify-center gap-2 font-mono text-xs font-bold uppercase tracking-wide animate-pulse">
                          <span className="w-2.5 h-2.5 bg-black rounded-full animate-ping shrink-0" />
                          <span>Menjana PDF & Menyimpan Maklumat Pengesahan...</span>
                        </div>
                      )}

                      {emailSuccessMessage && (
                        <div className="no-print mt-6 p-5 border-2 border-black bg-stone-50 text-black text-xs font-bold space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                          <div className="flex items-center gap-2 text-emerald-700 font-extrabold text-sm uppercase">
                            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                            <span>Berjaya! PDF Telah Dijana & Dimuat Turun</span>
                          </div>
                          <p className="text-black leading-relaxed text-xs uppercase font-black font-mono">
                            Penyata PDF telah berjaya dimuat turun ke komputer/peranti anda, dan status pengesahan anda telah direkodkan.
                          </p>
                        </div>
                      )}

                      {emailErrorMessage && (
                        <div className="no-print mt-6 p-4 border border-black bg-red-50 text-red-700 text-xs font-bold space-y-1">
                          <p className="uppercase font-black">Ralat Pengesahan</p>
                          <p className="font-mono text-[10px] text-red-900 leading-normal">
                            {emailErrorMessage}
                          </p>
                        </div>
                      )}

                      {/* Footer Actions / Cert Stamp & Print buttons */}
                      <div className="no-print mt-10 pt-6 border-t border-black flex flex-col sm:flex-row justify-between items-center gap-4">
                        <p className="text-[10px] text-stone-500 font-mono font-bold uppercase tracking-widest">
                          Koperasi Pegawai-Pegawai Tadbir Negeri Terengganu Berhad &copy; 2026. Hak Cipta Terpelihara.
                        </p>
                        
                        <button
                          id="print-statement-btn"
                          disabled={isSendingEmail || (!isConfirmed && !hasTickedAkuJanji)}
                          onClick={handlePrint}
                          className="w-full sm:w-auto bg-black hover:bg-white disabled:bg-stone-300 disabled:text-stone-500 disabled:border-stone-300 border-2 border-black text-white hover:text-black font-black uppercase tracking-wider py-3.5 px-8 transition-all duration-200 select-none cursor-pointer text-xs shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 inline-flex items-center justify-center gap-2"
                        >
                          {isSendingEmail ? (
                            <>
                              <span className="w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin inline-block shrink-0" />
                              <span>Sila Tunggu...</span>
                            </>
                          ) : isConfirmed ? (
                            <>
                              <Printer className="w-4 h-4 text-center inline z-10" />
                              <span>Cetak Penyata (Cipta PDF)</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-4 h-4 text-center inline z-10" />
                              <span>SAHKAN & MUAT TURUN PDF</span>
                            </>
                          )}
                        </button>
                      </div>

                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Logout Button placed at the very bottom */}
                <div className="no-print flex justify-center pt-6">
                  <button
                    id="logout-bttn"
                    onClick={handleLogout}
                    className="w-full sm:w-auto bg-white hover:bg-black text-black hover:text-white border-2 border-black font-black uppercase tracking-widest py-3.5 px-8 transition-all duration-200 select-none cursor-pointer text-xs shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 inline-flex items-center justify-center gap-2"
                  >
                    <LogOut className="w-4 h-4 text-center inline" />
                    <span>Logout (Keluar)</span>
                  </button>
                </div>

              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </main>



    </div>
  );
}
