const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static("public"));

/* ====================================
   DEVICE PRESENCE SYSTEM
   ==================================== */

const devices = new Map(); // socketId → { socketId, deviceName, deviceType, publicIP, lastSeen }

function isPrivateIP(ip) {
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("fe80:")) {
    return true;
  }
  var parts = ip.split(".");
  if (parts.length === 4) {
    var first = parseInt(parts[0], 10);
    var second = parseInt(parts[1], 10);
    if (first === 10) return true;
    if (first === 172 && (second >= 16 && second <= 31)) return true;
    if (first === 192 && second === 168) return true;
  }
  return false;
}

function getPublicIP(socket) {
  var forwarded = socket.handshake.headers["x-forwarded-for"];
  var addr = forwarded ? forwarded.split(",")[0].trim() : socket.handshake.address;

  // Normalize IPv6 localhost to IPv4
  if (addr === "::1" || addr === "::ffff:127.0.0.1") addr = "127.0.0.1";
  // Strip ::ffff: prefix from IPv4-mapped IPv6
  if (addr && addr.startsWith("::ffff:")) addr = addr.slice(7);

  // Group all local/private LAN traffic together for development
  if (isPrivateIP(addr)) {
    return "local";
  }
  return addr;
}

function getNearbyDevices(publicIP, excludeSocketId) {
  var nearby = [];
  devices.forEach(function (device) {
    if (device.publicIP === publicIP && device.socketId !== excludeSocketId) {
      nearby.push({
        socketId: device.socketId,
        deviceName: device.deviceName,
        deviceType: device.deviceType
      });
    }
  });
  return nearby;
}

function broadcastDeviceList(publicIP) {
  devices.forEach(function (device) {
    if (device.publicIP === publicIP) {
      var nearby = getNearbyDevices(publicIP, device.socketId);
      io.to(device.socketId).emit("device-list", nearby);
    }
  });
}

/* ====================================
   STALE DEVICE CLEANUP (every 30s)
   ==================================== */

setInterval(function () {
  var now = Date.now();
  var staleIPs = new Set();

  devices.forEach(function (device, socketId) {
    if (now - device.lastSeen > 45000) {
      console.log("[PRESENCE] Pruned stale device:", device.deviceName, socketId);
      staleIPs.add(device.publicIP);
      devices.delete(socketId);
    }
  });

  // Re-broadcast for affected IPs
  staleIPs.forEach(function (ip) {
    broadcastDeviceList(ip);
  });
}, 30000);

/* ====================================
   SOCKET.IO CONNECTION HANDLER
   ==================================== */

io.on("connection", (socket) => {
  console.log("[SOCKET] Connected:", socket.id);

  /* --- Device Registration --- */
  socket.on("register-device", (data) => {
    var publicIP = getPublicIP(socket);

    var device = {
      socketId: socket.id,
      deviceName: data.deviceName || "Unknown Device",
      deviceType: data.deviceType || "desktop",
      publicIP: publicIP,
      lastSeen: Date.now()
    };

    devices.set(socket.id, device);
    console.log("[PRESENCE] Registered:", device.deviceName, "(" + device.deviceType + ") IP:", publicIP);

    // Broadcast updated device list to all devices on same network
    broadcastDeviceList(publicIP);
  });

  /* --- Heartbeat --- */
  socket.on("heartbeat", () => {
    var device = devices.get(socket.id);
    if (device) {
      device.lastSeen = Date.now();
    }
  });

  /* ====================================
     WEBRTC SIGNALING RELAY
     ==================================== */

  /* --- Relay WebRTC signal (SDP offer/answer, ICE candidates) --- */
  socket.on("signal", (data) => {
    if (data.targetSocketId) {
      io.to(data.targetSocketId).emit("signal", {
        from: socket.id,
        data: data.data
      });
    }
  });

  /* --- File transfer request: sender → receiver --- */
  socket.on("send-file-request", (data) => {
    var senderDevice = devices.get(socket.id);
    var senderName = senderDevice ? senderDevice.deviceName : "Unknown";

    console.log("[SIGNAL] File request from", senderName, "→", data.targetSocketId);

    io.to(data.targetSocketId).emit("file-request", {
      from: socket.id,
      senderName: senderName,
      files: data.files
    });
  });

  /* --- File accepted: receiver → sender --- */
  socket.on("accept-file", (data) => {
    console.log("[SIGNAL] File accepted by", socket.id, "→", data.targetSocketId);
    io.to(data.targetSocketId).emit("file-accepted", {
      from: socket.id
    });
  });

  /* --- File rejected: receiver → sender --- */
  socket.on("reject-file", (data) => {
    console.log("[SIGNAL] File rejected by", socket.id, "→", data.targetSocketId);
    io.to(data.targetSocketId).emit("file-rejected", {
      from: socket.id
    });
  });

  /* --- Disconnect --- */
  socket.on("disconnect", () => {
    var device = devices.get(socket.id);
    if (device) {
      var publicIP = device.publicIP;
      console.log("[PRESENCE] Removed:", device.deviceName, socket.id);
      devices.delete(socket.id);
      broadcastDeviceList(publicIP);
    }
    console.log("[SOCKET] Disconnected:", socket.id);
  });
});

/* ====================================
   START SERVER
   ==================================== */

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("  ╔══════════════════════════════════════════════╗");
  console.log("  ║         ✈  WairPlay P2P is running           ║");
  console.log("  ╠══════════════════════════════════════════════╣");
  console.log("  ║  Port: " + String(PORT).padEnd(38) + "║");
  console.log("  ║                                              ║");
  console.log("  ║  Open in browser → discover nearby devices   ║");
  console.log("  ║  Click a device → send files P2P             ║");
  console.log("  ╚══════════════════════════════════════════════╝");
  console.log("");
});
