var params = new URLSearchParams(window.location.search);
var sessionId = params.get("session");

var statusBadge = document.getElementById("statusBadge");
var statusText = document.getElementById("statusText");
var errorSection = document.getElementById("errorSection");
var errorText = document.getElementById("errorText");
var uploadSection = document.getElementById("uploadSection");
var fileUploadZone = document.getElementById("fileUploadZone");
var fileInput = document.getElementById("fileInput");
var fileInfoSection = document.getElementById("fileInfoSection");
var fileIcon = document.getElementById("fileIcon");
var fileName = document.getElementById("fileName");
var fileSize = document.getElementById("fileSize");
var sendBtn = document.getElementById("sendBtn");
var progressSection = document.getElementById("progressSection");
var progressRing = document.getElementById("progressRing");
var progressPercent = document.getElementById("progressPercent");
var progressLabel = document.getElementById("progressLabel");
var successSection = document.getElementById("successSection");
var successDetails = document.getElementById("successDetails");
var sendAnotherBtn = document.getElementById("sendAnotherBtn");
var failSection = document.getElementById("failSection");
var failText = document.getElementById("failText");
var retryBtn = document.getElementById("retryBtn");

var CIRCUMFERENCE = 2 * Math.PI * 65;
var selectedFile = null;

progressRing.style.strokeDasharray = CIRCUMFERENCE;
progressRing.style.strokeDashoffset = CIRCUMFERENCE;

/* ====================================
   INIT — JOIN SESSION
   ==================================== */

if (!sessionId) {
  showError("Invalid link. Scan the QR code again.");
} else {
  joinSession();
}

function joinSession() {
  setStatus("waiting", "Connecting...");

  fetch("/api/session/" + sessionId + "/join", { method: "POST" })
    .then(function (res) {
      if (!res.ok) {
        return res.json().then(function (data) {
          throw new Error(data.error || "Session not found");
        });
      }
      return res.json();
    })
    .then(function () {
      setStatus("connected", "Connected to PC ✓");
      uploadSection.classList.remove("hidden");
    })
    .catch(function (err) {
      showError(err.message || "Session not found. Scan QR again.");
    });
}

/* ====================================
   FILE SELECTION
   ==================================== */

fileUploadZone.addEventListener("click", function () {
  fileInput.click();
});

fileInput.addEventListener("change", function (e) {
  if (e.target.files.length === 0) return;

  selectedFile = e.target.files[0];

  fileIcon.textContent = getFileIcon(selectedFile.type);
  fileName.textContent = selectedFile.name;
  fileSize.textContent = formatSize(selectedFile.size);
  fileInfoSection.classList.remove("hidden");
  sendBtn.disabled = false;
});

/* ====================================
   SEND FILE
   ==================================== */

sendBtn.addEventListener("click", function () {
  if (!selectedFile) return;

  uploadSection.classList.add("hidden");
  progressSection.classList.remove("hidden");
  updateProgress(0);

  var formData = new FormData();
  formData.append("file", selectedFile);

  var xhr = new XMLHttpRequest();

  xhr.upload.addEventListener("progress", function (e) {
    if (e.lengthComputable) {
      var percent = Math.round((e.loaded / e.total) * 100);
      updateProgress(percent);
    }
  });

  xhr.addEventListener("load", function () {
    if (xhr.status === 200) {
      var result = JSON.parse(xhr.responseText);

      progressSection.classList.add("hidden");
      successSection.classList.remove("hidden");
      successDetails.textContent = result.file.name + " sent to your PC!";
      setStatus("complete", "Sent ✓");
    } else {
      showFail("Server error. Try again.");
    }
  });

  xhr.addEventListener("error", function () {
    showFail("Network error. Check your connection.");
  });

  xhr.addEventListener("timeout", function () {
    showFail("Upload timed out.");
  });

  xhr.timeout = 600000;
  xhr.open("POST", "/api/session/" + sessionId + "/upload");
  xhr.send(formData);
});

/* ====================================
   SEND ANOTHER / RETRY
   ==================================== */

sendAnotherBtn.addEventListener("click", resetUI);
retryBtn.addEventListener("click", resetUI);

function resetUI() {
  selectedFile = null;
  fileInput.value = "";
  fileInfoSection.classList.add("hidden");
  sendBtn.disabled = true;
  successSection.classList.add("hidden");
  failSection.classList.add("hidden");
  progressSection.classList.add("hidden");
  uploadSection.classList.remove("hidden");
  updateProgress(0);
  setStatus("connected", "Connected to PC ✓");
}

/* ====================================
   HELPERS
   ==================================== */

function setStatus(type, text) {
  statusBadge.className = "status-badge status-badge--" + type;
  statusText.textContent = text;
  errorSection.classList.add("hidden");
}

function showError(msg) {
  errorText.textContent = msg;
  errorSection.classList.remove("hidden");
  statusBadge.className = "status-badge status-badge--error";
  statusText.textContent = "Error";
}

function showFail(msg) {
  progressSection.classList.add("hidden");
  failSection.classList.remove("hidden");
  failText.textContent = msg;
  setStatus("error", "Failed");
}

function updateProgress(percent) {
  var offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
  progressRing.style.strokeDashoffset = offset;
  progressPercent.textContent = percent + "%";

  if (percent >= 100) {
    progressLabel.textContent = "Processing...";
  } else {
    progressLabel.textContent = "Uploading... " + percent + "%";
  }
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
