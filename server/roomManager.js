"use strict";

const crypto = require("crypto");
const Engine = require("../js/engine.js");

const VALID_ONLINE_BEST_OF = [3, 5, 7];
const DEFAULT_RECONNECT_TIMEOUT_MS = 60000;
const DEFAULT_ROOM_TTL_MS = 30 * 60 * 1000; // 30 minutes idle/expired cleanup
const RATE_WINDOW_MS = 60 * 1000;
const MAX_CREATES_PER_WINDOW = 10;
const MAX_JOIN_FAILS_PER_WINDOW = 15;

// Private server-side storage for unrevealed moves & reconnect secrets
const privateRoomSecrets = new WeakMap();

class RoomManager {
    constructor(options = {}) {
        this.rooms = new Map();
        this.reconnectTimeoutMs = typeof options.reconnectTimeoutMs === "number"
            ? options.reconnectTimeoutMs
            : DEFAULT_RECONNECT_TIMEOUT_MS;
        this.roomTtlMs = typeof options.roomTtlMs === "number"
            ? options.roomTtlMs
            : DEFAULT_ROOM_TTL_MS;
        this.createRateMap = new Map();
        this.joinFailRateMap = new Map();
        this._matchSeq = 0;
    }

    _generateRoomCode() {
        for (let i = 0; i < 50; i++) {
            const code = String(crypto.randomInt(100000, 1000000));
            if (!this.rooms.has(code)) return code;
        }
        throw new Error("ROOM_CODE_EXHAUSTED");
    }

