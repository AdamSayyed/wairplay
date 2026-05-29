<p align="center">
  <img src="public/favicon.svg" width="80" alt="WairPlay logo" />
</p>

<h1 align="center">WairPlay</h1>

<p align="center">
  <strong>AirDrop for any device</strong> — peer-to-peer file transfer across Windows, macOS, Linux, iOS & Android.<br/>
  No app install. No cloud upload. Just open a browser.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?logo=node.js" alt="Node >= 18" />
  <img src="https://img.shields.io/badge/WebRTC-P2P-blue?logo=webrtc" alt="WebRTC P2P" />
  <img src="https://img.shields.io/badge/Socket.IO-4.x-black?logo=socket.io" alt="Socket.IO 4" />
  <img src="https://img.shields.io/badge/Chrome_Extension-Manifest_V3-yellow?logo=googlechrome" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
</p>

---

## ✨ What is WairPlay?

WairPlay lets you **send files directly between any two devices** on the same network — like Apple AirDrop, but it works everywhere. Open WairPlay in a browser on both devices, tap the one you want to send to, and pick your files. That's it.

Files travel **directly between your devices** over an encrypted WebRTC data channel. The server only helps devices discover each other — it never sees, stores, or relays your files.

---

## 🚀 Quick Start

```bash
# 1. Clone & install
git clone https://github.com/AdamSayyed/wairplay.git
cd wairplay
npm install

# 2. Start the server
npm run dev

# 3. Open in your browser
#    → http://localhost:3000
```

Now open `http://<your-local-ip>:3000` on a second device (phone, laptop, etc.) connected to the same network. Both devices will see each other automatically.

---

## 📖 How It Works

```
┌──────────┐         Signaling          ┌──────────┐
│ Device A │ ◄──── Socket.IO ────►      │ Device B │
│ (Sender) │         Server             │(Receiver)│
└────┬─────┘     (discovery only)       └────┬─────┘
     │                                       │
     │         WebRTC DataChannel            │
     └───────── direct P2P transfer ─────────┘
                  (your files)
```

| Step | What Happens |
|------|-------------|
| **1. Discover** | Both devices connect to the signaling server via Socket.IO and register themselves. The server groups devices by public IP and broadcasts a live device list. |
| **2. Request** | The sender picks a file and taps the target device. A transfer request is sent through the server. |
| **3. Accept** | The receiver sees an incoming-file prompt and clicks **Accept**. |
| **4. Connect** | Both devices negotiate a WebRTC peer connection (SDP offer/answer + ICE candidates) relayed through the server. |
| **5. Transfer** | The file is chunked and streamed directly over the WebRTC `RTCDataChannel` — **no data touches the server**. |
| **6. Done** | The receiver's browser downloads the reassembled file automatically. |

---

## 🏗️ Architecture

### Three Components

| Component | Tech | Role |
|-----------|------|------|
| **Signaling Server** | Node.js · Express · Socket.IO | Device discovery, presence, WebRTC relay |
| **Web Client** | Vanilla HTML / CSS / JS | Send & receive files from any modern browser |
| **Chrome Extension** | Manifest V3 | Stay discoverable in the background without a tab |

### Project Structure

```
wairplay/
├── server.js                 # Signaling server (Express + Socket.IO)
├── package.json
│
├── public/                   # Web client (served by Express)
│   ├── index.html            # Main app — device radar & file transfer UI
│   ├── send.html             # Mobile sender page (legacy QR flow)
│   ├── favicon.svg
│   ├── css/
│   │   └── style.css         # Design system — glassmorphism dark theme
│   └── js/
│       ├── app.js            # Core client logic — Socket.IO + UI
│       ├── webrtc.js          # WebRTC peer connection wrapper
│       ├── transfer.js        # File chunking & reassembly
│       ├── receiver.js        # Receiver-specific logic
│       └── sender.js          # Sender-specific logic
│
├── extension/                # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js         # Service worker — notifications & offscreen lifecycle
│   ├── offscreen.html/.js    # Hidden document — Socket.IO + WebRTC (persistent)
│   ├── popup.html/.js        # Extension popup UI — device list & settings
│   └── js/
│       ├── webrtc.js          # WebRTC wrapper (extension copy)
│       ├── transfer.js        # File transfer utils (extension copy)
│       └── socket.io.js       # Bundled Socket.IO client
│
└── uploads/                  # Temp storage (git-ignored)
```

---

## 🧩 Chrome Extension

The extension lets you **receive files in the background** without keeping a WairPlay tab open. It uses a multi-layered Manifest V3 architecture:

- **Service Worker** (`background.js`) — manages lifecycle, shows native OS notifications for incoming files
- **Offscreen Document** (`offscreen.js`) — maintains the persistent Socket.IO + WebRTC connection (service workers can't do WebRTC)
- **Popup** (`popup.html`) — lightweight UI for device list, transfer progress, settings, and send-file

### Install the Extension

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder
4. Make sure the WairPlay server is running (`npm run dev`)

---

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server listen port (auto-set by platforms like Render) |

The server binds to `0.0.0.0` for LAN and container compatibility.

### Device Grouping

Devices are grouped by their **public IP address** so only devices on the same network see each other. In local/development mode, all private-range IPs (`10.x`, `172.16–31.x`, `192.168.x`) are grouped together under a single `"local"` bucket.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js ≥ 18 |
| Server | Express 4.x |
| Real-time Signaling | Socket.IO 4.x (WebSocket) |
| File Transfer | WebRTC `RTCDataChannel` (P2P) |
| Frontend | Vanilla HTML / CSS / JS |
| Typography | Google Fonts — Outfit, Inter |
| Design | Glassmorphism dark theme with gradient accents |
| Extension | Chrome Manifest V3 |

---

## 🔒 Privacy & Security

- **No cloud relay** — files are never uploaded to or routed through the server
- **Direct P2P** — data flows over WebRTC's encrypted DTLS/SRTP transport
- **No accounts** — no sign-up, no login, no tracking
- **Ephemeral** — nothing is stored; close the tab and it's gone

---

## 📜 Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the server (production) |
| `npm run dev` | Start with `--watch` for auto-restart on changes |

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit -m "Add my feature"`)
4. Push to your branch (`git push origin feat/my-feature`)
5. Open a Pull Request

---

## 📄 License

MIT — do whatever you want with it.

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/AdamSayyed">Adam Sayyed</a></sub>
</p>
