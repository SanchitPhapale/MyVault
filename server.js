// ===============================
// IMPORTS
// ===============================

require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const archiver = require("archiver");

const os = require("os");
const {
  uploadFile,
  getFile,
  deleteFile,
  fileExists,
  saveJSON,
  getJSON,
} = require("./idrive");
// ===============================
// CONFIGURATION
// ===============================

const PORT = process.env.PORT || 3000;
const VAULT_PASSWORD = process.env.VITE_VAULT_PASSWORD || "12345";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "dev-secret-change-in-production";
const STORAGE_LIMIT = parseInt(process.env.STORAGE_LIMIT || "10737418240", 10);
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || "524288000", 10);

const DATA_DIR = path.join(__dirname, "vault-data");
const FILES_DIR = path.join(DATA_DIR, "files");
const META_FILE = path.join(DATA_DIR, "meta.json");
const ACTIVITY_FILE = path.join(DATA_DIR, "activity.json");


// IDrive e2 metadata storage
const META_KEY = "metadata/meta.json";
const ACTIVITY_KEY = "metadata/activity.json";

// Allowed extensions for upload validation
const ALLOWED_EXT = new Set([
  "doc",
  "docx",
  "txt",
  "rtf",
  "odt",
  "pdf",
  "ppt",
  "pptx",
  "odp",
  "xls",
  "xlsx",
  "csv",
  "ods",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "bmp",
  "mp4",
  "webm",
  "mov",
  "mkv",
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "html",
  "css",
  "js",
  "json",
  "xml",
  "c",
  "cpp",
  "java",
  "py",
  "sql",
  "md",
]);

// ===============================
// MIDDLEWARE
// ===============================
const app = express();
// ===============================
// GLOBAL ERROR HANDLING
// ===============================

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Promise Rejection:", reason);
});
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser(SESSION_SECRET));

// Simple in-memory rate limiter for login
const loginAttempts = new Map();
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_MAX = 10;
function loginLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, first: now };
  if (now - rec.first > LOGIN_WINDOW) {
    rec.count = 0;
    rec.first = now;
  }
  rec.count++;
  loginAttempts.set(ip, rec);
  if (rec.count > LOGIN_MAX) {
    return res
      .status(429)
      .json({ error: "Too many attempts. Try again later." });
  }
  next();
}

// Session middleware
const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24h
function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = Date.now() + SESSION_TTL;
  sessions.set(token, { token, expires });
  return token;
}
function getSession(req) {
  const token = req.signedCookies.session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) {
    sessions.delete(token);
    return null;
  }
  return s;
}
function requireAuth(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: "Session expired" });
  req.session = s;
  next();
}

// Multer upload config
// Multer upload config
// Files are temporarily stored locally and then uploaded to IDrive e2.

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, os.tmpdir());
    },

    filename: (req, file, cb) => {
      const id = crypto.randomBytes(16).toString("hex");
      const ext = path.extname(file.originalname).toLowerCase();

      cb(null, id + ext);
    },
  }),

  limits: {
    fileSize: MAX_FILE_SIZE,
  },

  fileFilter: (req, file, cb) => {
    const ext = path
      .extname(file.originalname)
      .toLowerCase()
      .replace(".", "");

    if (!ALLOWED_EXT.has(ext)) {
      return cb(new Error("File type not allowed"));
    }

    cb(null, true);
  },
});
// ===============================
// DATABASE (JSON file store)
// ===============================
function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
  if (!fs.existsSync(META_FILE))
    fs.writeFileSync(META_FILE, JSON.stringify({ files: [], folders: [] }));
  if (!fs.existsSync(ACTIVITY_FILE))
    fs.writeFileSync(ACTIVITY_FILE, JSON.stringify([]));
}
ensureData();

async function readMeta() {
  return await getJSON(
    META_KEY,
    { files: [], folders: [] }
  );
}

async function writeMeta(meta) {
  await saveJSON(
    META_KEY,
    meta
  );
}

async function readActivity() {
  return await getJSON(
    ACTIVITY_KEY,
    []
  );
}

