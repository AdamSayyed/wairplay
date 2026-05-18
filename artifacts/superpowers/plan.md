# Web AirDrop for Windows (MVP) — Updated Plan

**UX Change:** Chrome Extension popup pattern. Click icon → QR pops up → scan → transfer.

**Architecture:**
1. Node.js server (local background) — Socket.IO + file writing
2. Chrome Extension popup — shows QR, status, progress
3. iPhone Safari page — sender (served by Node.js)

## Tasks
1. Init project + npm install
2. Local IP utility
3. Express + Socket.IO server (full backend)
4. Premium CSS design system
5. iPhone sender page (send.html + sender.js)
6. Chrome extension (manifest + popup + popup.js)
7. End-to-end test

**Status:** APPROVED with Chrome Extension modification. Executing now.
