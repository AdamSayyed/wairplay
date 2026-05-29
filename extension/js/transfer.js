/* ====================================
   WairPlay — File Transfer Engine
   Chunked P2P file transfer over WebRTC DataChannel
   ==================================== */

var WairPlayTransfer = (function () {
  "use strict";

  var CHUNK_SIZE = 64 * 1024; // 64KB chunks
  var MAX_BUFFER = 1024 * 1024; // 1MB buffered amount threshold

  /* ====================================
     SENDER: Send files over data channel
     ==================================== */

  function sendFiles(channel, files, onProgress, onComplete, onError) {
    var totalBytes = 0;
    var sentBytes = 0;

    for (var i = 0; i < files.length; i++) {
      totalBytes += files[i].size;
    }

    var fileIndex = 0;

    function sendNextFile() {
      if (fileIndex >= files.length) {
        // All files sent
        channel.send(JSON.stringify({ type: "all-done" }));
        if (onComplete) onComplete();
        return;
      }

      var file = files[fileIndex];

      // Send file metadata
      channel.send(JSON.stringify({
        type: "file-meta",
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream"
      }));

      var offset = 0;

      function sendChunk() {
        if (offset >= file.size) {
          // File complete
          channel.send(JSON.stringify({ type: "file-end" }));
          fileIndex++;
          sendNextFile();
          return;
        }

        // Backpressure: wait if buffer is full
        if (channel.bufferedAmount > MAX_BUFFER) {
          channel.onbufferedamountlow = function () {
            channel.onbufferedamountlow = null;
            sendChunk();
          };
          channel.bufferedAmountLowThreshold = CHUNK_SIZE;
          return;
        }

        var end = Math.min(offset + CHUNK_SIZE, file.size);
        var slice = file.slice(offset, end);

        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            channel.send(e.target.result);
            sentBytes += (end - offset);
            offset = end;

            if (onProgress) {
              var percent = Math.round((sentBytes / totalBytes) * 100);
              onProgress(percent);
            }

            // Use setTimeout to avoid blocking the UI thread
            setTimeout(sendChunk, 0);
          } catch (err) {
            if (onError) onError(err.message || "Send failed");
          }
        };

        reader.onerror = function () {
          if (onError) onError("Failed to read file chunk");
        };

        reader.readAsArrayBuffer(slice);
      }

      sendChunk();
    }

    sendNextFile();
  }

  /* ====================================
     RECEIVER: Receive files from data channel
     ==================================== */

  function receiveFiles(channel, onFileReceived, onProgress, onAllComplete) {
    var currentFile = null;   // { name, size, mimeType, chunks: [], received: 0 }
    var totalExpected = 0;
    var totalReceived = 0;

    channel.binaryType = "arraybuffer";

    channel.onmessage = function (event) {
      var data = event.data;

      // String messages are JSON control messages
      if (typeof data === "string") {
        var msg;
        try {
          msg = JSON.parse(data);
        } catch (e) {
          console.warn("[Transfer] Invalid JSON:", data);
          return;
        }

        if (msg.type === "file-meta") {
          // Start receiving a new file
          currentFile = {
            name: msg.name,
            size: msg.size,
            mimeType: msg.mimeType,
            chunks: [],
            received: 0
          };
          totalExpected += msg.size;
          console.log("[Transfer] Receiving file:", msg.name, "(" + formatSize(msg.size) + ")");

        } else if (msg.type === "file-end") {
          // Assemble and deliver file
          if (currentFile) {
            var blob = new Blob(currentFile.chunks, { type: currentFile.mimeType });
            console.log("[Transfer] File complete:", currentFile.name);

            if (onFileReceived) {
              onFileReceived({
                name: currentFile.name,
                size: currentFile.size,
                mimeType: currentFile.mimeType,
                blob: blob
              });
            }
            currentFile = null;
          }

        } else if (msg.type === "all-done") {
          console.log("[Transfer] All files received");
          if (onAllComplete) onAllComplete();
        }

      } else if (data instanceof ArrayBuffer) {
        // Binary chunk — append to current file
        if (currentFile) {
          currentFile.chunks.push(data);
          currentFile.received += data.byteLength;
          totalReceived += data.byteLength;

          if (onProgress && totalExpected > 0) {
            var percent = Math.round((totalReceived / totalExpected) * 100);
            onProgress(percent);
          }
        }
      }
    };
  }

  /* ====================================
     HELPER
     ==================================== */

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
    return (bytes / 1073741824).toFixed(2) + " GB";
  }

  /* ====================================
     PUBLIC API
     ==================================== */

  return {
    sendFiles: sendFiles,
    receiveFiles: receiveFiles
  };

})();
