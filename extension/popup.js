/* ====================================
   WairPlay Extension — Popup Script
   Thin UI client that communicates with offscreen.js via message passing
   ==================================== */

(function () {
  "use strict";

  /* --- DOM References --- */
  var statusBadge = document.getElementById("statusBadge");
  var statusText = document.getElementById("statusText");
  var myDeviceName = document.getElementById("myDeviceName");
  var myDeviceDot = document.getElementById("myDeviceDot");
  var renameBtn = document.getElementById("renameBtn");
  var myDeviceRow = document.getElementById("myDeviceRow");
  var deviceList = document.getElementById("deviceList");
  var emptyState = document.getElementById("emptyState");
  var transferCard = document.getElementById("transferCard");
  var txDirection = document.getElementById("txDirection");
  var txFileIcon = document.getElementById("txFileIcon");
  var txFileName = document.getElementById("txFileName");
  var txFileSize = document.getElementById("txFileSize");
  var txProgress = document.getElementById("txProgress");
  var txPercent = document.getElementById("txPercent");
  var txStatus = document.getElementById("txStatus");
  var cancelBtn = document.getElementById("cancelBtn");
  var historyList = document.getElementById("historyList");
  var emptyHistory = document.getElementById("emptyHistory");
  var fileInput = document.getElementById("fileInput");

  /* --- State --- */
  var targetSocketId = null;
  var selectedFiles = null; // Held in popup for request-file-buffers response
  var isRenaming = false;

  /* ====================================
     INIT — Ensure offscreen doc exists, then query state
     ==================================== */

  init();

  function init() {
    // Step 1: Ask background.js to ensure the offscreen document is running
    chrome.runtime.sendMessage({ type: "init-offscreen" }, function () {
      // Step 2: Poll for offscreen state with retries
      // The offscreen doc may take a few seconds to load socket.io (160KB) and connect
      var attempts = 0;
      var maxAttempts = 10;

      function tryQueryState() {
        attempts++;
        chrome.runtime.sendMessage({ type: "query-state" }, function (state) {
          if (chrome.runtime.lastError) {
            console.log("[Popup] query-state attempt", attempts, "failed:", chrome.runtime.lastError.message);
          }

          if (state) {
            console.log("[Popup] Got state from offscreen:", state.status);
            renderState(state);
          } else if (attempts < maxAttempts) {
            // Retry after delay
            setTimeout(tryQueryState, 500);
          } else {
            console.warn("[Popup] Failed to get state after", maxAttempts, "attempts");
            setStatus("error", "Cannot reach extension backend");
          }
        });
      }

      // Start polling after initial delay for offscreen to load scripts
      setTimeout(tryQueryState, 500);
    });
  }

  /* ====================================
     LISTEN FOR STATE UPDATES FROM OFFSCREEN
     ==================================== */

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.type === "state-update") {
      renderState(message.state);
    }

    // Offscreen asks popup for file ArrayBuffers when data channel is open
    if (message.type === "request-file-buffers") {
      if (!selectedFiles || selectedFiles.length === 0) {
        sendResponse({ buffers: null });
        return;
      }

      readFilesAsArrayBuffers(selectedFiles, function (buffers) {
        sendResponse({ buffers: buffers });
      });

      return true; // Keep channel open for async response
    }
  });

  /* ====================================
     RENDER STATE
     ==================================== */

  function renderState(state) {
    if (!state) return;

    // Status badge
    setStatus(state.status, state.statusText);

    // My device name
    if (!isRenaming && state.myDevice) {
      myDeviceName.textContent = state.myDevice.name || "Chrome Extension";
      myDeviceDot.style.background = (state.status === "error") ? "var(--error)" : "var(--success)";
    }

    // Nearby devices
    renderDevices(state.nearbyDevices || []);

    // Active transfer
    if (state.activeTransfer) {
      showTransfer(state.activeTransfer);
    } else {
      transferCard.classList.add("hidden");
    }

    // History
    renderHistory(state.history || []);
  }

  /* ====================================
     DEVICE LIST
     ==================================== */

  function renderDevices(devices) {
    deviceList.innerHTML = "";

    if (devices.length === 0) {
      emptyState.classList.remove("hidden");
      return;
    }

    emptyState.classList.add("hidden");

    devices.forEach(function (device) {
      var card = document.createElement("div");
      card.className = "device-card";
      card.setAttribute("data-socket-id", device.socketId);

      card.innerHTML =
        '<span class="device-emoji">' + getDeviceEmoji(device.deviceType) + '</span>' +
        '<div class="device-info">' +
          '<div class="device-name">' + escapeHtml(device.deviceName) + '</div>' +
          '<div class="device-hint">Tap to send files</div>' +
        '</div>' +
        '<span class="device-arrow">›</span>';

      card.addEventListener("click", function () {
        onDeviceClick(device);
      });

      deviceList.appendChild(card);
    });
  }

  /* ====================================
     DEVICE CLICK → FILE PICKER → SEND REQUEST
     ==================================== */

  function onDeviceClick(device) {
    targetSocketId = device.socketId;
    fileInput.value = "";
    fileInput.click();
  }

  fileInput.addEventListener("change", function () {
    if (!fileInput.files || fileInput.files.length === 0) return;
    if (!targetSocketId) return;

    selectedFiles = Array.from(fileInput.files);

    // Build file metadata
    var fileMeta = selectedFiles.map(function (f) {
      return { name: f.name, size: f.size, type: f.type };
    });

    // Tell offscreen to send the file request to the target device
    chrome.runtime.sendMessage({
      type: "send-files-request",
      targetSocketId: targetSocketId,
      files: fileMeta
    }, function (response) {
      if (response && response.status === "ok") {
        console.log("[Popup] File request sent to offscreen");
      }
    });
  });

  /* ====================================
     TRANSFER UI
     ==================================== */

  function showTransfer(transfer) {
    transferCard.classList.remove("hidden");

    if (transfer.direction === "send") {
      txDirection.textContent = "📤 Sending...";
    } else {
      txDirection.textContent = "📥 Receiving...";
    }

    txFileIcon.textContent = getFileIcon(transfer.type);
    txFileName.textContent = transfer.name || "—";
    txFileSize.textContent = formatSize(transfer.size || 0);
    txProgress.style.width = (transfer.percent || 0) + "%";
    txPercent.textContent = (transfer.percent || 0) + "%";

    if (transfer.percent >= 100) {
      txStatus.textContent = "Complete!";
      txDirection.textContent = "✅ Complete!";
    } else {
      txStatus.textContent = "In progress";
    }
  }

  cancelBtn.addEventListener("click", function () {
    chrome.runtime.sendMessage({ type: "cancel-transfer" });
    transferCard.classList.add("hidden");
    selectedFiles = null;
    targetSocketId = null;
  });

  /* ====================================
     DEVICE RENAME
     ==================================== */

  renameBtn.addEventListener("click", function () {
    if (isRenaming) return;

    isRenaming = true;
    var currentName = myDeviceName.textContent;

    // Replace name span with input
    var input = document.createElement("input");
    input.type = "text";
    input.className = "my-device-name-input";
    input.value = currentName;
    myDeviceName.style.display = "none";
    myDeviceRow.insertBefore(input, renameBtn);
    input.focus();
    input.select();

    function finishRename() {
      var newName = input.value.trim() || currentName;
      input.remove();
      myDeviceName.style.display = "";
      myDeviceName.textContent = newName;
      isRenaming = false;

      if (newName !== currentName) {
        chrome.runtime.sendMessage({
          type: "rename-device",
          name: newName
        });
      }
    }

    input.addEventListener("blur", finishRename);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        input.value = currentName;
        input.blur();
      }
    });
  });

  /* ====================================
     HISTORY
     ==================================== */

  function renderHistory(history) {
    historyList.innerHTML = "";

    if (history.length === 0) {
      var li = document.createElement("li");
      li.className = "empty-history";
      li.textContent = "No transfers yet";
      historyList.appendChild(li);
      return;
    }

    history.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "history-item";

      var icon = item.direction === "send" ? "📤" : "📥";

      li.innerHTML =
        '<span class="hi-icon">' + icon + '</span>' +
        '<span class="hi-name" title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</span>' +
        '<span class="hi-size">' + formatSize(item.size) + '</span>';

      historyList.appendChild(li);
    });
  }

  /* ====================================
     FILE BUFFER READER
     ==================================== */

  function readFilesAsArrayBuffers(files, callback) {
    var buffers = [];
    var remaining = files.length;

    files.forEach(function (file, idx) {
      var reader = new FileReader();
      reader.onload = function (e) {
        buffers[idx] = e.target.result;
        remaining--;
        if (remaining === 0) {
          callback(buffers);
        }
      };
      reader.onerror = function () {
        buffers[idx] = null;
        remaining--;
        if (remaining === 0) {
          callback(buffers);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ====================================
     HELPERS
     ==================================== */

  function setStatus(type, text) {
    statusBadge.className = "status-badge status-badge--" + type;
    statusText.textContent = text;
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
    if (mimeType.indexOf("zip") !== -1) return "📦";
    if (mimeType.indexOf("text") !== -1) return "📝";
    return "📄";
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
    return (bytes / 1073741824).toFixed(2) + " GB";
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

})();
