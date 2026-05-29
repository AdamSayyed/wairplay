# WairPlay Technical Documentation & Architecture

## 1. System Overview

**WairPlay** is a peer-to-peer (P2P) file transfer application designed to work seamlessly across devices on the same local network. It operates similarly to Apple's AirDrop but is entirely cross-platform, working via a standard web browser and a dedicated Google Chrome Extension. 

Because it uses WebRTC, file data flows directly between devices (peer-to-peer) at maximum network speed. The central server is only used to help devices find each other and negotiate the connection.

---

## 2. High-Level Architecture

The system consists of three distinct components:

1. **Signaling Server (Node.js + Socket.IO)**: Acts as the central hub for device discovery and connection negotiation. It does NOT touch, store, or relay the actual file data.
2. **Web Client (HTML / Vanilla JS)**: A responsive browser interface allowing users to send and receive files by visiting the server's local IP address.
3. **Chrome Extension (Manifest V3)**: A browser extension providing a persistent background presence, allowing users to be discoverable and receive files even when the WairPlay web app tab is closed.

---

## 3. Communication Protocols

- **Socket.IO (WebSocket)**: Used for real-time, low-latency signaling. It handles device registration, presence updates (online/offline status), and the exchange of WebRTC connection payloads (Offers, Answers, and ICE candidates).
- **WebRTC (Web Real-Time Communication)**: Used for the actual peer-to-peer data transfer. Files are sent over the WebRTC `RTCDataChannel`, ensuring high-speed, encrypted, and direct device-to-device communication without server bandwidth constraints.

---

## 4. Component Deep Dive

### 4.1 Signaling Server (`wairplay/server.js`)
- Runs an Express web server serving the Web Client static files.
- Runs a Socket.IO server on port `3000`.
- Maintains an in-memory array of connected devices (`activeDevices`).
- **Key Socket Events**:
    - `register-device`: Registers a peer and broadcasts the updated `device-list` to all connected clients.
    - `signal`: A generic relay for WebRTC signaling data between two specific peers.
    - `send-file-request`, `accept-file`, `reject-file`: Orchestrates the user-facing permission flow before a WebRTC connection is attempted.

### 4.2 Web Client (`wairplay/public/`)
- **`app.js`**: Core logic for the web interface. Manages the Socket.IO connection, renders the device list UI, and orchestrates the WebRTC lifecycle.
- **`webrtc.js`**: A wrapper class (`WairPlayPeer`) abstracting the complexity of the native `RTCPeerConnection` setup, ICE candidate handling, and DataChannel creation.
- **`transfer.js`**: A utility class (`WairPlayTransfer`) responsible for chunking large files into smaller `ArrayBuffer` payloads for sending over the DataChannel, and reassembling incoming chunks back into a unified `Blob`.

### 4.3 Chrome Extension (`wairplay-extension/`)
Built using Chrome's modern **Manifest V3** architecture. Because Manifest V3 strictly limits background execution and prohibits certain APIs (like WebRTC) in Service Workers, the extension uses a multi-layered architecture:

- **`background.js` (Service Worker)**:
    - An ephemeral script that wakes up on browser events.
    - Responsible for creating and ensuring the lifecycle of the `offscreen` document.
    - Listens for incoming file transfer requests and displays native Chrome System Notifications (`chrome.notifications`) prompting the user to Accept or Decline.
- **`offscreen.html` / `offscreen.js` (Offscreen Document)**:
    - A persistent, hidden DOM context. This is required because Service Workers cannot maintain persistent WebSocket connections reliably or use WebRTC.
    - Maintains the actual Socket.IO connection to the Signaling Server.
    - Manages the WebRTC `RTCPeerConnection` and utilizes `transfer.js` and `webrtc.js`.
    - Uses the `chrome.downloads` API to save received file Blobs directly to the user's computer silently.
- **`popup.html` / `popup.js` (Action Popup)**:
    - A thin "dumb" UI client. It contains NO network logic.
    - Uses `chrome.runtime.sendMessage` to poll the offscreen document for the current state (device list, transfer progress, history).
    - When a user selects a file to send, the popup reads the file into `ArrayBuffer`s and passes them via internal Chrome messages to the offscreen document. This prevents the extension from hitting Manifest V3 file access limitations.

---

## 5. Transfer Lifecycle Data Flow (E2E)

Here is the step-by-step flow of how a file moves from Device A to Device B:

1. **Discovery**: 
   Both Sender and Receiver connect to the Signaling Server via Socket.IO and emit `register-device`. The server broadcasts the updated `device-list` to everyone.
2. **Request**: 
   Sender selects a file and a target device in the UI. The Sender emits a `send-file-request` event via Socket.IO.
3. **Notification**: 
   The Signaling Server relays the request to the Receiver.
   - *If Receiver is Web Client*: Displays an HTML modal overlay.
   - *If Receiver is Extension*: The Offscreen doc relays the event to the Background SW, which triggers a native Chrome Desktop Notification.
4. **Acceptance**: 
   Receiver clicks "Accept". The Receiver emits an `accept-file` event via Socket.IO.
5. **WebRTC Negotiation**: 
   - The Receiver creates an `RTCPeerConnection` and waits.
   - The Sender creates an `RTCPeerConnection`, opens a DataChannel (`"files"`), and generates an SDP Offer.
   - The SDP Offer is sent via Socket.IO -> Receiver.
   - The Receiver processes the Offer and generates an SDP Answer -> Sender.
   - Both peers exchange ICE Candidates via Socket.IO to find the best direct network path.
6. **Data Transfer**: 
   Once the WebRTC DataChannel is open, the Sender chunks the file and sends it over the direct P2P connection.
7. **Completion**: 
   The Receiver reassembles the chunks into a final `Blob`. 
   - *Web Client*: Creates an `<a>` tag with `URL.createObjectURL` to trigger a browser download.
   - *Extension*: Uses `chrome.downloads.download()` to save the file.
