/* ====================================
   WairPlay — P2P File Transfer App
   Main client-side application
   ==================================== */

(function () {
  "use strict";

  /* --- DOM References --- */
  var myDeviceName = document.getElementById("myDeviceName");
  var radarCenterIcon = document.getElementById("radarCenterIcon");
  var radarCenterLabel = document.getElementById("radarCenterLabel");
  var deviceOrbit = document.getElementById("deviceOrbit");
  var emptyState = document.getElementById("emptyState");
  var fileInput = document.getElementById("fileInput");
  var transferOverlay = document.getElementById("transferOverlay");
  var transferIcon = document.getElementById("transferIcon");
  var transferTitle = document.getElementById("transferTitle");
  var transferFileIcon = document.getElementById("transferFileIcon");
  var transferFileName = document.getElementById("transferFileName");
  var transferFileSize = document.getElementById("transferFileSize");
  var transferProgressFill = document.getElementById("transferProgressFill");
  var transferProgressText = document.getElementById("transferProgressText");
  var transferCancelBtn = document.getElementById("transferCancelBtn");
  var requestOverlay = document.getElementById("requestOverlay");
  var requestTitle = document.getElementById("requestTitle");
  var requestFrom = document.getElementById("requestFrom");
  var requestFiles = document.getElementById("requestFiles");
  var requestAcceptBtn = document.getElementById("requestAcceptBtn");
  var requestDeclineBtn = document.getElementById("requestDeclineBtn");
  var successToast = document.getElementById("successToast");
  var successToastText = document.getElementById("successToastText");
  var errorToast = document.getElementById("errorToast");
  var errorToastText = document.getElementById("errorToastText");

  /* --- State --- */
  var socket = null;
  var myDevice = { name: "", type: "desktop" };
  var nearbyDevices = [];
  var targetSocketId = null;       // who we're sending to
  var pendingFiles = null;         // files selected to send
  var activePeer = null;           // active PeerConnection instance
  var activeChannel = null;        // active DataChannel
  var pendingRequest = null;       // incoming file request { from, files, senderName }

  /* ====================================
     DEVICE DETECTION
     ==================================== */

  function detectDevice() {
    var ua = navigator.userAgent;
    var name = "Unknown";
    var type = "desktop";

    if (/iPhone/i.test(ua)) {
      name = "iPhone";
      type = "mobile";
    } else if (/iPad/i.test(ua)) {
      name = "iPad";
      type = "tablet";
    } else if (/Android/i.test(ua)) {
      if (/Mobile/i.test(ua)) {
        name = "Android Phone";
        type = "mobile";
      } else {
        name = "Android Tablet";
        type = "tablet";
      }
    } else if (/Macintosh/i.test(ua)) {
      name = "Mac";
      type = "desktop";
    } else if (/Windows/i.test(ua)) {
      name = "Windows PC";
      type = "desktop";
    } else if (/Linux/i.test(ua)) {
      name = "Linux";
      type = "desktop";
    }

    return { name: name, type: type };
  }

  function getDeviceEmoji(type) {
    switch (type) {
      case "mobile": return "📱";
      case "tablet": return "📱";
      case "desktop": return "💻";
      default: return "🖥️";
    }
  }

  function getFileIcon(mimeType) {
    if (!mimeType) return "📄";
    if (mimeType.startsWith("image/")) return "🖼️";
    if (mimeType.startsWith("video/")) return "🎬";
    if (mimeType.startsWith("audio/")) return "🎵";
    if (mimeType.indexOf("pdf") !== -1) return "📕";
    if (mimeType.indexOf("zip") !== -1 || mimeType.indexOf("compressed") !== -1) return "📦";
    if (mimeType.indexOf("text") !== -1) return "📝";
    return "📄";
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
    return (bytes / 1073741824).toFixed(2) + " GB";
  }

  /* ====================================
     SOCKET.IO CONNECTION
     ==================================== */

  function connectSocket() {
    socket = io();

    socket.on("connect", function () {
      console.log("[WairPlay] Connected:", socket.id);

      myDevice = detectDevice();
      myDeviceName.textContent = myDevice.name;

      socket.emit("register-device", {
        deviceName: myDevice.name,
        deviceType: myDevice.type
      });

      radarCenterIcon.textContent = "📡";
      radarCenterLabel.textContent = "Looking for devices...";
    });

    socket.on("disconnect", function () {
      console.log("[WairPlay] Disconnected");
      radarCenterLabel.textContent = "Reconnecting...";
    });

    socket.on("device-list", function (devices) {
      console.log("[WairPlay] Nearby devices:", devices.length);
      nearbyDevices = devices;
      renderDevices();
    });

    /* --- Signaling --- */
    socket.on("signal", function (msg) {
      handleSignal(msg);
    });

    /* --- File request (receiver side) --- */
    socket.on("file-request", function (data) {
      showFileRequest(data);
    });

    /* --- File accepted (sender side) --- */
    socket.on("file-accepted", function (data) {
      console.log("[WairPlay] File accepted by:", data.from);
      startSenderPeerConnection(data.from);
    });

    /* --- File rejected (sender side) --- */
    socket.on("file-rejected", function (data) {
      console.log("[WairPlay] File rejected by:", data.from);
      hideTransferOverlay();
      showErrorToast("Transfer declined");
    });

    /* --- Heartbeat --- */
    setInterval(function () {
      if (socket && socket.connected) {
        socket.emit("heartbeat");
      }
    }, 15000);
  }

  /* ====================================
     RENDER NEARBY DEVICES
     ==================================== */

  function renderDevices() {
    deviceOrbit.innerHTML = "";

    if (nearbyDevices.length === 0) {
      emptyState.classList.remove("hidden");
      radarCenterLabel.textContent = "Looking for devices...";
      return;
    }

    emptyState.classList.add("hidden");
    radarCenterLabel.textContent = nearbyDevices.length + " device" + (nearbyDevices.length > 1 ? "s" : "") + " nearby";

    var radius = 120; // orbit radius
    var count = nearbyDevices.length;

    nearbyDevices.forEach(function (device, i) {
      var angle = (2 * Math.PI * i / count) - Math.PI / 2; // start from top
      var x = Math.cos(angle) * radius;
      var y = Math.sin(angle) * radius;

      var avatar = document.createElement("div");
      avatar.className = "device-avatar";
      avatar.style.left = "calc(50% + " + x + "px - 28px)";
      avatar.style.top = "calc(50% + " + y + "px - 35px)";
      avatar.style.animationDelay = (i * 0.1) + "s";
      avatar.setAttribute("data-socket-id", device.socketId);

      avatar.innerHTML =
        '<div class="device-avatar-icon">' + getDeviceEmoji(device.deviceType) + '</div>' +
        '<div class="device-avatar-name">' + escapeHtml(device.deviceName) + '</div>';

      avatar.addEventListener("click", function () {
        onDeviceClick(device);
      });

      deviceOrbit.appendChild(avatar);
    });
  }

  /* ====================================
     DEVICE CLICK → FILE PICKER
     ==================================== */

  function onDeviceClick(device) {
    targetSocketId = device.socketId;
    fileInput.value = "";
    fileInput.click();
  }

  fileInput.addEventListener("change", function () {
    if (!fileInput.files || fileInput.files.length === 0) return;
    if (!targetSocketId) return;

    pendingFiles = Array.from(fileInput.files);

    // Build file metadata for the request
    var fileMeta = pendingFiles.map(function (f) {
      return { name: f.name, size: f.size, type: f.type };
    });

    // Show transfer overlay in "waiting" state
    showTransferOverlay("waiting", pendingFiles);

    // Send file request via signaling
    socket.emit("send-file-request", {
      targetSocketId: targetSocketId,
      files: fileMeta,
      senderName: myDevice.name
    });
  });

  /* ====================================
     TRANSFER OVERLAY
     ==================================== */

  function showTransferOverlay(state, files) {
    transferOverlay.classList.remove("hidden");

    if (state === "waiting") {
      transferIcon.textContent = "⏳";
      transferTitle.textContent = "Waiting for acceptance...";
    } else if (state === "connecting") {
      transferIcon.textContent = "🔗";
      transferTitle.textContent = "Connecting...";
    } else if (state === "sending") {
      transferIcon.textContent = "📤";
      transferTitle.textContent = "Sending...";
    } else if (state === "receiving") {
      transferIcon.textContent = "📥";
      transferTitle.textContent = "Receiving...";
    }

    if (files && files.length > 0) {
      var first = files[0];
      transferFileIcon.textContent = getFileIcon(first.type);
      if (files.length === 1) {
        transferFileName.textContent = first.name;
        transferFileSize.textContent = formatSize(first.size);
      } else {
        transferFileName.textContent = files.length + " files";
        var total = files.reduce(function (acc, f) { return acc + f.size; }, 0);
        transferFileSize.textContent = formatSize(total);
      }
    }

    transferProgressFill.style.width = "0%";
    transferProgressText.textContent = "0%";
  }

  function updateTransferProgress(percent) {
    transferProgressFill.style.width = percent + "%";
    transferProgressText.textContent = percent + "%";

    if (percent >= 100) {
      transferTitle.textContent = "Complete!";
      transferIcon.textContent = "✅";
    }
  }

  function hideTransferOverlay() {
    transferOverlay.classList.add("hidden");
  }

  transferCancelBtn.addEventListener("click", function () {
    hideTransferOverlay();
    cleanupPeer();
  });

  /* ====================================
     FILE REQUEST MODAL (RECEIVER)
     ==================================== */

  function showFileRequest(data) {
    pendingRequest = data;

    requestFrom.textContent = (data.senderName || "Unknown device") + " wants to send:";
    requestFiles.innerHTML = "";

    data.files.forEach(function (f) {
      var item = document.createElement("div");
      item.className = "request-file-item";
      item.innerHTML =
        '<span class="rfi-icon">' + getFileIcon(f.type) + '</span>' +
        '<span class="rfi-name">' + escapeHtml(f.name) + '</span>' +
        '<span class="rfi-size">' + formatSize(f.size) + '</span>';
      requestFiles.appendChild(item);
    });

    requestOverlay.classList.remove("hidden");

    // Vibrate on mobile
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
  }

  requestAcceptBtn.addEventListener("click", function () {
    if (!pendingRequest) return;

    requestOverlay.classList.add("hidden");

    socket.emit("accept-file", { targetSocketId: pendingRequest.from });

    // Show transfer overlay in receiving mode
    showTransferOverlay("receiving", pendingRequest.files);

    // Receiver waits for the sender to create the offer
    startReceiverPeerConnection(pendingRequest.from);
  });

  requestDeclineBtn.addEventListener("click", function () {
    if (!pendingRequest) return;

    socket.emit("reject-file", { targetSocketId: pendingRequest.from });
    requestOverlay.classList.add("hidden");
    pendingRequest = null;
  });

  /* ====================================
     WEBRTC — SENDER SIDE
     ==================================== */

  function startSenderPeerConnection(targetId) {
    showTransferOverlay("connecting", pendingFiles);

    activePeer = new WairPlayPeer();

    // ICE candidates → send via signaling
    activePeer.onIceCandidate(function (candidate) {
      socket.emit("signal", {
        targetSocketId: targetId,
        data: { type: "ice-candidate", candidate: candidate }
      });
    });

    // Connection state
    activePeer.onConnectionStateChange(function (state) {
      console.log("[WebRTC] Connection state:", state);
      if (state === "failed") {
        hideTransferOverlay();
        showErrorToast("Connection failed — try again");
        cleanupPeer();
      }
    });

    // Create data channel + offer
    activeChannel = activePeer.createDataChannel("files");

    activeChannel.onopen = function () {
      console.log("[WebRTC] DataChannel open — starting transfer");
      showTransferOverlay("sending", pendingFiles);

      WairPlayTransfer.sendFiles(activeChannel, pendingFiles, function (percent) {
        updateTransferProgress(percent);
      }, function () {
        // Complete
        setTimeout(function () {
          hideTransferOverlay();
          showSuccessToast("Files sent successfully!");
          cleanupPeer();
        }, 800);
      }, function (err) {
        hideTransferOverlay();
        showErrorToast("Transfer failed: " + err);
        cleanupPeer();
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
     WEBRTC — RECEIVER SIDE
     ==================================== */

  function startReceiverPeerConnection(senderId) {
    activePeer = new WairPlayPeer();

    activePeer.onIceCandidate(function (candidate) {
      socket.emit("signal", {
        targetSocketId: senderId,
        data: { type: "ice-candidate", candidate: candidate }
      });
    });

    activePeer.onConnectionStateChange(function (state) {
      console.log("[WebRTC] Connection state:", state);
      if (state === "failed") {
        hideTransferOverlay();
        showErrorToast("Connection failed");
        cleanupPeer();
      }
    });

    activePeer.onDataChannel(function (channel) {
      console.log("[WebRTC] DataChannel received");
      activeChannel = channel;

      WairPlayTransfer.receiveFiles(channel, function (file) {
        // File received — trigger download
        triggerDownload(file.blob, file.name);
      }, function (percent) {
        updateTransferProgress(percent);
      }, function () {
        // All files done
        setTimeout(function () {
          hideTransferOverlay();
          showSuccessToast("Files received!");
          cleanupPeer();
          pendingRequest = null;
        }, 800);
      });
    });

    // The receiver stores the peer — offer will arrive via signaling
    targetSocketId = senderId;
  }

  /* ====================================
     SIGNALING HANDLER
     ==================================== */

  function handleSignal(msg) {
    var data = msg.data;
    var from = msg.from;

    if (data.type === "offer") {
      if (!activePeer) {
        console.warn("[Signal] Received offer but no active peer");
        return;
      }
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
     CLEANUP
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

  /* ====================================
     DOWNLOAD TRIGGER
     ==================================== */

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  /* ====================================
     TOAST NOTIFICATIONS
     ==================================== */

  function showSuccessToast(msg) {
    successToastText.textContent = msg;
    successToast.classList.remove("hidden");
    setTimeout(function () {
      successToast.classList.add("hidden");
    }, 4000);
  }

  function showErrorToast(msg) {
    errorToastText.textContent = msg;
    errorToast.classList.remove("hidden");
    setTimeout(function () {
      errorToast.classList.add("hidden");
    }, 4000);
  }

  /* ====================================
     UTILS
     ==================================== */

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ====================================
     INIT
     ==================================== */

  connectSocket();

})();
