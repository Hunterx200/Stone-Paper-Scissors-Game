"use strict";

const http = require("http");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");
const { RoomManager } = require("./roomManager.js");

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = path.join(__dirname, "..");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const roomManager = new RoomManager();
const socketSession = new Map(); // socket.id -> { roomCode, playerId }

// Health-check endpoint
app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        uptime: Math.floor(process.uptime()),
        activeRooms: roomManager.rooms.size
    });
});

// Block direct static access to backend/test directories
app.use(["/server", "/tests", "/package.json", "/package-lock.json", "/.env"], (_req, res) => {
    res.status(404).end();
});

// Serve existing game frontend
app.use(express.static(ROOT_DIR, { index: "index.html" }));

function emitRoomState(roomCode) {
    const room = roomManager.rooms.get(roomCode);
    if (!room) return;
    for (const [sid, sess] of socketSession.entries()) {
        if (sess.roomCode === roomCode) {
            const targetSocket = io.sockets.sockets.get(sid);
            if (targetSocket) {
                targetSocket.emit("room:state", roomManager.getPublicState(roomCode, sess.playerId));
            }
        }
    }
}

function emitToRoom(roomCode, event, payload) {
    io.to(roomCode).emit(event, payload);
}

io.on("connection", (socket) => {
    const rateKey = socket.handshake.address || socket.id;

    socket.on("room:create", (payload, ack) => {
        const res = roomManager.createRoom({
            playerName: payload && payload.playerName,
            rateKey
        });
        if (!res.ok) {
            if (typeof ack === "function") ack(res);
            return;
        }
        socketSession.set(socket.id, { roomCode: res.roomCode, playerId: res.playerId });
        socket.join(res.roomCode);
        if (typeof ack === "function") ack(res);
        emitRoomState(res.roomCode);
    });

    socket.on("room:join", (payload, ack) => {
        const res = roomManager.joinRoom({
            roomCode: payload && payload.roomCode,
            playerName: payload && payload.playerName,
            rateKey
        });
        if (!res.ok) {
            if (typeof ack === "function") ack(res);
            return;
        }
        socketSession.set(socket.id, { roomCode: res.roomCode, playerId: res.playerId });
        socket.join(res.roomCode);
        if (typeof ack === "function") ack(res);
        emitRoomState(res.roomCode);
    });

    socket.on("room:reconnect", (payload, ack) => {
        const roomCode = payload && payload.roomCode;
        const playerId = payload && payload.playerId;
        const reconnectToken = payload && payload.reconnectToken;
        const res = roomManager.reconnectPlayer({ roomCode, playerId, reconnectToken });
        if (!res.ok) {
            if (typeof ack === "function") ack(res);
            return;
        }
        socketSession.set(socket.id, { roomCode, playerId });
        socket.join(roomCode);
        if (typeof ack === "function") ack(res);
        emitRoomState(roomCode);
    });

    socket.on("room:settings", (payload, ack) => {
        const sess = socketSession.get(socket.id);
        if (!sess) return typeof ack === "function" && ack({ ok: false, error: "NOT_IN_ROOM" });
        const res = roomManager.setBestOf({
            roomCode: sess.roomCode,
            playerId: sess.playerId,
            bestOf: payload && payload.bestOf
        });
        if (typeof ack === "function") ack(res);
        if (res.ok) emitRoomState(sess.roomCode);
    });

    socket.on("room:ready", (payload, ack) => {
        const sess = socketSession.get(socket.id);
        if (!sess) return typeof ack === "function" && ack({ ok: false, error: "NOT_IN_ROOM" });
        const res = roomManager.setReady({
            roomCode: sess.roomCode,
            playerId: sess.playerId,
            ready: payload && payload.ready
        });
        if (typeof ack === "function") ack(res);
        if (res.ok) emitRoomState(sess.roomCode);
    });

    socket.on("room:start", (_payload, ack) => {
        const sess = socketSession.get(socket.id);
        if (!sess) return typeof ack === "function" && ack({ ok: false, error: "NOT_IN_ROOM" });
        const res = roomManager.startMatch({
            roomCode: sess.roomCode,
            playerId: sess.playerId
        });
        if (typeof ack === "function") ack(res);
        if (res.ok) emitRoomState(sess.roomCode);
    });

    socket.on("match:move", (payload, ack) => {
        const sess = socketSession.get(socket.id);
        if (!sess) return typeof ack === "function" && ack({ ok: false, error: "NOT_IN_ROOM" });
        const res = roomManager.submitMove({
            roomCode: sess.roomCode,
            playerId: sess.playerId,
            move: payload && payload.move
        });
        if (typeof ack === "function") ack({ ok: res.ok, error: res.error, bothSubmitted: res.bothSubmitted });
        if (!res.ok) return;

        if (res.bothSubmitted) {
            emitToRoom(sess.roomCode, "match:round_result", {
                roundResult: res.roundResult,
                matchCompleted: res.matchCompleted
            });
        }
        emitRoomState(sess.roomCode);
    });

    socket.on("match:rematch", (_payload, ack) => {
        const sess = socketSession.get(socket.id);
        if (!sess) return typeof ack === "function" && ack({ ok: false, error: "NOT_IN_ROOM" });
        const res = roomManager.requestRematch({
            roomCode: sess.roomCode,
            playerId: sess.playerId
        });
        if (typeof ack === "function") ack(res);
        if (res.ok) emitRoomState(sess.roomCode);
    });

    socket.on("match:decline_rematch", (_payload, ack) => {
        const sess = socketSession.get(socket.id);
        if (!sess) return typeof ack === "function" && ack({ ok: false, error: "NOT_IN_ROOM" });
        const res = roomManager.declineRematch({
            roomCode: sess.roomCode,
            playerId: sess.playerId
        });
        if (typeof ack === "function") ack(res);
        if (res.ok) {
            emitRoomState(sess.roomCode);
            emitToRoom(sess.roomCode, "room:closed", { reason: "REMATCH_DECLINED" });
        }
    });

    socket.on("room:leave", (_payload, ack) => {
        const sess = socketSession.get(socket.id);
        if (!sess) return typeof ack === "function" && ack({ ok: false, error: "NOT_IN_ROOM" });
        const { roomCode, playerId } = sess;
        socketSession.delete(socket.id);
        socket.leave(roomCode);

        const res = roomManager.leaveRoom({ roomCode, playerId });
        if (typeof ack === "function") ack(res);
        if (res.ok) {
            emitRoomState(roomCode);
            if (res.roomClosed) {
                emitToRoom(roomCode, "room:closed", { reason: "PLAYER_LEFT" });
            }
        }
    });

    socket.on("disconnect", () => {
        const sess = socketSession.get(socket.id);
        if (!sess) return;
        const { roomCode, playerId } = sess;
        socketSession.delete(socket.id);

        roomManager.handleDisconnect({
            roomCode,
            playerId,
            onTimeout: (expiredCode) => {
                emitToRoom(expiredCode, "room:closed", { reason: "RECONNECT_TIMEOUT" });
            }
        });
        emitRoomState(roomCode);
    });
});

// Periodic cleanup of idle/abandoned rooms
const cleanupInterval = setInterval(() => {
    roomManager.cleanupExpiredRooms();
}, 60 * 1000);
if (typeof cleanupInterval.unref === "function") cleanupInterval.unref();

function shutdown(signal) {
    console.log(`Received ${signal}, shutting down gracefully...`);
    clearInterval(cleanupInterval);
    roomManager.destroyAll();
    io.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

if (require.main === module) {
    server.listen(PORT, "0.0.0.0", () => {
        console.log(`Stone Paper Scissors: Ultimate Arena server running on port ${PORT}`);
    });
}

module.exports = { app, server, io, roomManager };
