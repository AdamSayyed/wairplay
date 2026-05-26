# WairPlay P2P Evolution Plan

## Goal

Transform WairPlay from a **server-relay file transfer system** (phone → server → PC) into a **WebRTC peer-to-peer system** (phone ↔ PC directly) with the server acting only as a lightweight **signaling + device presence** layer. This is the Snapdrop/AirDrop model.

## Assumptions

1. The existing glassmorphic design system (`style.css`) will be preserved and extended — not replaced.
2. Socket.IO will replace SSE for real-time communication (required for bidirectional signaling).
3. We use free Google STUN servers for NAT traversal; TURN server is deferred to a future phase.
4. Devices are grouped as "nearby" by **same public IP** (same network).
5. The old QR-code + relay flow will be removed once P2P is working.
6. Vanilla JS only (no React) — consistent with the current codebase.
7. The browser extension is left untouched in this phase (can be updated later).
8. File chunking at 64KB for reliable WebRTC DataChannel transfer.

---

## Plan

### Step 1 — Add Socket.IO and Refactor Server Foundation

| | |
|---|---|
| **Files** | `package.json`, `server.js` |
| **Change** | Install `socket.io`. Refactor `server.js` to create an HTTP server (`http.createServer(app)`) and attach Socket.IO to it. Keep Express for static file serving. Remove `multer`, `qrcode`, `uuid` dependencies (no longer needed). Remove all old REST API routes (`/api/session/*`), the `uploads/` directory logic, and the SSE broadcast system. The server becomes minimal: Express static serving + Socket.IO. |
| **Verify** | `npm start` — server boots without errors, serves `public/` files, Socket.IO endpoint accessible at `/socket.io/`. Run `node -e "const io = require('socket.io-client')('http://localhost:3000'); io.on('connect', () => { console.log('OK'); process.exit(0); })"` to confirm Socket.IO handshake works. |

---

### Step 2 — Build Device Presence System (Server)

| | |
|---|---|
| **Files** | `server.js` |
| **Change** | Add a `devices` Map on the server. On Socket.IO `connection`: extract public IP from `socket.handshake` headers (`x-forwarded-for` or `socket.handshake.address`). Listen for `register-device` event with `{ deviceName }`. Store `{ socketId, deviceName, publicIP, lastSeen }` in the Map keyed by `socketId`. Emit `device-list` to all sockets sharing the same public IP whenever a device joins/leaves. On `disconnect`: remove device, re-broadcast updated list to same-IP peers. Add a heartbeat: devices emit `heartbeat` every 15s; server updates `lastSeen`. Stale devices (>45s) are pruned. |
| **Verify** | Open two browser tabs to `http://localhost:3000`. Both should receive a `device-list` event listing each other. Close one tab — the other should receive an updated list with only itself. Check server console logs for register/disconnect events. |

---

### Step 3 — Build New Landing Page (Device Discovery UI)

| | |
|---|---|
| **Files** | `public/index.html`, `public/js/app.js` (new), `public/css/style.css` |
| **Change** | **Replace** `index.html` content with a new Snapdrop-inspired landing page. Design: centered logo + tagline at top, animated radar/pulse ring in the center, nearby device avatars arranged in a circle around the pulse (like Snapdrop). Each device shows an icon (💻 or 📱 based on user-agent) and device name. Clicking a device opens a file picker. Add Socket.IO client script (`/socket.io/socket.io.js`). New `app.js` handles: connect to Socket.IO, emit `register-device` with auto-detected device name (from `navigator.userAgent` — parse "iPhone", "Windows", "Mac", etc.), listen for `device-list` events and render device avatars. Add CSS for the device circle layout, radar animation, and device avatar hover effects. |
| **Verify** | Open `http://localhost:3000` in two browsers/tabs. Both should show each other as nearby devices. Device names should reflect browser/OS. Clicking a device should open a file picker (no transfer yet). |

---

### Step 4 — WebRTC Signaling Server

