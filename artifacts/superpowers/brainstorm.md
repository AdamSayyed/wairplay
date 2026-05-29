# Brainstorm: Fix WairPlay Extension — Browser Instance P2P Connection

## Goal

Make the WairPlay Chrome extension function as a **real P2P peer** that:
1. Connects to the WairPlay server via **Socket.IO** (just like the web client `app.js` does)
2. Appears in the device-list for other peers on the same network
3. Can discover nearby devices and initiate/receive file transfers via WebRTC
4. Works persistently in the background (not only when the popup is open)

## Constraints

| # | Constraint |
|---|-----------|
| 1 | **Manifest V3** — no persistent background pages; must use offscreen documents for DOM-dependent APIs (Socket.IO, WebRTC) |
| 2 | **No server changes** — the server's P2P signaling model (`register-device`, `device-list`, `signal`, `send-file-request`, etc.) is correct and should stay as-is |
| 3 | **Offscreen document = the peer** — Socket.IO and WebRTC require a DOM context; the offscreen document is the only MV3-compatible persistent DOM environment |
| 4 | **Popup is ephemeral** — Chrome closes the popup whenever the user clicks away; it cannot hold a Socket.IO connection |
| 5 | Extension must request appropriate permissions (`offscreen`, `notifications`, `downloads`, `background`) |

## Known context

### What's working (offscreen.js — correct architecture)
- `offscreen.js` already implements the **correct P2P flow**: Socket.IO connect → register-device → device-list → signal → WebRTC data channel → file transfer
- It bundles `socket.io.js`, `webrtc.js`, `transfer.js` locally in `extension/js/`
- It uses `chrome.runtime.sendMessage` to relay state to the popup and receive commands
- It uses `chrome.downloads.download()` to save received files
- It uses `chrome.notifications` (via background.js) for incoming file requests

### What's broken (popup.js — wrong architecture)
- `popup.js` calls `fetch(SERVER_URL + "/api/qr")` and `new EventSource(SERVER_URL + "/events")` — **these API endpoints do not exist** on the current P2P server
- The popup tries to be a standalone receiver using a QR/SSE session model from an older (pre-P2P) design
- The popup never communicates with `offscreen.js` at all — it doesn't query state, doesn't relay device clicks, doesn't trigger transfers
- The popup shows a QR code + "Scan with iPhone camera" flow that's irrelevant to the P2P architecture

### Manifest is incomplete
- `"permissions": []` — missing: `"offscreen"`, `"notifications"`, `"downloads"`, `"storage"`
- No `"background"` key declared → `background.js` service worker never loads
- No `"content_security_policy"` to allow connecting to `localhost:3000`
- Missing `offscreen.html` reference (the API doesn't require an explicit manifest entry, but permissions are needed)

### Architectural mismatch summary

```
Current (broken):
  popup.js ──fetch──▶ /api/qr  (❌ doesn't exist)
  popup.js ──SSE────▶ /events  (❌ doesn't exist)
  offscreen.js ──Socket.IO──▶ server  (✅ works, but never called)
  background.js (never loads — not in manifest)

Required:
  offscreen.js ──Socket.IO──▶ server  (persistent peer connection)
  popup.js ──chrome.runtime.sendMessage──▶ offscreen.js  (query state, send commands)
  background.js ──service worker──▶ creates offscreen doc on startup, handles notifications
```

## Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | **Offscreen document may be killed** by Chrome under memory pressure | Medium | Re-create on demand in background.js + before any popup interaction |
| 2 | **File buffers can't transfer via message passing** for large files (>128MB Chrome message limit) | Medium | Keep using the existing pattern where popup reads files → sends ArrayBuffers to offscreen; chunk if needed |
| 3 | **CORS / CSP blocks** Socket.IO connection from extension context | Low | Already using `host_permissions` for `localhost:3000`; add `connect-src` to CSP if needed |
| 4 | **Popup closes mid-transfer** losing UI state | Low | Transfer continues in offscreen.js; popup re-queries state on reopen |

## Options (3)

### Option A — Minimal Fix: Wire popup to offscreen (Recommended)
**Rewrite `popup.js`** to be a thin UI layer that:
1. On open: sends `init-offscreen` to background → sends `query-state` to offscreen → renders device list, status, and history from the returned state
2. Listens for `state-update` messages from offscreen to live-update the UI
3. On device click → opens file picker → sends `send-files-request` to offscreen with file metadata + buffers
4. Handles `request-file-buffers` response when offscreen asks for file data

**Fix `manifest.json`** to declare:
- `"background": { "service_worker": "background.js" }`
- `"permissions": ["offscreen", "notifications", "downloads", "storage"]`

**Keep `offscreen.js` and `background.js` mostly as-is** — they already have the correct architecture.

| Pros | Cons |
|------|------|
| Minimal code changes to working parts | Popup UI needs full rewrite |
| Offscreen + background already correct | — |
| Fastest path to working extension | — |

### Option B — Embed web app in popup via iframe
Load the existing web client (`http://localhost:3000`) inside the popup as an iframe, letting it handle everything.

| Pros | Cons |
|------|------|
| Zero new code needed | Connection dies when popup closes |
| Full feature parity with web | No background file reception |
| | Feels like a hack, not a real extension |
| | CSP may block iframe loading |

### Option C — Full rewrite using popup + background only (no offscreen)
Use `chrome.sockets` API or WebTransport directly from the service worker, avoiding the offscreen document entirely.

| Pros | Cons |
|------|------|
| Simpler architecture | `chrome.sockets` is Chrome OS only |
| No offscreen doc lifecycle issues | Socket.IO requires DOM (XMLHttpRequest / WebSocket) — unavailable in service worker |
| | Massive rewrite for uncertain compatibility |

## Recommendation

**Option A — Minimal Fix: Wire popup to offscreen.**

The offscreen.js and background.js already implement the correct P2P architecture. The only broken piece is `popup.js`, which uses a dead QR/SSE model. The fix is:

1. **Fix `manifest.json`** — add background service worker + permissions
2. **Rewrite `popup.js`** — replace QR/SSE logic with message-passing UI that shows:
   - Connection status (from offscreen state)
   - Nearby device list (click to send files)
   - Active transfer progress
   - Transfer history
3. **Minor tweaks to `offscreen.js`** — ensure `init-offscreen` creates the document if needed
4. **Test end-to-end**: extension sees web client as nearby device → click → pick file → WebRTC transfer succeeds

## Acceptance criteria

- [ ] Extension installs without errors (no manifest warnings)
- [ ] On extension load, background.js creates offscreen document which connects to the WairPlay server via Socket.IO
- [ ] Extension appears in the device list on the web client (`index.html`) and vice versa
- [ ] Clicking a device in the popup opens a file picker, and selecting files initiates a `send-file-request`
- [ ] Incoming file requests show a Chrome system notification with Accept/Decline buttons
- [ ] Accepted transfers complete via WebRTC data channel and save to downloads
- [ ] Transfer progress is visible in the popup (if open) during send/receive
- [ ] History of transfers persists across popup open/close
- [ ] Popup re-opening mid-transfer correctly shows current transfer state