async function logActivity(action, name, meta) {
  const act = await readActivity();

  act.unshift({
    id: crypto.randomBytes(8).toString("hex"),
    action,
    name,
    ts: Date.now(),
  });

  await saveJSON(
    ACTIVITY_KEY,
    act.slice(0, 200)
  );
}
// ===============================
// AUTHENTICATION
// ===============================
app.post("/api/auth/login", loginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Password required" });
  if (password !== VAULT_PASSWORD)
    return res.status(401).json({ error: "Incorrect password" });
  const token = createSession();
  res.cookie("session", token, {
  httpOnly: true,
  signed: true,
  maxAge: SESSION_TTL,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
});
  res.json({ ok: true, expires: Date.now() + SESSION_TTL });
});

app.post("/api/auth/logout", (req, res) => {
  const token = req.signedCookies.session;
  if (token) sessions.delete(token);
  res.clearCookie("session", {
  httpOnly: true,
  signed: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
});
  res.json({ ok: true });
});

app.get("/api/auth/session", (req, res) => {
  const s = getSession(req);
  if (!s) return res.status(401).json({ ok: false });
  res.json({ ok: true, expires: s.expires });
});

// ===============================
// FILE APIs
// ===============================
app.get("/api/files", requireAuth, async (req, res) => {
  const meta = await readMeta();
  const { folderId, trashed, favorite, recent } = req.query;
  let files = meta.files.filter((f) => !!f.trashed === (trashed === "true"));
  if (folderId !== undefined)
    files = files.filter((f) => f.folderId === folderId);
  if (favorite === "true") files = files.filter((f) => f.favorite);
  if (recent === "true")
    files = [...files].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  res.json(files);
});

app.post(
  "/api/files/upload",
  requireAuth,
  upload.array("files"),
  async (req, res) => {
    try {
      const meta = await readMeta();
      const folderId = req.body.folderId || "root";
      const created = [];

      for (const f of req.files || []) {
        const ext = path
          .extname(f.originalname)
          .toLowerCase()
          .replace(".", "");

        const id = path.basename(
          f.filename,
          path.extname(f.filename)
        );

        const extension = path
          .extname(f.originalname)
          .toLowerCase();

        const storageKey = `files/${id}${extension}`;

        // Upload temporary file to IDrive e2
        await uploadFile(
          f.path,
          storageKey,
          f.mimetype
        );

        const item = {
          id,
          name: f.originalname,
          ext,
          mime: f.mimetype,
          size: f.size,

          // IDrive e2 storage location
          storedName: storageKey,
          storageKey,

          folderId,
          favorite: false,
          trashed: false,

          createdAt: Date.now(),
          updatedAt: Date.now(),
          openedAt: null,
        };

        meta.files.push(item);
        created.push(item);

        await logActivity("uploaded", item.name);

        // Remove temporary local file
        try {
          await fsp.unlink(f.path);
        } catch {}
      }

      await writeMeta(meta);

      res.json(created);
    } catch (error) {
      console.error("Upload error:", error);

      // Clean up temporary files if upload fails
      for (const f of req.files || []) {
        try {
          await fsp.unlink(f.path);
        } catch {}
      }


      res.status(500).json({
        error: "Upload failed",
        message: error.message,
      });
    }
  }
);

app.get("/api/files/:id", requireAuth, async (req, res) => {
  const meta = await readMeta();
  const f = meta.files.find((x) => x.id === req.params.id);
  if (!f || f.trashed) return res.status(404).json({ error: "File not found" });
  res.json(f);
});

app.patch("/api/files/:id", requireAuth, async (req, res) => {
  const meta = await readMeta();
  const f = meta.files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "File not found" });
  const { name, folderId } = req.body || {};
  if (name) {
    f.name = name;
    f.ext = path.extname(name).toLowerCase().replace(".", "") || f.ext;
  }
  if (folderId !== undefined) f.folderId = folderId;
  f.updatedAt = Date.now();
  await writeMeta(meta);
  await logActivity("renamed", f.name);
  res.json(f);
});

