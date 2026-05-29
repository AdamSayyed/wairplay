/* ====================================
   WairPlay Extension — Offscreen Script
   Runs Socket.IO, WebRTC, and file transfers in a DOM context.
   ==================================== */

(function () {
  "use strict";

  var SERVER_URL = "http://localhost:3000";

  // State
  var state = {
    status: "waiting",
    statusText: "Disconnected",
    myDevice: { name: "", type: "desktop", id: "" },
    nearbyDevices: [],
    activeTransfer: null,
    history: []
  };

  var socket = null;
  var activePeer = null;
  var activeChannel = null;
  var targetSocketId = null;
  var pendingFiles = null;
  var pendingRequest = null;

  // Load history from storage on start
  chrome.storage.local.get(["wairplay_history", "deviceName", "deviceId"], function (res) {
    if (res.wairplay_history) {
      state.history = res.wairplay_history;
    }
    
    // Get/Generate Device ID
    if (res.deviceId) {
      state.myDevice.id = res.deviceId;
    } else {
      state.myDevice.id = generateUUID();
      chrome.storage.local.set({ deviceId: state.myDevice.id });
    }

    // Get Device Name
    if (res.deviceName) {
      state.myDevice.name = res.deviceName;
    } else {
      state.myDevice.name = "Chrome Extension";
      chrome.storage.local.set({ deviceName: state.myDevice.name });
    }

    connectSocket();
  });

  /* ====================================
     SOCKET.IO CONNECTION
     ==================================== */

  function connectSocket() {
    socket = io(SERVER_URL);

    socket.on("connect", function () {
      console.log("[Offscreen] Connected to server:", socket.id);
      setStatus("connected", "Connected to server");

      // Register device
      socket.emit("register-device", {
        deviceName: state.myDevice.name,
        deviceType: state.myDevice.type,
        deviceId: state.myDevice.id
      });
    });

    socket.on("disconnect", function () {
      console.log("[Offscreen] Disconnected from server");
      setStatus("error", "Server offline");
      state.nearbyDevices = [];
      broadcastState();
    });

    socket.on("connect_error", function (err) {
      console.error("[Offscreen] Socket.IO connection error:", err.message);
      setStatus("error", "Cannot reach server");
      broadcastState();
    });

    socket.on("device-list", function (devices) {
      console.log("[Offscreen] Nearby devices:", devices.length);
      state.nearbyDevices = devices;
      broadcastState();
    });

    // Signaling
    socket.on("signal", function (msg) {
      handleSignal(msg);
    });

    // File request (receiver side)
    socket.on("file-request", function (data) {
      console.log("[Offscreen] Incoming file request from:", data.senderName);
      pendingRequest = data;

      // Ask background.js to show system notification
      chrome.runtime.sendMessage({
        type: "show-request-notification",
        senderId: data.from,
        senderName: data.senderName,
        files: data.files
      });
    });

    // File accepted (sender side)
    socket.on("file-accepted", function (data) {
      console.log("[Offscreen] File accepted by receiver:", data.from);
      startSenderPeerConnection(data.from);
    });

    // File rejected (sender side)
    socket.on("file-rejected", function (data) {
      console.log("[Offscreen] File rejected by receiver");
      setStatus("waiting", "Transfer declined");
      state.activeTransfer = null;
      broadcastState();
    });

    // Heartbeat
    setInterval(function () {
      if (socket && socket.connected) {
        socket.emit("heartbeat");
      }
    }, 15000);
  }

  /* ====================================
     MESSAGE PASSING & STATE SYNC
     ==================================== */

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.type === "query-state") {
      sendResponse(state);
      return;
    }

    if (message.type === "rename-device") {
      state.myDevice.name = message.name;
      chrome.storage.local.set({ deviceName: message.name });
      if (socket && socket.connected) {
        socket.emit("register-device", {
          deviceName: state.myDevice.name,
          deviceType: state.myDevice.type,
          deviceId: state.myDevice.id
        });
      }
      broadcastState();
      sendResponse({ status: "ok" });
      return;
    }

    if (message.type === "send-files-request") {
      // Send a file transfer request to target device
      targetSocketId = message.targetSocketId;
      pendingFiles = message.files; // File metadata list from popup

      // Show transfer overlay state
      setStatus("transferring", "Waiting for acceptance...");
      state.activeTransfer = {
        name: message.files.length === 1 ? message.files[0].name : message.files.length + " files",
        size: message.files.reduce(function (acc, f) { return acc + f.size; }, 0),
        type: message.files.length === 1 ? message.files[0].type : "",
        percent: 0,
        direction: "send"
      };
      broadcastState();

      socket.emit("send-file-request", {
        targetSocketId: targetSocketId,
        files: message.files,
        senderName: state.myDevice.name
      });
      sendResponse({ status: "ok" });
      return;
    }

    // Handles user response from system notifications (background.js)
    if (message.type === "notification-response") {
      if (message.action === "accept") {
        acceptTransfer(message.senderId, message.files);
      } else {
        declineTransfer(message.senderId);
      }
      return;
    }

    if (message.type === "cancel-transfer") {
      cleanupPeer();
      setStatus("waiting", "Ready");
      state.activeTransfer = null;
      broadcastState();
      return;
    }
  });

  function broadcastState() {
    chrome.runtime.sendMessage({
      type: "state-update",
      state: state
    }, function () {
      // Suppress "Could not establish connection" when no listener (popup closed)
      if (chrome.runtime.lastError) { /* ignored */ }
    });
  }

  function setStatus(status, text) {
    state.status = status;
    state.statusText = text;
    broadcastState();
  }

  /* ====================================
     RECEIVER ACTIONS
     ==================================== */

  function acceptTransfer(senderId, files) {
    socket.emit("accept-file", { targetSocketId: senderId });

    setStatus("transferring", "Receiving...");
    state.activeTransfer = {
      name: files.length === 1 ? files[0].name : files.length + " files",
      size: files.reduce(function (acc, f) { return acc + f.size; }, 0),
      type: files.length === 1 ? files[0].type : "",
      percent: 0,
      direction: "receive"
    };
    broadcastState();

    startReceiverPeerConnection(senderId);
  }

  function declineTransfer(senderId) {
    socket.emit("reject-file", { targetSocketId: senderId });
    pendingRequest = null;
  }

  /* ====================================
     WEBRTC SENDER
     ==================================== */

  function startSenderPeerConnection(targetId) {
    setStatus("transferring", "Connecting...");
    activePeer = new WairPlayPeer();

    activePeer.onIceCandidate(function (candidate) {
      socket.emit("signal", {
        targetSocketId: targetId,
        data: { type: "ice-candidate", candidate: candidate }
      });
    });

    activePeer.onConnectionStateChange(function (connState) {
      console.log("[Offscreen] Sender peer connection state:", connState);
      if (connState === "failed") {
        setStatus("error", "Connection failed");
        state.activeTransfer = null;
        cleanupPeer();
      }
    });

    activeChannel = activePeer.createDataChannel("files");

    activeChannel.onopen = function () {
      console.log("[Offscreen] Sender data channel open");
      setStatus("transferring", "Sending...");

      // Ask popup to send raw file data if popup is active, otherwise error out.
      // Because background threads can't read files directly without a file picker upload in popup.
      // So popup reads files and sends ArrayBuffers to offscreen to send.
      var bufferTimeout = setTimeout(function () {
        console.error("[Offscreen] Timed out waiting for file buffers from popup");
        setStatus("error", "Popup closed — cannot read files");
        state.activeTransfer = null;
        cleanupPeer();
        broadcastState();
      }, 10000);

      chrome.runtime.sendMessage({
        type: "request-file-buffers"
      }, function (response) {
        clearTimeout(bufferTimeout);

        // Handle popup being closed (chrome.runtime.lastError)
        if (chrome.runtime.lastError) {
          console.error("[Offscreen] File buffer request failed:", chrome.runtime.lastError.message);
          setStatus("error", "Popup closed — keep popup open while sending");
          state.activeTransfer = null;
          cleanupPeer();
          broadcastState();
          return;
        }

        if (!response || !response.buffers) {
          console.error("[Offscreen] Failed to read files from popup");
          setStatus("error", "Failed to read files");
          state.activeTransfer = null;
          cleanupPeer();
          broadcastState();
          return;
        }

        // Map response array buffers to file objects
        var fileList = response.buffers.map(function (buf, idx) {
          return {
            name: pendingFiles[idx].name,
            size: pendingFiles[idx].size,
            type: pendingFiles[idx].type,
            slice: function (offset, end) {
              return new Blob([buf.slice(offset, end)]);
            }
          };
        });

        WairPlayTransfer.sendFiles(activeChannel, fileList, function (percent) {
          if (state.activeTransfer) {
            state.activeTransfer.percent = percent;
            broadcastState();
          }
        }, function () {
          // Completed sending
          setStatus("complete", "Sent successfully!");
          addToHistory(state.activeTransfer.name, state.activeTransfer.size, "send");
          setTimeout(function () {
            state.activeTransfer = null;
            setStatus("waiting", "Ready");
            cleanupPeer();
          }, 1500);
        }, function (err) {
          setStatus("error", "Transfer failed: " + err);
          state.activeTransfer = null;
          cleanupPeer();
        });
      });
    };

    activePeer.createOffer().then(function (offer) {
      socket.emit("signal", {
        targetSocketId: targetId,
        data: { type: "offer", sdp: offer }
      });
    });
  }

  /* ====================================
     WEBRTC RECEIVER
     ==================================== */

  function startReceiverPeerConnection(senderId) {
    activePeer = new WairPlayPeer();

    activePeer.onIceCandidate(function (candidate) {
      socket.emit("signal", {
        targetSocketId: senderId,
        data: { type: "ice-candidate", candidate: candidate }
      });
    });

    activePeer.onConnectionStateChange(function (connState) {
      console.log("[Offscreen] Receiver peer connection state:", connState);
      if (connState === "failed") {
        setStatus("error", "Connection failed");
        state.activeTransfer = null;
        cleanupPeer();
      }
    });

    activePeer.onDataChannel(function (channel) {
      console.log("[Offscreen] Receiver data channel active");
      activeChannel = channel;

      WairPlayTransfer.receiveFiles(channel, function (file) {
        // Single file received -> trigger download
        triggerDownload(file.blob, file.name);
      }, function (percent) {
        if (state.activeTransfer) {
          state.activeTransfer.percent = percent;
          broadcastState();
        }
      }, function () {
        // Complete transfer
        setStatus("complete", "Received successfully!");
        addToHistory(state.activeTransfer.name, state.activeTransfer.size, "receive");
        setTimeout(function () {
          state.activeTransfer = null;
          setStatus("waiting", "Ready");
          cleanupPeer();
          pendingRequest = null;
        }, 1500);
      });
    });
  }

  /* ====================================
     SIGNALING RELAY HANDLER
     ==================================== */

  function handleSignal(msg) {
    var data = msg.data;
    var from = msg.from;

    if (data.type === "offer") {
      if (!activePeer) return;
      activePeer.handleOffer(data.sdp).then(function (answer) {
        socket.emit("signal", {
          targetSocketId: from,
          data: { type: "answer", sdp: answer }
        });
      });
    } else if (data.type === "answer") {
      if (activePeer) {
        activePeer.handleAnswer(data.sdp);
      }
    } else if (data.type === "ice-candidate") {
      if (activePeer) {
        activePeer.addIceCandidate(data.candidate);
      }
    }
  }

  /* ====================================
     CLEANUP & DOWNLOAD
     ==================================== */

  function cleanupPeer() {
    if (activeChannel) {
      try { activeChannel.close(); } catch (e) {}
      activeChannel = null;
    }
    if (activePeer) {
      activePeer.close();
      activePeer = null;
    }
    pendingFiles = null;
    targetSocketId = null;
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false // Download silently into the user's default downloads folder
    }, function () {
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 15000);
    });
  }

  function addToHistory(name, size, direction) {
    state.history.unshift({
      name: name,
      size: size,
      direction: direction,
      timestamp: Date.now()
    });

    // Limit history length to 10
    if (state.history.length > 10) {
      state.history.pop();
    }

    chrome.storage.local.set({ wairplay_history: state.history });
    broadcastState();
  }

  /* ====================================
     UTILS
     ==================================== */

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0,
          v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

})();
