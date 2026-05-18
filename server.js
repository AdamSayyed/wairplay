const express = require("express");
const multer = require("multer");
const QRCode = require("qrcode");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* ====================================
   TEMP UPLOADS DIRECTORY
   ==================================== */

const UPLOADS_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/* ====================================
   MULTER CONFIG
   ==================================== */

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    var sessionDir = path.join(UPLOADS_DIR, req.params.sessionId || "orphan");
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    cb(null, sessionDir);
  },
  filename: function (req, file, cb) {
    var unique = Date.now() + "-" + file.originalname;
    cb(null, unique);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

/* ====================================
   SESSION MANAGEMENT
   ==================================== */

var sessions = new Map();

var SESSION_TTL = 30 * 60 * 1000;

function createSession() {
  var sessionId = uuidv4().slice(0, 8);

  sessions.set(sessionId, {
    id: sessionId,
    created: Date.now(),
    files: [],
    sseClients: [],
    senderConnected: false
  });

  return sessionId;
}

function getSession(sessionId) {
  var session = sessions.get(sessionId);
  if (!session) return null;

  if (Date.now() - session.created > SESSION_TTL) {
    cleanupSession(sessionId);
    return null;
  }

  return session;
}

function cleanupSession(sessionId) {
  var session = sessions.get(sessionId);
  if (session) {
    session.sseClients.forEach(function (res) {
      try { res.end(); } catch (e) {}
    });

    var sessionDir = path.join(UPLOADS_DIR, sessionId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }

    sessions.delete(sessionId);
  }
}

setInterval(function () {
  var now = Date.now();
  sessions.forEach(function (session, id) {
    if (now - session.created > SESSION_TTL) {
      console.log("[CLEANUP] Session expired:", id);
      cleanupSession(id);
    }
  });
}, 5 * 60 * 1000);

/* ====================================
   BROADCAST TO SESSION SSE CLIENTS
   ==================================== */

function broadcast(sessionId, event, data) {
  var session = sessions.get(sessionId);
  if (!session) return;

  var msg = "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
  session.sseClients.forEach(function (res) {
    try { res.write(msg); } catch (e) {}
  });
}

/* ====================================
   API: CREATE SESSION (PC opens this)
   ==================================== */

app.post("/api/session", function (req, res) {
  var sessionId = createSession();
  console.log("[SESSION] Created:", sessionId);

  res.json({
    sessionId: sessionId
  });
});

/* ====================================
   API: GET SESSION QR CODE
   ==================================== */

app.get("/api/session/:sessionId/qr", async function (req, res) {
  var session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session expired" });
    return;
  }

  var protocol = req.headers["x-forwarded-proto"] || req.protocol;
  var host = req.headers.host;
  var baseUrl = protocol + "://" + host;
  var sendUrl = baseUrl + "/send.html?session=" + session.id;

  try {
    var qrCode = await QRCode.toDataURL(sendUrl, {
      width: 300,
      margin: 2,
      color: { dark: "#ffffff", light: "#00000000" }
    });

    res.json({
      qrCode: qrCode,
      sendUrl: sendUrl,
      sessionId: session.id
    });
  } catch (err) {
    res.status(500).json({ error: "QR generation failed" });
  }
});

/* ====================================
   API: SESSION STATUS
   ==================================== */

app.get("/api/session/:sessionId/status", function (req, res) {
  var session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session expired" });
    return;
  }

  res.json({
    sessionId: session.id,
    senderConnected: session.senderConnected,
    fileCount: session.files.length,
    files: session.files
  });
});

/* ====================================
   SSE: RECEIVER LISTENS FOR EVENTS
   ==================================== */

app.get("/api/session/:sessionId/events", function (req, res) {
  var session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session expired" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });

  res.write("event: connected\ndata: " + JSON.stringify({ sessionId: session.id }) + "\n\n");

  session.sseClients.push(res);

  req.on("close", function () {
    session.sseClients = session.sseClients.filter(function (client) {
      return client !== res;
    });
  });
});

/* ====================================
   API: SENDER JOINS SESSION
   ==================================== */

app.post("/api/session/:sessionId/join", function (req, res) {
  var session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found or expired. Scan QR again." });
    return;
  }

  session.senderConnected = true;
  broadcast(session.id, "sender-connected", { time: Date.now() });
  console.log("[PAIRED] Sender joined session:", session.id);

  res.json({ ok: true, sessionId: session.id });
});

/* ====================================
   API: UPLOAD FILE TO SESSION
   ==================================== */

app.post("/api/session/:sessionId/upload", upload.single("file"), function (req, res) {
  var session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session expired" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file received" });
    return;
  }

  var fileEntry = {
    id: uuidv4().slice(0, 8),
    name: req.file.originalname,
    savedAs: req.file.filename,
    size: req.file.size,
    type: req.file.mimetype,
    time: new Date().toISOString(),
    downloaded: false
  };

  session.files.push(fileEntry);

  broadcast(session.id, "file-received", fileEntry);

  console.log("=================================");
  console.log("FILE RECEIVED — Session:", session.id);
  console.log("Name:", fileEntry.name);
  console.log("Size:", formatSize(fileEntry.size));
  console.log("=================================");

  res.json({
    success: true,
    file: fileEntry
  });
});

/* ====================================
   API: DOWNLOAD FILE (PC pulls this)
   ==================================== */

app.get("/api/session/:sessionId/download/:fileId", function (req, res) {
  var session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session expired" });
    return;
  }

  var fileEntry = null;
  for (var i = 0; i < session.files.length; i++) {
    if (session.files[i].id === req.params.fileId) {
      fileEntry = session.files[i];
      break;
    }
  }

  if (!fileEntry) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  var filePath = path.join(UPLOADS_DIR, session.id, fileEntry.savedAs);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File no longer available" });
    return;
  }

  fileEntry.downloaded = true;

  res.download(filePath, fileEntry.name, function (err) {
    if (!err) {
      console.log("[DOWNLOADED]", fileEntry.name, "by session", session.id);
    }
  });
});

/* ====================================
   HELPER
   ==================================== */

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(2) + " GB";
}

/* ====================================
   START SERVER
   ==================================== */

app.listen(PORT, "0.0.0.0", function () {
  console.log("");
  console.log("  ╔══════════════════════════════════════════════╗");
  console.log("  ║           ✈  WairPlay is running             ║");
  console.log("  ╠══════════════════════════════════════════════╣");
  console.log("  ║  Port: " + String(PORT).padEnd(38) + "║");
  console.log("  ║                                              ║");
  console.log("  ║  Deploy to Render, then open in browser.     ║");
  console.log("  ║  Click 'New Session' → QR → scan → send!    ║");
  console.log("  ╚══════════════════════════════════════════════╝");
  console.log("");
});