app.delete("/api/files/:id", requireAuth, async (req, res) => {
  try {
    const meta = await readMeta();

    const f = meta.files.find(
      (x) => x.id === req.params.id
    );

    if (!f) {
      return res.status(404).json({
        error: "File not found"
      });
    }

    const permanent = req.query.permanent === "true";

    // ===============================
    // MOVE TO TRASH
    // ===============================
    if (!permanent) {
      f.trashed = true;
      f.updatedAt = Date.now();

      await writeMeta(meta);
      await logActivity("moved to trash", f.name);

      return res.json({
        ok: true,
        trashed: true
      });
    }

    // ===============================
    // PERMANENT DELETE
    // ===============================

    const storageKey = f.storageKey || f.storedName;

    if (storageKey) {
      try {
        await deleteFile(storageKey);
        console.log(
          `Deleted from IDrive: ${storageKey}`
        );
      } catch (storageError) {
        console.error(
          "IDrive delete error:",
          storageError
        );

        return res.status(500).json({
          error: "Could not delete file from storage",
          message: storageError.message
        });
      }
    }

    // Remove metadata after successful IDrive deletion
    meta.files = meta.files.filter(
      (x) => x.id !== req.params.id
    );

    await writeMeta(meta);
    await logActivity("deleted", f.name);

    res.json({
      ok: true,
      deleted: true
    });

  } catch (error) {
    console.error("Delete error:", error);

    res.status(500).json({
      error: "Delete failed",
      message: error.message
    });
  }
});

app.get("/api/files/:id/download", requireAuth, async (req, res) => {
  try {
    const meta = await readMeta();

    const f = meta.files.find(
      (x) => x.id === req.params.id
    );

    if (!f || f.trashed) {
      return res.status(404).json({
        error: "File not found"
      });
    }

    // Get the permanent IDrive storage key
    const storageKey = f.storageKey || f.storedName;

    if (!storageKey) {
      return res.status(404).json({
        error: "File storage location not found"
      });
    }

    // Get file from IDrive e2
    const result = await getFile(storageKey);

    if (!result.Body) {
      return res.status(404).json({
        error: "File not found in storage"
      });
    }

    f.openedAt = Date.now();

    await writeMeta(meta);
    await logActivity("downloaded", f.name);

    // Set download headers
    res.setHeader(
      "Content-Type",
      f.mime || "application/octet-stream"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(f.name)}"`
    );

    if (result.ContentLength !== undefined) {
      res.setHeader(
        "Content-Length",
        result.ContentLength
      );
    }

    // Stream IDrive file directly to browser
    result.Body.pipe(res);

  } catch (error) {
    console.error("Download error:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Download failed",
        message: error.message
      });
    }
  }
});
app.post("/api/files/:id/move", requireAuth, async (req, res) => {
  const meta = await readMeta();
  const f = meta.files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "File not found" });
  f.folderId = req.body.folderId || "root";
  f.updatedAt = Date.now();
  await writeMeta(meta);
  await logActivity("moved", f.name);
  res.json(f);
});

app.post("/api/files/:id/favorite", requireAuth, async (req, res) => {
  const meta = await readMeta();
  const f = meta.files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "File not found" });
  f.favorite = !f.favorite;
  f.updatedAt = Date.now();
  await writeMeta(meta);
  res.json(f);
});

// Bulk file operations (multi-select)
app.post("/api/files/bulk", requireAuth, async (req, res) => {
  const meta = await readMeta();
  const { ids, action, folderId } = req.body || {};
  if (!Array.isArray(ids))
    return res.status(400).json({ error: "ids required" });
  for (const id of ids) {
    const f = meta.files.find((x) => x.id === id);
    if (!f) continue;
    if (action === "trash") {
      f.trashed = true;
      f.updatedAt = Date.now();
    } else if (action === "favorite") {
      f.favorite = !f.favorite;
      f.updatedAt = Date.now();
    } else if (action === "move") {
      f.folderId = folderId || "root";
      f.updatedAt = Date.now();
    }
  }
  await writeMeta(meta);
  res.json({ ok: true });
});

