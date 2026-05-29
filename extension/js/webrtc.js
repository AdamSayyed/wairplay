/* ====================================
   WairPlay — WebRTC Peer Connection Manager
   ==================================== */

var STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" }
];

function WairPlayPeer() {
  var self = this;

  this.pc = new RTCPeerConnection({
    iceServers: STUN_SERVERS
  });

  this._onIceCallback = null;
  this._onDataChannelCallback = null;
  this._onStateChangeCallback = null;

  /* --- ICE Candidate gathering --- */
  this.pc.onicecandidate = function (event) {
    if (event.candidate && self._onIceCallback) {
      self._onIceCallback(event.candidate);
    }
  };

  /* --- Incoming data channel (receiver side) --- */
  this.pc.ondatachannel = function (event) {
    console.log("[WebRTC] Incoming data channel:", event.channel.label);
    if (self._onDataChannelCallback) {
      self._onDataChannelCallback(event.channel);
    }
  };

  /* --- Connection state changes --- */
  this.pc.onconnectionstatechange = function () {
    console.log("[WebRTC] Connection state:", self.pc.connectionState);
    if (self._onStateChangeCallback) {
      self._onStateChangeCallback(self.pc.connectionState);
    }
  };

  this.pc.oniceconnectionstatechange = function () {
    console.log("[WebRTC] ICE state:", self.pc.iceConnectionState);
    // Treat ICE failure as connection failure
    if (self.pc.iceConnectionState === "failed" && self._onStateChangeCallback) {
      self._onStateChangeCallback("failed");
    }
  };
}

/* --- Register callbacks --- */
WairPlayPeer.prototype.onIceCandidate = function (cb) {
  this._onIceCallback = cb;
};

WairPlayPeer.prototype.onDataChannel = function (cb) {
  this._onDataChannelCallback = cb;
};

WairPlayPeer.prototype.onConnectionStateChange = function (cb) {
  this._onStateChangeCallback = cb;
};

/* --- Create a data channel (sender side) --- */
WairPlayPeer.prototype.createDataChannel = function (label) {
  var channel = this.pc.createDataChannel(label, {
    ordered: true
  });
  console.log("[WebRTC] Created data channel:", label);
  return channel;
};

/* --- Create SDP offer (sender side) --- */
WairPlayPeer.prototype.createOffer = function () {
  var self = this;
  return this.pc.createOffer().then(function (offer) {
    return self.pc.setLocalDescription(offer).then(function () {
      console.log("[WebRTC] Local offer set");
      return self.pc.localDescription;
    });
  });
};

/* --- Handle incoming SDP offer (receiver side) → returns answer --- */
WairPlayPeer.prototype.handleOffer = function (sdp) {
  var self = this;
  return this.pc.setRemoteDescription(new RTCSessionDescription(sdp)).then(function () {
    console.log("[WebRTC] Remote offer set");
    return self.pc.createAnswer();
  }).then(function (answer) {
    return self.pc.setLocalDescription(answer).then(function () {
      console.log("[WebRTC] Local answer set");
      return self.pc.localDescription;
    });
  });
};

/* --- Handle incoming SDP answer (sender side) --- */
WairPlayPeer.prototype.handleAnswer = function (sdp) {
  this.pc.setRemoteDescription(new RTCSessionDescription(sdp)).then(function () {
    console.log("[WebRTC] Remote answer set");
  }).catch(function (err) {
    console.error("[WebRTC] Error setting remote answer:", err);
  });
};

/* --- Add ICE candidate from remote peer --- */
WairPlayPeer.prototype.addIceCandidate = function (candidate) {
  if (candidate) {
    this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(function (err) {
      console.warn("[WebRTC] Error adding ICE candidate:", err);
    });
  }
};

/* --- Close the peer connection --- */
WairPlayPeer.prototype.close = function () {
  try {
    this.pc.close();
  } catch (e) {}
  console.log("[WebRTC] Peer connection closed");
};
