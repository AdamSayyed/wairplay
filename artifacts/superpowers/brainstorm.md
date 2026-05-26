## Goal
Create a browser extension version of WairPlay in a separate project that allows users to receive files directly into their browser without needing to keep a specific web page open.

## Constraints
- The extension must be built in a separate project (a new directory/repo).
- Browser extensions cannot natively host local HTTP servers (like Node.js) to receive files.
- Files must be transferred securely from the sender (mobile device) to the extension.
- Cross-Origin Resource Sharing (CORS) must be configured correctly if the extension communicates with the existing hosted backend server.

## Known context
- WairPlay currently relies on an Express server to manage sessions, handle file uploads, and use Server-Sent Events (SSE) to notify the receiver.
- The receiver side currently uses a web UI that displays a QR code and listens for SSE to trigger auto-downloads.
- Modern browser extensions (Manifest V3) have background service workers that manage events and can use the `chrome.downloads` API to save files seamlessly.

## Risks
- **Network Architecture:** If the extension acts purely as a client, it requires a hosted relay server (like the current Render deployment) to handle the mobile uploads.
- **Background Persistence:** Modern browsers use Manifest V3 Service Workers, which can go to sleep after 30 seconds of inactivity. Keeping an SSE connection alive in the background script might be challenging and require workarounds (like periodic pings).
- **Large File Limits:** If files are routed through a free hosted backend, there might be bandwidth or temporary storage limits compared to a pure local server.

## Options (2–4)
1. **Client-Extension to Existing Backend:** The extension acts exactly like the current `receiver.js`. The extension popup shows the QR code and the background script establishes the SSE connection to the existing deployed WairPlay server. When a file is uploaded to the server, the background script downloads it using `chrome.downloads.download`.
   - *Pros:* Reuses the existing backend. Quickest to implement.
   - *Cons:* SSE connection might drop if the service worker goes to sleep.
2. **WebRTC Peer-to-Peer Extension:** The extension and mobile device connect via a lightweight signaling server and transfer files directly peer-to-peer using WebRTC Data Channels.
   - *Pros:* No file size limits on the backend. True direct transfer. No temporary cloud storage needed.
   - *Cons:* Much more complex to build. Requires a new signaling server and handling NAT traversal (STUN/TURN).
3. **Standalone Desktop App (Electron/Tauri) instead of Extension:** Build a lightweight desktop app that runs in the system tray and actually hosts the local Express server.
   - *Pros:* Fully replicates the local server experience. No cloud dependency. True local network transfer.
   - *Cons:* Not a browser extension.

## Recommendation
**Option 1 (Client-Extension to Existing Backend)** is the most practical first step. It leverages the existing deployed WairPlay server and focuses purely on building the Chrome extension frontend. The extension will use a Manifest V3 structure: presenting the QR code in the browser popup, and utilizing the background script (Service Worker) to manage the SSE connection and handle downloads via the `chrome.downloads` API, ensuring files download even if the popup is closed.

## Acceptance criteria
- A new project folder is created for the extension.
- The extension contains a popup UI that requests a session from the WairPlay backend and displays a QR code.
- The extension's background script maintains the connection and listens for incoming files.
- When a file is uploaded from a mobile device, the extension successfully triggers a background download to the user's PC.