// Bulk download as ZIP
app.post("/api/files/bulk-download", requireAuth, async (req, res) => {
  try {
    const meta = await readMeta();
    const { ids } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: "ids required"
      });
    }

    res.setHeader(
      "Content-Type",
      "application/zip"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=myvault-download.zip"
    );

    const archive = archiver("zip", {
      zlib: { level: 5 }
    });

    archive.on("error", (error) => {
      console.error(
        "ZIP archive error:",
        error
      );

      if (!res.headersSent) {
        res.status(500).json({
          error: "ZIP creation failed",
          message: error.message
        });
      }
    });

    archive.pipe(res);

    for (const id of ids) {
      const file = meta.files.find(
        (x) => x.id === id
      );

      if (!file || file.trashed) {
        continue;
      }

      const storageKey =
        file.storageKey || file.storedName;

      if (!storageKey) {
        continue;
      }

      try {
        const object = await getFile(storageKey);

        if (!object.Body) {
          continue;
        }

        archive.append(
          object.Body,
          {
            name: file.name
          }
        );

      } catch (error) {
        console.error(
          `Failed to download ${storageKey} from IDrive:`,
          error
        );
      }
    }

    await archive.finalize();

  } catch (error) {
    console.error(
      "Bulk download error:",
      error
    );

    if (!res.headersSent) {
      res.status(500).json({
        error: "Bulk download failed",
        message: error.message
      });
    }
  }
});

// ===============================
// FOLDER APIs
// ===============================
app.get("/api/folders", requireAuth, async (req, res) => {
  const meta = await readMeta();
  const { parentId, trashed } = req.query;
  let folders = meta.folders.filter(
    (f) => !!f.trashed === (trashed === "true"),
  );
  if (parentId !== undefined)
    folders = folders.filter((f) => f.parentId === parentId);
  res.json(folders);
});

app.post("/api/folders", requireAuth, async (req, res) => {
  const meta = await readMeta();
  const { name, parentId } = req.body || {};
  if (!name) return res.status(400).json({ error: "Name required" });
  const folder = {
    id: crypto.randomBytes(16).toString("hex"),
    name,
    parentId: parentId || "root",
    favorite: false,
    trashed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  meta.folders.push(folder);
  await writeMeta(meta);
  await logActivity("created", name);
  res.json(folder);
});

app.patch("/api/folders/:id", requireAuth, async (req, res) => {
  const meta = await readMeta();
  const f = meta.folders.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "Folder not found" });
  const { name, parentId } = req.body || {};
  if (name) f.name = name;
  if (parentId !== undefined) f.parentId = parentId;
  f.updatedAt = Date.now();
  await writeMeta(meta);
  await logActivity("renamed", f.name);
  res.json(f);
});

app.delete("/api/folders/:id", requireAuth, async (req, res) => {
  try {
    const meta = await readMeta();

    const folder = meta.folders.find(
      (x) => x.id === req.params.id
    );

    if (!folder) {
      return res.status(404).json({
        error: "Folder not found"
      });
    }

    const permanent =
      req.query.permanent === "true";

    // ==========================================
    // MOVE FOLDER TO TRASH
    // ==========================================

    if (!permanent) {
      folder.trashed = true;
      folder.updatedAt = Date.now();

      await writeMeta(meta);
      await logActivity(
        "moved to trash",
        folder.name
      );

      return res.json({
        ok: true,
        trashed: true
      });
    }

    // ==========================================
    // PERMANENT DELETE
    // ==========================================

    // Find this folder and all child folders
    const foldersToDelete = new Set([
      req.params.id
    ]);

    let changed = true;

    while (changed) {
      changed = false;

      for (const childFolder of meta.folders) {
        if (
          foldersToDelete.has(childFolder.parentId) &&
          !foldersToDelete.has(childFolder.id)
        ) {
          foldersToDelete.add(childFolder.id);
          changed = true;
        }
      }
    }

    // Find all files inside those folders
    const filesToDelete = meta.files.filter(
      (file) =>
        foldersToDelete.has(file.folderId)
    );

    // Delete actual files from IDrive
    for (const file of filesToDelete) {
      const storageKey =
        file.storageKey || file.storedName;

      if (!storageKey) {
        continue;
      }

      try {
        await deleteFile(storageKey);

        console.log(
          `Deleted from IDrive: ${storageKey}`
        );
      } catch (storageError) {
        console.error(
          `Failed to delete ${storageKey}:`,
          storageError
        );

        return res.status(500).json({
          error: "Could not delete file from IDrive",
          message: storageError.message
        });
      }
    }

    // Remove files from metadata
    meta.files = meta.files.filter(
      (file) =>
        !foldersToDelete.has(file.folderId)
    );

    // Remove folders from metadata
    meta.folders = meta.folders.filter(
      (folderItem) =>
        !foldersToDelete.has(folderItem.id)
    );

    await writeMeta(meta);

    await logActivity(
      "deleted",
      folder.name
    );

    res.json({
      ok: true,
      deleted: true
    });

  } catch (error) {
    console.error(
      "Folder delete error:",
      error
    );

    res.status(500).json({
      error: "Folder delete failed",
      message: error.message
    });
  }
});

