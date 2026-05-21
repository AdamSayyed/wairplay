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
var successFileList = document.getElementById("successFileList");
var sendAnotherBtn = document.getElementById("sendAnotherBtn");
var failSection = document.getElementById("failSection");
var failText = document.getElementById("failText");
var retryBtn = document.getElementById("retryBtn");

var CIRCUMFERENCE = 2 * Math.PI * 65;
var selectedFiles = [];

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

  selectedFiles = Array.from(e.target.files);

  if (selectedFiles.length === 1) {
    var singleFile = selectedFiles[0];
    fileIcon.textContent = getFileIcon(singleFile.type);
    fileName.textContent = singleFile.name;
    fileSize.textContent = formatSize(singleFile.size);
  } else {
    fileIcon.textContent = "📂";
    fileName.textContent = selectedFiles.length + " files selected";
    var totalSize = selectedFiles.reduce(function(acc, file) { return acc + file.size; }, 0);
    fileSize.textContent = formatSize(totalSize);
  }
  
  fileInfoSection.classList.remove("hidden");
  sendBtn.disabled = false;
});

/* ====================================
   SEND FILE
   ==================================== */

sendBtn.addEventListener("click", function () {
  if (selectedFiles.length === 0) return;

  uploadSection.classList.add("hidden");
  progressSection.classList.remove("hidden");
  updateProgress(0);

  var formData = new FormData();
  selectedFiles.forEach(function(file) {
    formData.append("files", file);
  });

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
      
      successFileList.innerHTML = "";
      if (result.files && result.files.length > 0) {
        result.files.forEach(function(f) {
          var div = document.createElement("div");
          div.className = "file-info";
          div.style.marginBottom = "8px";
          div.innerHTML = 
            '<div class="file-icon">' + getFileIcon(f.type) + '</div>' +
            '<div class="file-details">' +
              '<div class="file-name">' + f.name + '</div>' +
              '<div class="file-size">' + formatSize(f.size) + '</div>' +
            '</div>';
          successFileList.appendChild(div);
        });
      }
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
  selectedFiles = [];
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

/* ====================================
   IMAGE PREVIEW LOGIC
   ==================================== */

var imagePreviewOverlay = document.getElementById("imagePreviewOverlay");
var imagePreviewImg = document.getElementById("imagePreviewImg");
var closePreviewBtn = document.getElementById("closePreviewBtn");

var pressTimer = null;
var previewObjectURL = null;

fileInfoSection.addEventListener("contextmenu", function (e) {
  e.preventDefault();
});

function startPress(e) {
  if (selectedFiles.length === 0) return;
  var imgFile = selectedFiles.find(function(f) { return f.type.startsWith("image/"); });
  if (!imgFile) return;

  pressTimer = setTimeout(function () {
    previewObjectURL = URL.createObjectURL(imgFile);
    imagePreviewImg.src = previewObjectURL;
    imagePreviewOverlay.classList.remove("hidden");
  }, 500);
}

function cancelPress() {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
}

fileInfoSection.addEventListener("mousedown", startPress);
fileInfoSection.addEventListener("touchstart", startPress, { passive: true });

fileInfoSection.addEventListener("mouseup", cancelPress);
fileInfoSection.addEventListener("mouseleave", cancelPress);
fileInfoSection.addEventListener("touchend", cancelPress);
fileInfoSection.addEventListener("touchcancel", cancelPress);

function closePreview() {
  imagePreviewOverlay.classList.add("hidden");
  imagePreviewImg.src = "";
  if (previewObjectURL) {
    URL.revokeObjectURL(previewObjectURL);
    previewObjectURL = null;
  }
}

closePreviewBtn.addEventListener("click", closePreview);
imagePreviewOverlay.addEventListener("click", function(e) {
  if (e.target === imagePreviewOverlay) {
    closePreview();
  }
});