    _checkRateLimit(map, key, maxCount) {
        if (!key) return true;
        const now = Date.now();
        const entry = map.get(key);
        if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
            map.set(key, { windowStart: now, count: 1 });
            return true;
        }
        if (entry.count >= maxCount) return false;
        entry.count += 1;
        return true;
    }

    _sanitizeName(name, fallback) {
        if (typeof name !== "string") return fallback;
        const trimmed = name.trim().replace(/[<>]/g, "").slice(0, 20);
        return trimmed || fallback;
    }

    _nextMatchId(roomCode) {
        this._matchSeq += 1;
        return `online_${roomCode}_${Date.now()}_${this._matchSeq}`;
    }

    _getSecrets(room) {
        return privateRoomSecrets.get(room);
    }

    _touch(room) {
        room.updatedAt = Date.now();
    }

    createRoom({ playerName, rateKey } = {}) {
        this.cleanupExpiredRooms();
        if (!this._checkRateLimit(this.createRateMap, rateKey, MAX_CREATES_PER_WINDOW)) {
            return { ok: false, error: "RATE_LIMITED" };
        }

        const roomCode = this._generateRoomCode();
        const playerId = crypto.randomUUID();
        const reconnectToken = crypto.randomBytes(24).toString("hex");
        const cleanName = this._sanitizeName(playerName, "Player 1");

        const room = {
            roomCode,
            hostId: playerId,
            status: "waiting", // waiting | lobby | playing | completed | abandoned
            bestOf: 3,
            targetWins: 2,
            round: 0,
            matchId: this._nextMatchId(roomCode),
            matchWinnerId: null,
            abandonReason: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            players: [
                {
                    id: playerId,
                    slot: 1,
                    name: cleanName,
                    score: 0,
                    ready: false,
                    connected: true,
                    hasSubmittedMove: false
                }
            ],
            rematchVotes: new Set()
        };

        privateRoomSecrets.set(room, {
            tokens: new Map([[playerId, reconnectToken]]),
            pendingMoves: new Map(),
            reconnectTimers: new Map()
        });

        this.rooms.set(roomCode, room);

        return {
            ok: true,
            roomCode,
            playerId,
            reconnectToken,
            state: this.getPublicState(roomCode, playerId)
        };
    }

    joinRoom({ roomCode, playerName, rateKey } = {}) {
        if (typeof roomCode !== "string" || !/^\d{6}$/.test(roomCode.trim())) {
            this._checkRateLimit(this.joinFailRateMap, rateKey, MAX_JOIN_FAILS_PER_WINDOW);
            return { ok: false, error: "INVALID_ROOM_CODE" };
        }
        const code = roomCode.trim();
        const room = this.rooms.get(code);

        if (!room) {
            this.cleanupExpiredRooms();
            if (!this._checkRateLimit(this.joinFailRateMap, rateKey, MAX_JOIN_FAILS_PER_WINDOW)) {
                return { ok: false, error: "RATE_LIMITED" };
            }
            return { ok: false, error: "ROOM_NOT_FOUND" };
        }

        if (this._isExpired(room)) {
            this._destroyRoom(code);
            return { ok: false, error: "ROOM_EXPIRED" };
        }

        if (room.status === "abandoned") {
            return { ok: false, error: "ROOM_EXPIRED" };
        }

        if (room.players.length >= 2) {
            return { ok: false, error: "ROOM_FULL" };
        }

        if (room.status !== "waiting") {
            return { ok: false, error: "MATCH_ALREADY_STARTED" };
        }

        const playerId = crypto.randomUUID();
        const reconnectToken = crypto.randomBytes(24).toString("hex");
        const cleanName = this._sanitizeName(playerName, "Player 2");

        room.players.push({
            id: playerId,
            slot: 2,
            name: cleanName,
            score: 0,
            ready: false,
            connected: true,
            hasSubmittedMove: false
        });
        room.status = "lobby";
        this._touch(room);

        const secrets = this._getSecrets(room);
        secrets.tokens.set(playerId, reconnectToken);

        return {
            ok: true,
            roomCode: code,
            playerId,
            reconnectToken,
            state: this.getPublicState(code, playerId)
        };
    }

    _getRoomAndPlayer(roomCode, playerId) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: "ROOM_NOT_FOUND" };
        if (room.status === "abandoned") return { error: "ROOM_ABANDONED" };
        const player = room.players.find((p) => p.id === playerId);
        if (!player) return { error: "UNAUTHORIZED_PLAYER" };
        return { room, player };
    }

    setBestOf({ roomCode, playerId, bestOf } = {}) {
        const found = this._getRoomAndPlayer(roomCode, playerId);
        if (found.error) return { ok: false, error: found.error };
        const { room } = found;

        if (room.hostId !== playerId) {
            return { ok: false, error: "HOST_ONLY" };
        }
        if (room.status !== "waiting" && room.status !== "lobby") {
            return { ok: false, error: "SETTINGS_LOCKED" };
        }
        if (!VALID_ONLINE_BEST_OF.includes(bestOf)) {
            return { ok: false, error: "INVALID_BEST_OF" };
        }

        room.bestOf = bestOf;
        room.targetWins = Math.ceil(bestOf / 2);
        this._touch(room);
        return { ok: true, state: this.getPublicState(roomCode, playerId) };
    }

    setReady({ roomCode, playerId, ready } = {}) {
        const found = this._getRoomAndPlayer(roomCode, playerId);
        if (found.error) return { ok: false, error: found.error };
        const { room, player } = found;

        if (room.status !== "lobby" && room.status !== "waiting") {
            return { ok: false, error: "INVALID_ROOM_STATE" };
        }

        player.ready = Boolean(ready);
        this._touch(room);
        return { ok: true, state: this.getPublicState(roomCode, playerId) };
    }

    startMatch({ roomCode, playerId } = {}) {
        const found = this._getRoomAndPlayer(roomCode, playerId);
        if (found.error) return { ok: false, error: found.error };
        const { room } = found;

        if (room.hostId !== playerId) {
            return { ok: false, error: "HOST_ONLY" };
        }
        if (room.status !== "lobby" || room.players.length !== 2) {
            return { ok: false, error: "NEED_TWO_PLAYERS" };
        }
        if (!room.players.every((p) => p.connected && p.ready)) {
            return { ok: false, error: "PLAYERS_NOT_READY" };
        }

        this._beginMatch(room);
        return { ok: true, state: this.getPublicState(roomCode, playerId) };
    }

    _beginMatch(room) {
        const secrets = this._getSecrets(room);
        secrets.pendingMoves.clear();
        room.status = "playing";
        room.round = 1;
        room.matchWinnerId = null;
        room.rematchVotes.clear();
        room.players.forEach((p) => {
            p.score = 0;
            p.hasSubmittedMove = false;
        });
        this._touch(room);
    }

    submitMove({ roomCode, playerId, move } = {}) {
        const found = this._getRoomAndPlayer(roomCode, playerId);
        if (found.error) return { ok: false, error: found.error };
        const { room, player } = found;

        if (room.status !== "playing") {
            return { ok: false, error: "MATCH_NOT_ACTIVE" };
        }
        if (!Engine.isValidChoice(move)) {
            return { ok: false, error: "INVALID_MOVE" };
        }

        const secrets = this._getSecrets(room);
        if (secrets.pendingMoves.has(playerId) || player.hasSubmittedMove) {
            return { ok: false, error: "DUPLICATE_MOVE" };
        }

        secrets.pendingMoves.set(playerId, move);
        player.hasSubmittedMove = true;
        this._touch(room);

        if (secrets.pendingMoves.size < 2) {
            return {
                ok: true,
                bothSubmitted: false
            };
        }

        // Both moves received: resolve authoritatively on server
        const p1 = room.players[0];
        const p2 = room.players[1];
        const p1Move = secrets.pendingMoves.get(p1.id);
        const p2Move = secrets.pendingMoves.get(p2.id);

        const resolved = Engine.resolveRound(p1Move, p2Move);
        secrets.pendingMoves.clear();
        p1.hasSubmittedMove = false;
        p2.hasSubmittedMove = false;

        const completedRound = room.round;
        let roundWinnerId = null;
        if (resolved.winner === "p1") {
            p1.score += 1;
            roundWinnerId = p1.id;
        } else if (resolved.winner === "p2") {
            p2.score += 1;
            roundWinnerId = p2.id;
        }

        let matchCompleted = false;
        if (p1.score >= room.targetWins) {
            room.status = "completed";
            room.matchWinnerId = p1.id;
            matchCompleted = true;
        } else if (p2.score >= room.targetWins) {
            room.status = "completed";
            room.matchWinnerId = p2.id;
            matchCompleted = true;
        } else {
            room.round += 1;
        }

        this._touch(room);

        return {
            ok: true,
            bothSubmitted: true,
            matchCompleted,
            roundResult: {
                round: completedRound,
                p1Id: p1.id,
                p2Id: p2.id,
                p1Move,
                p2Move,
                winnerId: roundWinnerId,
                isDraw: resolved.winner === "draw",
                reason: resolved.reason
            }
        };
    }

    requestRematch({ roomCode, playerId } = {}) {
        const found = this._getRoomAndPlayer(roomCode, playerId);
        if (found.error) return { ok: false, error: found.error };
        const { room } = found;

        if (room.status !== "completed") {
            return { ok: false, error: "MATCH_NOT_COMPLETED" };
        }
        if (room.players.length !== 2 || !room.players.every((p) => p.connected)) {
            return { ok: false, error: "OPPONENT_UNAVAILABLE" };
        }

        room.rematchVotes.add(playerId);
        this._touch(room);

        if (room.rematchVotes.size === 2) {
            room.matchId = this._nextMatchId(roomCode);
            this._beginMatch(room);
            return { ok: true, rematchStarted: true };
        }

        return { ok: true, rematchStarted: false, votes: room.rematchVotes.size };
    }

    declineRematch({ roomCode, playerId } = {}) {
        const found = this._getRoomAndPlayer(roomCode, playerId);
        if (found.error) return { ok: false, error: found.error };
        const { room } = found;
        room.rematchVotes.clear();
        room.status = "abandoned";
        room.abandonReason = "REMATCH_DECLINED";
        this._touch(room);
        return { ok: true };
    }

    leaveRoom({ roomCode, playerId } = {}) {
        const room = this.rooms.get(roomCode);
        if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
        const player = room.players.find((p) => p.id === playerId);
        if (!player) return { ok: false, error: "UNAUTHORIZED_PLAYER" };

        const secrets = this._getSecrets(room);
        const timer = secrets.reconnectTimers.get(playerId);
        if (timer) {
            clearTimeout(timer);
            secrets.reconnectTimers.delete(playerId);
        }

        if (room.status === "waiting" && room.hostId === playerId) {
            this._destroyRoom(roomCode);
            return { ok: true, roomClosed: true };
        }

        if (room.status === "lobby" && room.players.length === 2 && playerId !== room.hostId) {
            // Guest left lobby before match started -> return host to waiting
            room.players = room.players.filter((p) => p.id !== playerId);
            secrets.tokens.delete(playerId);
            room.status = "waiting";
            room.players[0].ready = false;
            this._touch(room);
            return { ok: true, roomClosed: false };
        }

        room.status = "abandoned";
        room.abandonReason = "PLAYER_LEFT";
        this._touch(room);
        return { ok: true, roomClosed: true };
    }

    handleDisconnect({ roomCode, playerId, onTimeout } = {}) {
        const room = this.rooms.get(roomCode);
        if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
        const player = room.players.find((p) => p.id === playerId);
        if (!player) return { ok: false, error: "UNAUTHORIZED_PLAYER" };

        player.connected = false;
        this._touch(room);

        if (room.status === "abandoned") {
            return { ok: true };
        }

        const secrets = this._getSecrets(room);
        const existingTimer = secrets.reconnectTimers.get(playerId);
        if (existingTimer) clearTimeout(existingTimer);

        const timer = setTimeout(() => {
            secrets.reconnectTimers.delete(playerId);
            const targetRoom = this.rooms.get(roomCode);
            if (!targetRoom) return;
            const targetPlayer = targetRoom.players.find((p) => p.id === playerId);
            if (targetPlayer && !targetPlayer.connected) {
                targetRoom.status = "abandoned";
                targetRoom.abandonReason = "RECONNECT_TIMEOUT";
                this._touch(targetRoom);
                if (typeof onTimeout === "function") onTimeout(roomCode);
                this._destroyRoom(roomCode);
            }
        }, this.reconnectTimeoutMs);

        if (typeof timer.unref === "function") timer.unref();
        secrets.reconnectTimers.set(playerId, timer);

        return { ok: true };
    }

    reconnectPlayer({ roomCode, playerId, reconnectToken } = {}) {
        const room = this.rooms.get(roomCode);
        if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
        if (room.status === "abandoned") return { ok: false, error: "ROOM_ABANDONED" };

        const player = room.players.find((p) => p.id === playerId);
        if (!player) return { ok: false, error: "UNAUTHORIZED_PLAYER" };

        const secrets = this._getSecrets(room);
        const expected = secrets.tokens.get(playerId);
        if (
            typeof reconnectToken !== "string" ||
            typeof expected !== "string" ||
            reconnectToken.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(reconnectToken), Buffer.from(expected))
        ) {
            return { ok: false, error: "INVALID_RECONNECT_TOKEN" };
        }

        const timer = secrets.reconnectTimers.get(playerId);
        if (timer) {
            clearTimeout(timer);
            secrets.reconnectTimers.delete(playerId);
        }

        player.connected = true;
        this._touch(room);

        return { ok: true, state: this.getPublicState(roomCode, playerId) };
    }

    getPublicState(roomCode, forPlayerId = null) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        // Public state never includes reconnectTokens or unrevealed pendingMoves
        return {
            roomCode: room.roomCode,
            hostId: room.hostId,
            yourPlayerId: forPlayerId,
            status: room.status,
            bestOf: room.bestOf,
            targetWins: room.targetWins,
            round: room.round,
            matchId: room.matchId,
            matchWinnerId: room.matchWinnerId,
            abandonReason: room.abandonReason,
            rematchVotes: Array.from(room.rematchVotes),
            players: room.players.map((p) => ({
                id: p.id,
                slot: p.slot,
                name: p.name,
                score: p.score,
                ready: p.ready,
                connected: p.connected,
                hasSubmittedMove: p.hasSubmittedMove
            }))
        };
    }

    _isExpired(room) {
        return Date.now() - room.updatedAt > this.roomTtlMs;
    }

    _destroyRoom(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return;
        const secrets = this._getSecrets(room);
        if (secrets) {
            for (const timer of secrets.reconnectTimers.values()) {
                clearTimeout(timer);
            }
            secrets.reconnectTimers.clear();
            secrets.pendingMoves.clear();
            secrets.tokens.clear();
        }
        this.rooms.delete(roomCode);
    }

    cleanupExpiredRooms() {
        for (const [code, room] of this.rooms.entries()) {
            if (room.status === "abandoned" || this._isExpired(room)) {
                this._destroyRoom(code);
            }
        }
    }

    destroyAll() {
        for (const code of Array.from(this.rooms.keys())) {
            this._destroyRoom(code);
        }
    }
}

module.exports = {
    VALID_ONLINE_BEST_OF,
    DEFAULT_RECONNECT_TIMEOUT_MS,
    RoomManager
};