app.post("/api/folders/:id/favorite", requireAuth, async (req, res) => {
  const meta = await readMeta();
  const f = meta.folders.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "Folder not found" });
  f.favorite = !f.favorite;
  f.updatedAt = Date.now();
  await writeMeta(meta);
  res.json(f);
});

// Folder download as ZIP
app.get("/api/folders/:id/download", requireAuth, async (req, res) => {
  try {
    const meta = await readMeta();

    const folder = meta.folders.find(
      (x) => x.id === req.params.id
    );

    if (!folder) {
      return res.status(404).json({
        error: "Folder not found"
      });
    }

    res.setHeader(
      "Content-Type",
      "application/zip"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${folder.name}.zip"`
    );

    const archive = archiver("zip", {
      zlib: { level: 5 }
    });

    archive.on("error", (error) => {
      console.error(
        "Folder ZIP error:",
        error
      );

      if (!res.headersSent) {
        res.status(500).json({
          error: "Folder ZIP creation failed",
          message: error.message
        });
      }
    });

    archive.pipe(res);

    // ==========================================
    // Collect folders and files recursively
    // ==========================================

    const collect = async (parentId, base) => {

      // Find child folders
      for (const childFolder of meta.folders) {

        if (
          childFolder.parentId === parentId &&
          !childFolder.trashed
        ) {

          await collect(
            childFolder.id,
            path.join(base, childFolder.name)
          );
        }
      }

      // Find files inside this folder
      for (const file of meta.files) {

        if (
          file.folderId === parentId &&
          !file.trashed
        ) {

          const storageKey =
            file.storageKey || file.storedName;

          if (!storageKey) {
            continue;
          }

          try {
            // Get file from IDrive
            const object = await getFile(
              storageKey
            );

            if (!object.Body) {
              continue;
            }

            // Add IDrive stream directly to ZIP
            archive.append(
              object.Body,
              {
                name: path.join(
                  base,
                  file.name
                )
              }
            );

          } catch (error) {

            console.error(
              `Failed to get ${storageKey} from IDrive:`,
              error
            );

          }
        }
      }
    };

    await collect(
      folder.id,
      folder.name
    );

    await archive.finalize();

  } catch (error) {

    console.error(
      "Folder download error:",
      error
    );

    if (!res.headersSent) {
      res.status(500).json({
        error: "Folder download failed",
        message: error.message
      });
    }
  }
});

