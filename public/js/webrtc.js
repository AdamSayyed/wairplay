/* ====================================
   WairPlay — WebRTC Peer Connection Manager
   Stub — will be fully implemented in Step 5
   ==================================== */

function WairPlayPeer() {
  this.pc = null;
  this._onIceCallback = null;
  this._onDataChannelCallback = null;
  this._onStateChangeCallback = null;
  console.log("[WebRTC] Stub peer created — Step 5 will add full implementation");
}

WairPlayPeer.prototype.onIceCandidate = function (cb) { this._onIceCallback = cb; };
WairPlayPeer.prototype.onDataChannel = function (cb) { this._onDataChannelCallback = cb; };
WairPlayPeer.prototype.onConnectionStateChange = function (cb) { this._onStateChangeCallback = cb; };
WairPlayPeer.prototype.createDataChannel = function (label) { return { onopen: null, close: function () {} }; };
WairPlayPeer.prototype.createOffer = function () { return Promise.resolve(null); };
WairPlayPeer.prototype.handleOffer = function (sdp) { return Promise.resolve(null); };
WairPlayPeer.prototype.handleAnswer = function (sdp) {};
WairPlayPeer.prototype.addIceCandidate = function (candidate) {};
WairPlayPeer.prototype.close = function () {};
