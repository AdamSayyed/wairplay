var statusBadge = document.getElementById("statusBadge");
var statusText = document.getElementById("statusText");
var qrBox = document.getElementById("qrBox");
var qrInstruction = document.getElementById("qrInstruction");
var pairingUrlEl = document.getElementById("pairingUrl");
var sessionInfo = document.getElementById("sessionInfo");
var sessionIdDisplay = document.getElementById("sessionIdDisplay");
var filesSection = document.getElementById("filesSection");
var filesList = document.getElementById("filesList");

var currentSessionId = null;

/* ====================================
   1. CREATE SESSION
   ==================================== */

fetch("/api/session", { method: "POST" })
  .then(function (res) { return res.json(); })
  .then(function (data) {
    currentSessionId = data.sessionId;
    sessionIdDisplay.textContent = currentSessionId;
    sessionInfo.classList.remove("hidden");

    loadQR(currentSessionId);
    connectSSE(currentSessionId);
  })
  .catch(function () {
    setStatus("error", "Failed to create session");
    qrInstruction.textContent = "Server error";
  });

/* ====================================
   2. LOAD QR CODE
   ==================================== */

function loadQR(sessionId) {
  fetch("/api/session/" + sessionId + "/qr")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      qrBox.innerHTML = '<img src="' + data.qrCode + '" width="240" height="240" alt="QR Code" style="image-rendering: pixelated;">';
      qrInstruction.textContent = "Scan with iPhone camera";

      pairingUrlEl.textContent = data.sendUrl;
      pairingUrlEl.classList.remove("hidden");
      pairingUrlEl.addEventListener("click", function () {
        navigator.clipboard.writeText(data.sendUrl).then(function () {
          pairingUrlEl.textContent = "✓ Copied to clipboard!";
          setTimeout(function () {
            pairingUrlEl.textContent = data.sendUrl;
          }, 1500);
        });
      });

      setStatus("waiting", "Waiting for device...");
    })
    .catch(function () {
      setStatus("error", "Failed to generate QR");
    });
}

/* ====================================
   3. SSE — LISTEN FOR EVENTS
   ==================================== */

function connectSSE(sessionId) {
  var eventSource = new EventSource("/api/session/" + sessionId + "/events");

  eventSource.addEventListener("connected", function () {
    console.log("SSE connected for session:", sessionId);
  });

  eventSource.addEventListener("sender-connected", function () {
    setStatus("connected", "Device connected ✓");
    qrInstruction.textContent = "📱 iPhone connected — ready to receive";
  });

  eventSource.addEventListener("file-received", function (e) {
    var file = JSON.parse(e.data);

    setStatus("complete", "File received ✓");
    addFileCard(sessionId, file);

    setTimeout(function () {
      setStatus("connected", "Ready for more files");
    }, 3000);
  });

  eventSource.addEventListener("error", function () {
    console.log("SSE reconnecting...");
  });
}

/* ====================================
   4. ADD DOWNLOAD CARD
   ==================================== */

function addFileCard(sessionId, file) {
  filesSection.classList.remove("hidden");

  var card = document.createElement("div");
  card.className = "file-card";
  card.innerHTML =
    '<div class="fc-icon">' + getFileIcon(file.type) + '</div>' +
    '<div class="fc-details">' +
      '<div class="fc-name" title="' + file.name + '">' + file.name + '</div>' +
      '<div class="fc-size">' + formatSize(file.size) + '</div>' +
    '</div>' +
    '<a class="btn-download" href="/api/session/' + sessionId + '/download/' + file.id + '" download="' + file.name + '">Download</a>';

  filesList.prepend(card);

  triggerAutoDownload(sessionId, file);
}

/* ====================================
   5. AUTO-DOWNLOAD
   ==================================== */

function triggerAutoDownload(sessionId, file) {
  var link = document.createElement("a");
  link.href = "/api/session/" + sessionId + "/download/" + file.id;
  link.download = file.name;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ====================================
   HELPERS
   ==================================== */

function setStatus(type, text) {
  statusBadge.className = "status-badge status-badge--" + type;
  statusText.textContent = text;
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
  if (mimeType.indexOf("zip") !== -1 || mimeType.indexOf("compressed") !== -1) return "📦";
  if (mimeType.indexOf("text") !== -1) return "📝";
  return "📄";
}