| | |
|---|---|
| **Files** | `server.js` |
| **Change** | Add Socket.IO event handlers for WebRTC signaling: `signal` event receives `{ targetSocketId, data }` where `data` is an SDP offer, SDP answer, or ICE candidate. Server relays the message: `io.to(targetSocketId).emit('signal', { from: socket.id, data })`. Add `send-file-request` event: sender emits `{ targetSocketId, files: [{ name, size, type }] }`. Server relays to target as `file-request` with `{ from, files }`. Add `accept-file` / `reject-file` events that relay back to the sender. This is the complete signaling layer — very lightweight. |
| **Verify** | Manually emit `signal` events from browser console on two tabs. Confirm the relay arrives at the target tab's Socket.IO listener. Check server logs show relay activity. |

---

### Step 5 — WebRTC Peer Connection Manager (Client)

| | |
|---|---|
| **Files** | `public/js/webrtc.js` (new) |
| **Change** | Create a `PeerConnection` class/module that encapsulates: creating `RTCPeerConnection` with Google STUN servers (`stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302`). Methods: `createOffer()` — creates offer, sets local description, returns SDP. `handleOffer(sdp)` — sets remote description, creates answer, returns answer SDP. `handleAnswer(sdp)` — sets remote description. `addIceCandidate(candidate)` — adds ICE candidate. Event hooks: `onIceCandidate(callback)` — fires when local ICE candidate is generated. `onDataChannel(callback)` — fires when remote opens a data channel. `createDataChannel(label)` — creates and returns a data channel. `onConnectionStateChange(callback)`. Wire ICE candidates to Socket.IO: when `onicecandidate` fires, emit via `signal` event to the target peer. |
| **Verify** | In two browser tabs, trigger offer/answer exchange via console. Confirm `RTCPeerConnection` reaches `connected` state. Console log ICE candidates being exchanged. Confirm a DataChannel can be opened between the two tabs. |

---

### Step 6 — File Transfer Engine (Client)

| | |
|---|---|
| **Files** | `public/js/transfer.js` (new) |
| **Change** | Create a `FileTransfer` module. **Sender side**: `sendFiles(dataChannel, fileList)` — for each file: first send a JSON metadata message `{ type: 'file-meta', name, size, mimeType }`, then slice file into 64KB chunks using `file.slice(offset, offset + 65536)`, read each chunk as `ArrayBuffer` via `FileReader`, send via `dataChannel.send(chunk)`, send `{ type: 'file-end' }` JSON when done. Implement backpressure: check `dataChannel.bufferedAmount` before sending; if high, wait for `bufferedamountlow` event. Track progress (bytes sent / total) and expose via callback. **Receiver side**: `receiveFiles(dataChannel, onFileReceived, onProgress)` — listen for `onmessage`. If message is string, parse JSON for `file-meta` or `file-end`. If `ArrayBuffer`, accumulate chunks into an array. On `file-end`, assemble chunks into a `Blob`, create object URL, trigger download. Expose progress callback. |
| **Verify** | Using two tabs with an established DataChannel (from Step 5), select a small test file (~1MB) and transfer it. Confirm the file downloads correctly on the receiver, file name matches, file content is intact (checksum optional). Test with a 50MB+ file to verify chunking and progress. |

---

### Step 7 — Sender Flow (Complete Client Integration)

| | |
|---|---|
| **Files** | `public/js/app.js` |
| **Change** | Wire the full sender flow in `app.js`: (1) User clicks a device avatar → file picker opens. (2) User selects file(s) → emit `send-file-request` via Socket.IO with file metadata and target socket ID. (3) Wait for `file-accepted` event from target. (4) On acceptance: create `PeerConnection`, create data channel, create offer, send via signaling. (5) Handle answer and ICE candidates from signaling. (6) Once DataChannel opens: use `FileTransfer.sendFiles()`. (7) Show progress overlay on the sender's screen (reuse circular progress from existing `send.html` design). (8) On completion: show success state. Add UI states: "Waiting for acceptance…", "Connecting…", "Transferring… X%", "Sent ✓". |
| **Verify** | Open two tabs. On Tab A, click Tab B's device avatar, select a file. Tab B should receive a file request notification. On acceptance, transfer should begin. Sender tab shows progress and completes successfully. |

---

### Step 8 — Receiver Flow (Accept/Download UI)

