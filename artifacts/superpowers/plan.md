# Plan: Fix WairPlay Extension — Browser Instance P2P Connection

## Goal

Fix the Chrome extension so it connects to the WairPlay server as a real P2P peer via Socket.IO, discovers nearby devices, and supports WebRTC file transfers — matching the web client (`app.js`) behavior.

## Assumptions

1. **Option A from brainstorm** is approved — wire popup to offscreen via message passing
2. The server (`server.js`) requires **zero changes** — the P2P signaling protocol is correct
3. The offscreen.js / background.js logic is architecturally correct but has loading bugs to fix
4. The popup.js + popup.html need a full rewrite to replace the dead QR/SSE model with a device-list P2P UI
5. The WairPlay server is running on `localhost:3000` during testing

---

## Plan

### Step 1 — Fix `manifest.json` (add background + permissions)

**Files:** `extension/manifest.json`

**Change:** Add the `background` service worker declaration and all required permissions. Update description.

```json
{
  "manifest_version": 3,
  "name": "WairPlay",
  "description": "AirDrop for Windows — P2P file transfer between devices on the same network",
  "version": "1.1.0",
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "background": {
    "service_worker": "background.js"
  },
  "permissions": [
    "offscreen",
    "notifications",
    "downloads",
    "storage"
  ],
  "host_permissions": [
    "http://localhost:3000/*"
  ]
}
```

**Verify:** Load the extension in `chrome://extensions` with Developer Mode → no errors or warnings.

---

### Step 2 — Fix `offscreen.html` script path

**Files:** `extension/offscreen.html`

**Change:** The offscreen.html references `js/offscreen.js` but the file is at `offscreen.js` (extension root). Fix the script src to point to the correct path.

Before:
```html
<script src="js/offscreen.js"></script>
```

After:
```html
<script src="offscreen.js"></script>
```

**Verify:** Reload extension → check `chrome://extensions` service worker console → confirm `[Background] Offscreen document created successfully` log appears. Check offscreen console for `[Offscreen] Connected to server:` log.

---

### Step 3 — Rewrite `popup.html` (P2P device-list UI)

**Files:** `extension/popup.html`

**Change:** Replace the QR code / SSE-based UI with a new popup that shows:
- Connection status badge (connected / disconnected / transferring)
- Device name (editable)
- Nearby device list (clickable cards with device emoji + name)
- Active transfer progress card (file info, progress bar, percentage)
- Transfer history list
- Hidden file input for sending

Keep the existing premium glassmorphism styling. Remove QR-related elements (`qrCard`, `qrArea`, `qrInstruction`, `pairingUrl`, `offlineCard`). Add device list container, file input, and transfer UI elements.

Key HTML structure:
```
popup
├── header (logo + title)
├── status badge
├── device name row (with rename pencil icon)
├── device list section (or "no devices" empty state)
├── transfer card (hidden by default — shown during send/receive)
├── history section
├── footer
└── hidden file input
```

**Verify:** Load extension → open popup → visually confirm the new UI renders (will show "Disconnected" until popup.js is wired).

---

### Step 4 — Rewrite `popup.js` (message-passing thin client)

**Files:** `extension/popup.js`

**Change:** Delete all QR/SSE logic. Replace with a message-passing client that:

1. **On open:** Send `init-offscreen` to background.js → then send `query-state` to offscreen.js → render state
2. **Listen for `state-update`** messages from offscreen → re-render device list, status, transfer progress, history
3. **Device click** → set `targetSocketId` → open file picker
4. **File selected** → read files as ArrayBuffers → send `send-files-request` message to offscreen with file metadata
5. **Listen for `request-file-buffers`** from offscreen → respond with ArrayBuffers from the selected files
6. **Device rename** → send `rename-device` message to offscreen
7. **Cancel transfer** → send `cancel-transfer` message to offscreen

Message protocol (already defined in offscreen.js):
- `init-offscreen` → background.js → ensures offscreen doc exists
- `query-state` → offscreen.js → returns full state object
- `state-update` → offscreen.js broadcasts → popup renders
- `send-files-request` → popup → offscreen.js (with targetSocketId + files metadata)
- `request-file-buffers` → offscreen.js → popup (popup responds with ArrayBuffers)
- `rename-device` → popup → offscreen.js
- `cancel-transfer` → popup → offscreen.js

**Verify:** 
1. Start WairPlay server: `node server.js`
2. Open `http://localhost:3000` in a browser tab
3. Open extension popup
4. Both should see each other in their device lists (web client shows "Chrome Extension", extension shows "Windows PC" or similar)

---

### Step 5 — Fix `offscreen.js` minor issues

**Files:** `extension/offscreen.js`

**Change:** 
1. Add `request-file-buffers` response handling — currently offscreen sends `request-file-buffers` to popup but popup.js never responds. The new popup.js (Step 4) will handle this, but offscreen also needs to handle the case where popup is closed (no response).
2. Add a timeout for `request-file-buffers` — if popup doesn't respond in 5 seconds, fail gracefully.
3. Ensure `query-state` returns a synchronous response (it already does via `sendResponse(state)` — just verify).

**Verify:** Check extension service worker console for no errors. Trigger a file send from extension → verify the file buffer request flows correctly to popup.

---

### Step 6 — End-to-end test: extension ↔ web client

**Files:** None (testing only)

**Change:** None — this is a verification step.

**Verify (all must pass):**
1. Start server: `node server.js`
2. Open `http://localhost:3000` in Chrome → see device registered
3. Open extension popup → see "Connected" status + the web client device in the list
4. Web client should also show "Chrome Extension" in its device list
5. **Test send from extension → web client:**
   - Click the web client device in extension popup
   - Select a test file
   - Web client should show "Incoming File" request modal
   - Accept → file transfers via WebRTC → downloads on web client
6. **Test send from web client → extension:**
   - Click "Chrome Extension" on the web client
   - Select a test file
   - Chrome notification should appear with Accept/Decline
   - Accept → file transfers → downloads on extension side
7. Transfer history should appear in extension popup
8. Close and reopen popup → history persists, status is correct

---

## Risks & mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Offscreen document killed by Chrome | Medium | background.js re-creates on `init-offscreen`; popup always sends `init-offscreen` before `query-state` |
| Large files exceed Chrome message size limit (~128MB) | Medium | Files are read as ArrayBuffers in popup and sent via `sendResponse`; for large files, chunk into multiple messages if needed (defer to v2) |
| Popup closes mid-file-read before `request-file-buffers` response | Medium | offscreen.js adds 5-second timeout; if popup closes, transfer fails gracefully with error message |
| Extension CSP blocks Socket.IO | Low | `host_permissions` already allows `localhost:3000`; if needed, add explicit CSP |

## Rollback plan

All changes are confined to the `extension/` directory:
- `manifest.json` — revert to empty permissions + no background
- `offscreen.html` — revert script src to `js/offscreen.js`
- `popup.html` — revert to QR-based UI
- `popup.js` — revert to SSE/fetch model
- `offscreen.js` — revert minor timeout addition

Git: `git checkout -- extension/` will revert all changes.