// ===============================
// SEARCH
// ===============================
app.get("/api/search", requireAuth, async (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  const type = req.query.type || "all";
  if (!q) return res.json({ files: [], folders: [] });
  const meta = await readMeta();
  const typeMap = {
    documents: [
      "doc",
      "docx",
      "txt",
      "rtf",
      "odt",
      "ppt",
      "pptx",
      "odp",
      "xls",
      "xlsx",
      "csv",
      "ods",
      "pdf",
    ],
    pdf: ["pdf"],
    images: ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"],
    videos: ["mp4", "webm", "mov", "mkv"],
    audio: ["mp3", "wav", "m4a", "ogg"],
    archives: ["zip", "rar", "7z", "tar", "gz"],
  };
  let files = meta.files.filter(
    (f) => !f.trashed && f.name.toLowerCase().includes(q),
  );
  if (type !== "all" && typeMap[type])
    files = files.filter((f) => typeMap[type].includes(f.ext));
  const folders = meta.folders.filter(
    (f) => !f.trashed && f.name.toLowerCase().includes(q),
  );
  res.json({ files, folders });
});

// ===============================
// FAVORITES
// ===============================
app.get("/api/favorites", requireAuth, async (req, res) => {
  const meta = await readMeta();
  res.json({
    files: meta.files.filter((f) => f.favorite && !f.trashed),
    folders: meta.folders.filter((f) => f.favorite && !f.trashed),
  });
});

// ===============================
// TRASH
// ===============================
app.get("/api/trash", requireAuth, async (req, res) => {
  const meta = await readMeta();
  res.json({
    files: meta.files.filter((f) => f.trashed),
    folders: meta.folders.filter((f) => f.trashed),
  });
});

app.post("/api/trash/:id/restore", requireAuth, async (req, res) => {
  try {
    const meta = await readMeta();

    // ==========================================
    // RESTORE FILE
    // ==========================================

    const file = meta.files.find(
      (x) => x.id === req.params.id
    );

    if (file) {
      // Make sure the actual file still exists in IDrive
      const storageKey =
        file.storageKey || file.storedName;

      if (!storageKey) {
        return res.status(400).json({
          error: "File storage location not found"
        });
      }

      const exists = await fileExists(storageKey);

      if (!exists) {
        return res.status(404).json({
          error: "File no longer exists in IDrive"
        });
      }

      file.trashed = false;
      file.updatedAt = Date.now();

      await logActivity(
        "restored",
        file.name
      );

      await writeMeta(meta);

      return res.json({
        ok: true,
        restored: true,
        type: "file",
        file
      });
    }

    // ==========================================
    // RESTORE FOLDER
    // ==========================================

    const folder = meta.folders.find(
      (x) => x.id === req.params.id
    );

    if (folder) {
      // Restore the selected folder
      folder.trashed = false;
      folder.updatedAt = Date.now();

      await logActivity(
        "restored",
        folder.name
      );

      await writeMeta(meta);

      return res.json({
        ok: true,
        restored: true,
        type: "folder",
        folder
      });
    }

    // ==========================================
    // NOT FOUND
    // ==========================================

    return res.status(404).json({
      error: "File or folder not found"
    });

  } catch (error) {
    console.error(
      "Restore error:",
      error
    );

    return res.status(500).json({
      error: "Restore failed",
      message: error.message
    });
  }
});

