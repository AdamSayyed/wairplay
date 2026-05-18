var SERVER_URL = "http://localhost:3000";

var statusBadge = document.getElementById("statusBadge");
var statusText = document.getElementById("statusText");
var offlineCard = document.getElementById("offlineCard");
var qrCard = document.getElementById("qrCard");
var qrArea = document.getElementById("qrArea");
var qrInstruction = document.getElementById("qrInstruction");
var pairingUrlEl = document.getElementById("pairingUrl");
var transferCard = document.getElementById("transferCard");
var txFileIcon = document.getElementById("txFileIcon");
var txFileName = document.getElementById("txFileName");
var txFileSize = document.getElementById("txFileSize");
var txProgress = document.getElementById("txProgress");
var txPercent = document.getElementById("txPercent");
var historyList = document.getElementById("historyList");
var emptyHistory = document.getElementById("emptyHistory");

/* ====================================
   INIT — CHECK SERVER + LOAD QR
   ==================================== */

init();

function init() {
  fetch(SERVER_URL + "/api/qr")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      offlineCard.classList.add("hidden");
      qrCard.classList.remove("hidden");

      qrArea.innerHTML =
        '<div class="pulse-wrapper">' +
        '<img src="' + data.qrCode + '" width="220" height="220" alt="QR Code"/>' +
        '</div>';

      qrInstruction.textContent = "Scan with iPhone camera";

      pairingUrlEl.textContent = data.uploadUrl;
      pairingUrlEl.classList.remove("hidden");
      pairingUrlEl.addEventListener("click", function () {
        navigator.clipboard.writeText(data.uploadUrl).then(function () {
          pairingUrlEl.textContent = "✓ Copied!";
          setTimeout(function () {
            pairingUrlEl.textContent = data.uploadUrl;
          }, 1500);
        });
      });

      setStatus("waiting", "Waiting for device...");

      connectSSE();
    })
    .catch(function () {
      setStatus("error", "Server offline");
      offlineCard.classList.remove("hidden");
      qrCard.classList.add("hidden");
    });
}

/* ====================================
   SSE — LIVE TRANSFER EVENTS
   ==================================== */

function connectSSE() {
  var eventSource = new EventSource(SERVER_URL + "/events");

  eventSource.addEventListener("transfer-start", function (e) {
    var data = JSON.parse(e.data);

    setStatus("transferring", "Receiving...");
    transferCard.classList.remove("hidden");

    txFileIcon.textContent = getFileIcon(data.type);
    txFileName.textContent = data.name;
    txFileSize.textContent = formatSize(data.size);
    txProgress.style.width = "10%";
    txPercent.textContent = "...";
  });

  eventSource.addEventListener("transfer-complete", function (e) {
    var data = JSON.parse(e.data);

    setStatus("complete", "File received ✓");
    txProgress.style.width = "100%";
    txPercent.textContent = "✓";

    setTimeout(function () {
      transferCard.classList.add("hidden");
      addToHistory(data.name, data.size);
      setStatus("waiting", "Ready for next file");
    }, 2000);
  });

  eventSource.addEventListener("error", function () {
    setTimeout(function () {
      connectSSE();
    }, 3000);
  });
}

/* ====================================
   HELPERS
   ==================================== */

function setStatus(type, text) {
  statusBadge.className = "status-badge status-badge--" + type;
  statusText.textContent = text;
}

function addToHistory(name, size) {
  if (emptyHistory) {
    emptyHistory.remove();
    emptyHistory = null;
  }

  var li = document.createElement("li");
  li.className = "history-item";
  li.innerHTML =
    '<span class="hi-check">✓</span>' +
    '<span class="hi-name" title="' + name + '">' + name + '</span>' +
    '<span class="hi-size">' + formatSize(size) + '</span>';

  historyList.prepend(li);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(2) + " GB";
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