| | |
|---|---|
| **Files** | `public/js/app.js`, `public/index.html`, `public/css/style.css` |
| **Change** | Add receiver UI: when `file-request` arrives via Socket.IO, show a modal/toast overlay: "📱 [DeviceName] wants to send [filename] ([size])" with Accept / Decline buttons. On Accept: emit `accept-file`, create `PeerConnection`, wait for offer via signaling, handle offer, send answer back via signaling, handle ICE. When DataChannel opens: use `FileTransfer.receiveFiles()` to accumulate and auto-download. Show progress bar during transfer. On completion: show "File received ✓" with download link (in case auto-download was blocked). On Decline: emit `reject-file`. Style the modal with glassmorphic overlay consistent with existing design. Add notification sound/vibration on file request (`navigator.vibrate` for mobile). |
| **Verify** | Full end-to-end test: Tab A sends file to Tab B. Tab B sees accept/decline modal. Accept → transfer completes → file auto-downloads on Tab B. Decline → sender sees "Declined" message. Test with multiple files. |

---

### Step 9 — Cleanup Old Relay Code and Files

| | |
|---|---|
| **Files** | `server.js`, `public/send.html`, `public/js/sender.js`, `public/js/receiver.js`, `package.json`, `uploads/` |
| **Change** | Delete `public/send.html` (no longer needed — everything is on `index.html`). Delete `public/js/sender.js` and `public/js/receiver.js` (replaced by `app.js`, `webrtc.js`, `transfer.js`). Delete `uploads/` directory. Remove `multer`, `qrcode`, `uuid` from `package.json` dependencies (if not already done in Step 1). Run `npm install` to clean `node_modules`. Update `package.json` description to reflect the new P2P architecture. Ensure `server.js` has no leftover REST routes or file storage logic. |
| **Verify** | `npm start` — clean boot, no errors, no warnings about missing modules. Browse to `http://localhost:3000` — landing page loads. Old routes (`/api/session/*`) return 404. `uploads/` directory does not exist. `git status` shows clean removal of old files. |

---

### Step 10 — End-to-End Integration Testing and Polish

| | |
|---|---|
| **Files** | All files (read-only review + minor fixes) |
| **Change** | Test the complete flow across multiple scenarios: (1) Two tabs in same browser. (2) Two different browsers on same machine. (3) Phone browser + PC browser on same WiFi (same public IP — should see each other). Verify: device discovery, file request/accept/decline, WebRTC connection establishment, file transfer with progress, auto-download, multiple sequential transfers. Add graceful error handling: connection timeout (show "Could not connect — try again"), DataChannel close mid-transfer (show "Transfer interrupted"), device goes offline during transfer. Add "Send another" flow after successful transfer. Polish animations and transitions. |
| **Verify** | All 3 test scenarios work end-to-end. Error cases show user-friendly messages. No console errors. Transfer speed is noticeably faster than the old relay approach. Server CPU/memory usage is minimal during transfer (only signaling, no file data). |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **WebRTC blocked by strict NAT/firewall** | P2P connection fails between some devices | Use multiple STUN servers. Log connection failures. Plan TURN server fallback as a future phase. Show clear error message to user. |
| **DataChannel message size limits** | Large chunks may fail on some browsers | Use conservative 64KB chunks (well within limits). Add error handling per chunk. |
| **Same public IP detection fails behind CGNAT** | Devices on different networks appear "nearby" | Acceptable for now — no security risk since file transfer requires explicit acceptance. Can add LAN detection later. |
| **Mobile Safari WebRTC quirks** | DataChannel may behave differently on iOS Safari | Test early on iOS Safari. Use well-supported WebRTC APIs only. Avoid experimental features. |
| **Concurrent transfers between multiple peers** | State management becomes complex | Keep PeerConnection instances isolated per transfer. Clean up connections after transfer completes. |
| **Breaking the existing extension** | Extension relies on old REST API | Extension is out of scope for this plan. It will need a separate update to use Socket.IO + WebRTC. |

## Rollback Plan

1. All changes are incremental and can be reverted via `git revert` or `git checkout`.
2. The old `server.js`, `sender.js`, `receiver.js`, `send.html`, and `index.html` are preserved in git history.
3. To rollback: `git stash` (or `git checkout .`) to restore the relay-based version. Re-run `npm install` to restore `multer`/`qrcode`/`uuid`. Server starts as before.
4. The old `uploads/` directory is auto-created by the old server, so no manual restoration needed.
