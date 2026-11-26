(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.SPSArena = root.SPSArena || {};
        root.SPSArena.OnlineClient = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const SESSION_KEY = "sps_online_session_v1";

    class OnlineClient {
        constructor() {
            this.socket = null;
            this.session = this._loadSession();
            this.onState = null;
            this.onRoundResult = null;
            this.onRoomClosed = null;
            this.onConnectionChange = null;
        }

        isAvailable() {
            return typeof window !== "undefined" && typeof window.io === "function";
        }

        _loadSession() {
            try {
                if (typeof sessionStorage !== "undefined") {
                    const raw = sessionStorage.getItem(SESSION_KEY);
                    if (raw) return JSON.parse(raw);
                }
            } catch {
                // ignore
            }
            return null;
        }

        _saveSession(sess) {
            this.session = sess;
            try {
                if (typeof sessionStorage !== "undefined") {
                    if (sess) sessionStorage.setItem(SESSION_KEY, JSON.stringify(sess));
                    else sessionStorage.removeItem(SESSION_KEY);
                }
            } catch {
                // ignore
            }
        }

        connect() {
            if (!this.isAvailable()) return false;
            if (this.socket) return true;

            this.socket = window.io();

            this.socket.on("connect", () => {
                if (typeof this.onConnectionChange === "function") this.onConnectionChange(true);
                if (this.session && this.session.roomCode && this.session.playerId && this.session.reconnectToken) {
                    this.socket.emit("room:reconnect", this.session, (res) => {
                        if (!res || !res.ok) {
                            this._saveSession(null);
                        } else if (typeof this.onState === "function") {
                            this.onState(res.state);
                        }
                    });
                }
            });

            this.socket.on("disconnect", () => {
                if (typeof this.onConnectionChange === "function") this.onConnectionChange(false);
            });

            this.socket.on("room:state", (state) => {
                if (typeof this.onState === "function") this.onState(state);
            });

            this.socket.on("match:round_result", (payload) => {
                if (typeof this.onRoundResult === "function") this.onRoundResult(payload);
            });

            this.socket.on("room:closed", (payload) => {
                this._saveSession(null);
                if (typeof this.onRoomClosed === "function") this.onRoomClosed(payload);
            });

            return true;
        }

        _emit(event, payload) {
            return new Promise((resolve) => {
                if (!this.connect()) {
                    resolve({ ok: false, error: "SERVER_UNAVAILABLE" });
                    return;
                }
                this.socket.emit(event, payload || {}, (res) => {
                    resolve(res || { ok: false, error: "NO_RESPONSE" });
                });
            });
        }

        async createRoom(playerName) {
            const res = await this._emit("room:create", { playerName });
            if (res.ok) {
                this._saveSession({
                    roomCode: res.roomCode,
                    playerId: res.playerId,
                    reconnectToken: res.reconnectToken
                });
            }
            return res;
        }

        async joinRoom(roomCode, playerName) {
            const res = await this._emit("room:join", { roomCode, playerName });
            if (res.ok) {
                this._saveSession({
                    roomCode: res.roomCode,
                    playerId: res.playerId,
                    reconnectToken: res.reconnectToken
                });
            }
            return res;
        }

        setBestOf(bestOf) {
            return this._emit("room:settings", { bestOf });
        }

        setReady(ready) {
            return this._emit("room:ready", { ready });
        }

        startMatch() {
            return this._emit("room:start", {});
        }

        submitMove(move) {
            return this._emit("match:move", { move });
        }

        requestRematch() {
            return this._emit("match:rematch", {});
        }

        declineRematch() {
            this._saveSession(null);
            return this._emit("match:decline_rematch", {});
        }

        async leaveRoom() {
            const res = await this._emit("room:leave", {});
            this._saveSession(null);
            return res;
        }
    }

    return { OnlineClient };
});
