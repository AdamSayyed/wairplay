/* ====================================
   WairPlay Extension — Background Service Worker
   ==================================== */

var OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

// Keep track of active notifications to know which request they correspond to
var activeNotifications = {};

// Open the offscreen document
async function setupOffscreen() {
  // Check if it's already open
  var contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });

  if (contexts.length > 0) {
    return;
  }

  // Create offscreen document
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["WEB_RTC", "BLOBS"],
      justification: "Running Socket.IO and WebRTC for persistent peer-to-peer file transfer"
    });
    console.log("[Background] Offscreen document created successfully");
  } catch (err) {
    console.error("[Background] Failed to create offscreen document:", err);
  }
}

// Open offscreen doc on startup and install
chrome.runtime.onStartup.addListener(setupOffscreen);
chrome.runtime.onInstalled.addListener(setupOffscreen);

// Re-open offscreen document when popup or background needs it
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === "init-offscreen") {
    setupOffscreen().then(function () {
      sendResponse({ status: "ok" });
    });
    return true; // Keep channel open for async response
  }

  if (message.type === "show-request-notification") {
    var notificationId = "req-" + Date.now();
    activeNotifications[notificationId] = {
      senderId: message.senderId,
      senderName: message.senderName,
      files: message.files
    };

    var fileListText = message.files.map(function (f) {
      return f.name + " (" + formatSize(f.size) + ")";
    }).join(", ");

    chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "WairPlay P2P: Incoming Files",
      message: (message.senderName || "A device") + " wants to send: " + fileListText,
      buttons: [
        { title: "Accept" },
        { title: "Decline" }
      ],
      requireInteraction: true
    });
  }
});

// Handle notification button clicks (Accept / Decline)
chrome.notifications.onButtonClicked.addListener(function (notificationId, buttonIndex) {
  var req = activeNotifications[notificationId];
  if (!req) return;

  if (buttonIndex === 0) {
    // Accept
    console.log("[Background] User accepted transfer from:", req.senderName);
    chrome.runtime.sendMessage({
      type: "notification-response",
      action: "accept",
      senderId: req.senderId,
      files: req.files
    });
  } else {
    // Decline
    console.log("[Background] User declined transfer from:", req.senderName);
    chrome.runtime.sendMessage({
      type: "notification-response",
      action: "decline",
      senderId: req.senderId
    });
  }

  chrome.notifications.clear(notificationId);
  delete activeNotifications[notificationId];
});

// Format helper
function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(2) + " GB";
}