app.delete("/api/trash/:id/permanent", requireAuth, async (req, res) => {
  try {
    const meta = await readMeta();

    // ==========================================
    // PERMANENT DELETE — FILE
    // ==========================================

    const file = meta.files.find(
      (x) => x.id === req.params.id
    );

    if (file) {
      const storageKey =
        file.storageKey || file.storedName;

      if (!storageKey) {
        return res.status(400).json({
          error: "File storage location not found"
        });
      }

      try {
        // Delete actual file from IDrive e2
        await deleteFile(storageKey);

        console.log(
          `Deleted from IDrive: ${storageKey}`
        );
      } catch (storageError) {
        console.error(
          "IDrive permanent delete error:",
          storageError
        );

        return res.status(500).json({
          error: "Could not delete file from IDrive",
          message: storageError.message
        });
      }

      // Remove file from metadata
      meta.files = meta.files.filter(
        (x) => x.id !== req.params.id
      );

      await writeMeta(meta);

      await logActivity(
        "deleted",
        file.name
      );

      return res.json({
        ok: true,
        deleted: true
      });
    }

    // ==========================================
    // PERMANENT DELETE — FOLDER
    // ==========================================

    const folder = meta.folders.find(
      (x) => x.id === req.params.id
    );

    if (folder) {
      // Find this folder and all child folders
      const foldersToDelete = new Set([
        req.params.id
      ]);

      let changed = true;

      while (changed) {
        changed = false;

        for (const childFolder of meta.folders) {
          if (
            foldersToDelete.has(childFolder.parentId) &&
            !foldersToDelete.has(childFolder.id)
          ) {
            foldersToDelete.add(childFolder.id);
            changed = true;
          }
        }
      }

      // Find all files inside these folders
      const filesToDelete = meta.files.filter(
        (file) =>
          foldersToDelete.has(file.folderId)
      );

      // Delete every actual file from IDrive
      for (const file of filesToDelete) {
        const storageKey =
          file.storageKey || file.storedName;

        if (!storageKey) {
          continue;
        }

        try {
          await deleteFile(storageKey);

          console.log(
            `Deleted from IDrive: ${storageKey}`
          );
        } catch (storageError) {
          console.error(
            `Failed to delete ${storageKey}:`,
            storageError
          );

          return res.status(500).json({
            error: "Could not delete folder files from IDrive",
            message: storageError.message
          });
        }
      }

      // Remove files from metadata
      meta.files = meta.files.filter(
        (file) =>
          !foldersToDelete.has(file.folderId)
      );

      // Remove folders from metadata
      meta.folders = meta.folders.filter(
        (folderItem) =>
          !foldersToDelete.has(folderItem.id)
      );

      await writeMeta(meta);

      await logActivity(
        "deleted",
        folder.name
      );

      return res.json({
        ok: true,
        deleted: true
      });
    }

    // Nothing found
    return res.status(404).json({
      error: "File or folder not found"
    });

  } catch (error) {
    console.error(
      "Permanent trash delete error:",
      error
    );

    return res.status(500).json({
      error: "Permanent delete failed",
      message: error.message
    });
  }
});

app.delete("/api/trash", requireAuth, async (req, res) => {
  try {
    const meta = await readMeta();

    const trashedFiles = meta.files.filter(
      (x) => x.trashed
    );

    // Delete actual files from IDrive
    for (const file of trashedFiles) {
      const storageKey =
        file.storageKey || file.storedName;

      if (!storageKey) continue;

      try {
        await deleteFile(storageKey);

        console.log(
          `Deleted from IDrive: ${storageKey}`
        );
      } catch (error) {
        console.error(
          `Failed to delete ${storageKey}:`,
          error
        );

        return res.status(500).json({
          error: "Could not empty Trash",
          message: error.message
        });
      }
    }

    // Remove deleted files/folders from metadata
    meta.files = meta.files.filter(
      (x) => !x.trashed
    );

    meta.folders = meta.folders.filter(
      (x) => !x.trashed
    );

    await writeMeta(meta);

    await logActivity(
      "emptied",
      "Trash"
    );

    res.json({
      ok: true
    });

  } catch (error) {
    console.error(
      "Empty Trash error:",
      error
    );

    res.status(500).json({
      error: "Empty Trash failed",
      message: error.message
    });
  }
});

// ===============================
// SHARING
// ===============================
app.post("/api/share", requireAuth, async (req, res) => {
  const meta = await readMeta();
  const { fileId, expiresInHours, password } = req.body || {};
  const f = meta.files.find((x) => x.id === fileId);
  if (!f || f.trashed) return res.status(404).json({ error: "File not found" });
  const token = crypto.randomBytes(16).toString("hex");
  const hours = parseInt(expiresInHours, 10) || 24;
  const link = {
    token,
    fileId,
    fileName: f.name,
    expires: Date.now() + hours * 3600 * 1000,
    password: password || null,
  };
  if (!meta.shareLinks) meta.shareLinks = [];
  meta.shareLinks.push(link);
  await writeMeta(meta);
  await logActivity("shared", f.name);
  res.json(link);
});

