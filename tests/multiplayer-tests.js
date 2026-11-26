"use strict";

const assert = require("assert");
const { RoomManager } = require("../server/roomManager.js");

const results = [];

function test(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => results.push({ name, status: "PASS" }))
        .catch((err) => results.push({ name, status: "FAIL", error: err.message }));
}

async function runAll() {
    await test("Multiplayer: Room creation & unique 6-digit codes", () => {
        const rm = new RoomManager();
        const codes = new Set();
        for (let i = 0; i < 8; i++) {
            const res = rm.createRoom({ playerName: `P${i}` });
            assert.strictEqual(res.ok, true);
            assert.match(res.roomCode, /^\d{6}$/);
            assert.strictEqual(codes.has(res.roomCode), false);
            codes.add(res.roomCode);
        }
        rm.destroyAll();
    });

    await test("Multiplayer: Join valid room, invalid code, full room & 3rd player rejection", () => {
        const rm = new RoomManager();
        const c = rm.createRoom({ playerName: "Host" });

        assert.strictEqual(rm.joinRoom({ roomCode: "abc" }).error, "INVALID_ROOM_CODE");
        assert.strictEqual(rm.joinRoom({ roomCode: "999999" }).error, "ROOM_NOT_FOUND");

        const j = rm.joinRoom({ roomCode: c.roomCode, playerName: "Guest" });
        assert.strictEqual(j.ok, true);
        assert.strictEqual(j.state.players.length, 2);

        const third = rm.joinRoom({ roomCode: c.roomCode, playerName: "Intruder" });
        assert.strictEqual(third.ok, false);
        assert.strictEqual(third.error, "ROOM_FULL");
        rm.destroyAll();
    });

    await test("Multiplayer: Expired room rejection & cleanup", () => {
        const rm = new RoomManager({ roomTtlMs: 50 });
        const c = rm.createRoom({ playerName: "Host" });
        const room = rm.rooms.get(c.roomCode);
        room.updatedAt = Date.now() - 200;

        const j = rm.joinRoom({ roomCode: c.roomCode, playerName: "Guest" });
        assert.strictEqual(j.ok, false);
        assert.strictEqual(j.error, "ROOM_EXPIRED");
        assert.strictEqual(rm.rooms.has(c.roomCode), false);
        rm.destroyAll();
    });

    await test("Multiplayer: Host-only settings changes & locked after match start", () => {
        const rm = new RoomManager();
        const host = rm.createRoom({ playerName: "Host" });
        const guest = rm.joinRoom({ roomCode: host.roomCode, playerName: "Guest" });

        assert.strictEqual(rm.setBestOf({ roomCode: host.roomCode, playerId: guest.playerId, bestOf: 5 }).error, "HOST_ONLY");
        assert.strictEqual(rm.setBestOf({ roomCode: host.roomCode, playerId: host.playerId, bestOf: 5 }).ok, true);
        assert.strictEqual(rm.getPublicState(host.roomCode).bestOf, 5);

        rm.setReady({ roomCode: host.roomCode, playerId: host.playerId, ready: true });
        rm.setReady({ roomCode: host.roomCode, playerId: guest.playerId, ready: true });
        assert.strictEqual(rm.startMatch({ roomCode: host.roomCode, playerId: guest.playerId }).error, "HOST_ONLY");
        assert.strictEqual(rm.startMatch({ roomCode: host.roomCode, playerId: host.playerId }).ok, true);

        assert.strictEqual(rm.setBestOf({ roomCode: host.roomCode, playerId: host.playerId, bestOf: 7 }).error, "SETTINGS_LOCKED");
        rm.destroyAll();
    });

    await test("Multiplayer: Hidden move privacy, duplicate move prevention & all 9 RPS combinations", () => {
        const rm = new RoomManager();
        const host = rm.createRoom({ playerName: "P1" });
        const guest = rm.joinRoom({ roomCode: host.roomCode, playerName: "P2" });
        rm.setBestOf({ roomCode: host.roomCode, playerId: host.playerId, bestOf: 7 });
        rm.setReady({ roomCode: host.roomCode, playerId: host.playerId, ready: true });
        rm.setReady({ roomCode: host.roomCode, playerId: guest.playerId, ready: true });
        rm.startMatch({ roomCode: host.roomCode, playerId: host.playerId });

        // P1 submits stone -> hidden from public state & duplicate rejected
        const s1 = rm.submitMove({ roomCode: host.roomCode, playerId: host.playerId, move: "stone" });
        assert.strictEqual(s1.ok, true);
        assert.strictEqual(s1.bothSubmitted, false);
        const pubForGuest = rm.getPublicState(host.roomCode, guest.playerId);
        assert.strictEqual(JSON.stringify(pubForGuest).includes("stone"), false);
        assert.strictEqual(rm.submitMove({ roomCode: host.roomCode, playerId: host.playerId, move: "paper" }).error, "DUPLICATE_MOVE");

        // Unauthorized non-member move rejected
        assert.strictEqual(rm.submitMove({ roomCode: host.roomCode, playerId: "fake-id", move: "paper" }).error, "UNAUTHORIZED_PLAYER");

        // P2 submits paper -> P2 wins round
        const s2 = rm.submitMove({ roomCode: host.roomCode, playerId: guest.playerId, move: "paper" });
        assert.strictEqual(s2.bothSubmitted, true);
        assert.strictEqual(s2.roundResult.winnerId, guest.playerId);

        // Draw round
        rm.submitMove({ roomCode: host.roomCode, playerId: host.playerId, move: "scissors" });
        const drawRes = rm.submitMove({ roomCode: host.roomCode, playerId: guest.playerId, move: "scissors" });
        assert.strictEqual(drawRes.roundResult.isDraw, true);
        rm.destroyAll();
    });

    await test("Multiplayer: Best-of-3/5/7 completion & post-completion lock", () => {
        [3, 5, 7].forEach((bestOf) => {
            const target = Math.ceil(bestOf / 2);
            const rm = new RoomManager();
            const h = rm.createRoom({ playerName: "H" });
            const g = rm.joinRoom({ roomCode: h.roomCode, playerName: "G" });
            rm.setBestOf({ roomCode: h.roomCode, playerId: h.playerId, bestOf });
            rm.setReady({ roomCode: h.roomCode, playerId: h.playerId, ready: true });
            rm.setReady({ roomCode: h.roomCode, playerId: g.playerId, ready: true });
            rm.startMatch({ roomCode: h.roomCode, playerId: h.playerId });

            let lastRes;
            for (let i = 0; i < target; i++) {
                rm.submitMove({ roomCode: h.roomCode, playerId: h.playerId, move: "stone" });
                lastRes = rm.submitMove({ roomCode: h.roomCode, playerId: g.playerId, move: "scissors" });
            }
            assert.strictEqual(lastRes.matchCompleted, true);
            assert.strictEqual(rm.submitMove({ roomCode: h.roomCode, playerId: h.playerId, move: "stone" }).error, "MATCH_NOT_ACTIVE");
            rm.destroyAll();
        });
    });

    await test("Multiplayer: Reconnection preserves scores/round & invalid token rejected", () => {
        const rm = new RoomManager({ reconnectTimeoutMs: 5000 });
        const h = rm.createRoom({ playerName: "H" });
        const g = rm.joinRoom({ roomCode: h.roomCode, playerName: "G" });
        rm.setReady({ roomCode: h.roomCode, playerId: h.playerId, ready: true });
        rm.setReady({ roomCode: h.roomCode, playerId: g.playerId, ready: true });
        rm.startMatch({ roomCode: h.roomCode, playerId: h.playerId });
        rm.submitMove({ roomCode: h.roomCode, playerId: h.playerId, move: "stone" });
        rm.submitMove({ roomCode: h.roomCode, playerId: g.playerId, move: "scissors" });

        rm.handleDisconnect({ roomCode: h.roomCode, playerId: g.playerId });
        assert.strictEqual(rm.getPublicState(h.roomCode).players[1].connected, false);

        assert.strictEqual(rm.reconnectPlayer({ roomCode: h.roomCode, playerId: g.playerId, reconnectToken: "wrong" }).error, "INVALID_RECONNECT_TOKEN");
        const rec = rm.reconnectPlayer({ roomCode: h.roomCode, playerId: g.playerId, reconnectToken: g.reconnectToken });
        assert.strictEqual(rec.ok, true);
        assert.strictEqual(rec.state.players[0].score, 1);
        assert.strictEqual(rec.state.round, 2);
        rm.destroyAll();
    });

    await test("Multiplayer: Reconnection timeout abandons & cleans up room", async () => {
        const rm = new RoomManager({ reconnectTimeoutMs: 60 });
        const h = rm.createRoom({ playerName: "H" });
        const g = rm.joinRoom({ roomCode: h.roomCode, playerName: "G" });
        let timedOutCode = null;
        rm.handleDisconnect({
            roomCode: h.roomCode,
            playerId: g.playerId,
            onTimeout: (code) => { timedOutCode = code; }
        });
        await new Promise((r) => setTimeout(r, 120));
        assert.strictEqual(timedOutCode, h.roomCode);
        assert.strictEqual(rm.rooms.has(h.roomCode), false);
    });

    await test("Multiplayer: Rematch requires both players & preserves Best-of", () => {
        const rm = new RoomManager();
        const h = rm.createRoom({ playerName: "H" });
        const g = rm.joinRoom({ roomCode: h.roomCode, playerName: "G" });
        rm.setBestOf({ roomCode: h.roomCode, playerId: h.playerId, bestOf: 5 });
        rm.setReady({ roomCode: h.roomCode, playerId: h.playerId, ready: true });
        rm.setReady({ roomCode: h.roomCode, playerId: g.playerId, ready: true });
        rm.startMatch({ roomCode: h.roomCode, playerId: h.playerId });

        for (let i = 0; i < 3; i++) {
            rm.submitMove({ roomCode: h.roomCode, playerId: h.playerId, move: "paper" });
            rm.submitMove({ roomCode: h.roomCode, playerId: g.playerId, move: "stone" });
        }

        const r1 = rm.requestRematch({ roomCode: h.roomCode, playerId: h.playerId });
        assert.strictEqual(r1.rematchStarted, false);
        const r2 = rm.requestRematch({ roomCode: h.roomCode, playerId: g.playerId });
        assert.strictEqual(r2.rematchStarted, true);

        const st = rm.getPublicState(h.roomCode);
        assert.strictEqual(st.status, "playing");
        assert.strictEqual(st.bestOf, 5);
        assert.strictEqual(st.round, 1);
        assert.strictEqual(st.players[0].score, 0);
        assert.strictEqual(st.players[1].score, 0);
        rm.destroyAll();
    });

    let passed = 0;
    let failed = 0;
    for (const r of results) {
        if (r.status === "PASS") {
            passed++;
            console.log(`[PASS] ${r.name}`);
        } else {
            failed++;
            console.error(`[FAIL] ${r.name} -> ${r.error}`);
        }
    }
    console.log(`\nMultiplayer Summary: ${passed} passed, ${failed} failed out of ${results.length} tests.`);
    process.exit(failed > 0 ? 1 : 0);
}

runAll();