app.get("/api/share/:token", async (req, res) => {
  const meta = await readMeta();
  const link = (meta.shareLinks || []).find(
    (x) => x.token === req.params.token,
  );
  if (!link) return res.status(404).json({ error: "Link not found" });
  if (Date.now() > link.expires)
    return res.status(410).json({ error: "Link expired" });
  if (link.password && req.query.password !== link.password) {
    return res
      .status(401)
      .json({ error: "Password required", needPassword: true });
  }
  const f = meta.files.find((x) => x.id === link.fileId);
  if (!f) return res.status(404).json({ error: "File not found" });
  res.json({ name: f.name, size: f.size, ext: f.ext });
});

app.get("/api/share/:token/download", async (req, res) => {
  const meta = await readMeta();
  const link = (meta.shareLinks || []).find(
    (x) => x.token === req.params.token,
  );
  if (!link) return res.status(404).json({ error: "Link not found" });
  if (Date.now() > link.expires)
    return res.status(410).json({ error: "Link expired" });
  if (link.password && req.query.password !== link.password) {
    return res.status(401).json({ error: "Password required" });
  }
  const f = meta.files.find((x) => x.id === link.fileId);
  if (!f) return res.status(404).json({ error: "File not found" });
  res.download(path.join(FILES_DIR, f.storedName), f.name);
});

app.delete("/api/share/:token", requireAuth, async (req, res) => {
  const meta = await readMeta();
  if (!meta.shareLinks) return res.json({ ok: true });
  meta.shareLinks = meta.shareLinks.filter((x) => x.token !== req.params.token);
  await writeMeta(meta);
  res.json({ ok: true });
});

app.get("/api/share", requireAuth, async (req, res) => {
  const meta = await readMeta();
  res.json(meta.shareLinks || []);
});

// ===============================
// STORAGE
// ===============================
app.get("/api/storage", requireAuth, async (req, res) => {
  const meta = await readMeta();
  let used = 0;
  const breakdown = {};
  for (const f of meta.files.filter((x) => !x.trashed)) {
    used += f.size;
    const cat = categorize(f.ext);
    breakdown[cat] = (breakdown[cat] || 0) + f.size;
  }
  res.json({ used, limit: STORAGE_LIMIT, breakdown });
});

function categorize(ext) {
  if (
    [
      "doc",
      "docx",
      "txt",
      "rtf",
      "odt",
      "ppt",
      "pptx",
      "odp",
      "xls",
      "xlsx",
      "csv",
      "ods",
      "pdf",
    ].includes(ext)
  )
    return "documents";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext))
    return "images";
  if (["mp4", "webm", "mov", "mkv"].includes(ext)) return "videos";
  if (["mp3", "wav", "m4a", "ogg"].includes(ext)) return "audio";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archives";
  return "other";
}

// ===============================
// STATS & ACTIVITY
// ===============================
app.get("/api/stats", requireAuth, async (req, res) => {
  const meta = await readMeta();
  const activity = await readActivity();
  const files = meta.files.filter((f) => !f.trashed);
  const used = files.reduce((s, f) => s + f.size, 0);
  res.json({
    files: files.length,
    folders: meta.folders.filter((f) => !f.trashed).length,
    favorites:
      files.filter((f) => f.favorite).length +
      meta.folders.filter((f) => f.favorite && !f.trashed).length,
    storage: used,
    storageLimit: STORAGE_LIMIT,
    recent: Math.min(20, files.length),
    activity: activity.length,
  });
});

app.get("/api/activity", requireAuth, async (req, res) => {
  const activity = await readActivity();
  res.json(activity.slice(0, 50));
});

// ===============================
// HEALTH CHECK
// ===============================
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", server: true });
});

// ===============================
// STATIC FILE SERVING
// ===============================
app.use(
  express.static(__dirname, {
    extensions: ["html"],
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".css")) res.setHeader("Content-Type", "text/css");
      if (filePath.endsWith(".js"))
        res.setHeader("Content-Type", "application/javascript");
    },
  }),
);

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "index.html"));
});

// ===============================
// SERVER START
// ===============================
app.listen(PORT, () => {
  console.log(`MyVault running on http://localhost:${PORT}`);
});

module.exports = app;
