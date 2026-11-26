"use strict";

const assert = require("assert");
const StorageMod = require("../js/storage.js");
const ProgressionMod = require("../js/progression.js");
const EngineMod = require("../js/engine.js");
const AIMod = require("../js/ai.js");
const ArenaMod = require("../js/arena3d.js");

const results = [];

function test(name, fn) {
    try {
        fn();
        results.push({ name, status: "PASS" });
    } catch (err) {
        results.push({ name, status: "FAIL", error: err.message });
    }
}

function createMemoryStorage(initialMap = {}) {
    const store = new Map(Object.entries(initialMap));
    return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        _raw: store
    };
}

// ==========================================
// 1. ENGINE TESTS
// ==========================================
test("Engine: All nine RPS combinations (6 win/loss + 3 draws)", () => {
    assert.strictEqual(EngineMod.resolveRound("stone", "scissors").winner, "p1");
    assert.strictEqual(EngineMod.resolveRound("scissors", "paper").winner, "p1");
    assert.strictEqual(EngineMod.resolveRound("paper", "stone").winner, "p1");

    assert.strictEqual(EngineMod.resolveRound("scissors", "stone").winner, "p2");
    assert.strictEqual(EngineMod.resolveRound("paper", "scissors").winner, "p2");
    assert.strictEqual(EngineMod.resolveRound("stone", "paper").winner, "p2");

    assert.strictEqual(EngineMod.resolveRound("stone", "stone").winner, "draw");
    assert.strictEqual(EngineMod.resolveRound("paper", "paper").winner, "draw");
    assert.strictEqual(EngineMod.resolveRound("scissors", "scissors").winner, "draw");
});

test("Engine: Invalid move & invalid mode rejection", () => {
    assert.strictEqual(EngineMod.resolveRound("lizard", "stone").error, "INVALID_MOVE");
    const match = new EngineMod.MatchEngine({ mode: "pvai", bestOf: 3 });
    assert.strictEqual(match.playRound("invalid", "stone").error, "INVALID_MOVE");
    assert.strictEqual(match.round, 0);
    assert.throws(() => new EngineMod.MatchEngine({ mode: "arcade", bestOf: 3 }), /INVALID_MODE/);
});

test("Engine: Best-of-1, 3, 5, 7 completion & post-completion lock", () => {
    [1, 3, 5, 7].forEach((bestOf) => {
        const target = Math.ceil(bestOf / 2);
        const match = new EngineMod.MatchEngine({ mode: "pvai", bestOf });
        for (let i = 0; i < target - 1; i++) {
            const r = match.playRound("stone", "scissors");
            assert.strictEqual(r.matchCompleted, false);
        }
        const finalRes = match.playRound("stone", "scissors");
        assert.strictEqual(finalRes.matchCompleted, true);
        assert.strictEqual(finalRes.matchWinner, "p1");
        assert.strictEqual(match.playRound("stone", "scissors").error, "MATCH_COMPLETED");
    });
});

test("Engine: Reset & public history snapshot isolation", () => {
    const match = new EngineMod.MatchEngine({ mode: "pvai", bestOf: 3 });
    match.playRound("paper", "stone");
    const snap = match.getPublicState();
    snap.history[0].winner = "p2";
    snap.history.push({ round: 99, winner: "p2" });
    assert.strictEqual(match.getPublicState().history.length, 1);
    assert.strictEqual(match.getPublicState().history[0].winner, "p1");

    match.reset({ mode: "pvai", bestOf: 5 });
    assert.strictEqual(match.isCompleted(), false);
    assert.strictEqual(match.p1Score, 0);
    assert.strictEqual(match.targetWins, 3);
});

// ==========================================
// 2. ADAPTIVE AI TESTS
// ==========================================
test("AI: Easy, Medium & Impossible produce valid moves and reject invalid difficulty", () => {
    const ai = new AIMod.AdaptiveAI({ rng: () => 0.1 });
    ["easy", "medium", "impossible"].forEach((diff) => {
        const move = ai.chooseMove(diff);
        assert.ok(AIMod.CHOICES.includes(move));
    });
    assert.throws(() => ai.chooseMove("expert"), /INVALID_DIFFICULTY/);
});

test("AI: Pattern prediction, history handling & resetLearning", () => {
    // rng returning 0.2 triggers counter-selection (0.2 < 0.45 and 0.2 < 0.74)
    const ai = new AIMod.AdaptiveAI({ rng: () => 0.2 });
    ai.observePlayerMove("stone");
    ai.observePlayerMove("stone");
    ai.observePlayerMove("stone");

    assert.strictEqual(ai.getObservedHistory().length, 3);
    assert.strictEqual(ai.chooseMove("medium"), "paper");
    assert.strictEqual(ai.chooseMove("impossible"), "paper");

    ai.resetLearning();
    assert.strictEqual(ai.getObservedHistory().length, 0);
});

test("AI: Hidden-move fairness (decision independent of unrevealed current move)", () => {
    const ai1 = new AIMod.AdaptiveAI({ rng: () => 0.2 });
    const ai2 = new AIMod.AdaptiveAI({ rng: () => 0.2 });
    ["paper", "scissors", "paper"].forEach((m) => {
        ai1.observePlayerMove(m);
        ai2.observePlayerMove(m);
    });
    // Both instances have identical observed history and must produce identical choice
    assert.strictEqual(ai1.chooseMove("impossible"), ai2.chooseMove("impossible"));
});

// ==========================================
// 3. LOCAL PvP, TOURNAMENT & SURVIVAL TESTS
// ==========================================
test("Local PvP: WeakMap privacy, turn order, duplicate prevention & reset", () => {
    const match = new EngineMod.MatchEngine({ mode: "pvp", bestOf: 3 });
    assert.strictEqual(match.submitPvPPlayer2Move("stone").error, "NOT_P2_TURN");
    assert.strictEqual(match.submitPvPPlayer1Move("paper").ok, true);

    const pub = match.getPublicState();
    assert.strictEqual(pub.p1MoveLocked, true);
    assert.strictEqual(pub.pvpTurn, "p2");
    assert.strictEqual(JSON.stringify(pub).includes("paper"), false);
    assert.strictEqual(JSON.stringify(match).includes("paper"), false);
    assert.strictEqual("_pendingP1Move" in match, false);
    assert.strictEqual(match.submitPvPPlayer1Move("stone").ok, false);

    match.reset({ mode: "pvp", bestOf: 3 });
    assert.strictEqual(match.getPublicState().p1MoveLocked, false);
    match.submitPvPPlayer1Move("paper");
    const res = match.submitPvPPlayer2Move("stone");
    assert.strictEqual(res.roundResult.winner, "p1");
});

test("Tournament: 8/16 brackets, byes, human simulation block & duplicate lock", () => {
    const t8 = new EngineMod.TournamentEngine({ size: 8, rng: () => 0.1 });
    const humanMatch = t8.getHumanActiveMatch();
    assert.strictEqual(t8.simulateAIMatch(humanMatch.id).error, "CANNOT_SIMULATE_HUMAN_MATCH");

    while (t8.status !== "completed") {
        const next = t8.getNextPendingMatch();
        if (next.p1.isHuman || next.p2.isHuman) t8.recordMatchWinner(next.id, next.p1.id);
        else assert.strictEqual(t8.simulateAIMatch(next.id).ok, true);
    }
    assert.ok(t8.champion);

    const t16 = new EngineMod.TournamentEngine({ size: 16, rng: () => 0.4 });
    assert.strictEqual(t16.rounds.length, 4);
    const first = t16.getNextPendingMatch();
    assert.strictEqual(t16.recordMatchWinner(first.id, first.p1.id).ok, true);
    assert.strictEqual(t16.recordMatchWinner(first.id, first.p2.id).error, "MATCH_ALREADY_COMPLETED");

    const tBye = new EngineMod.TournamentEngine({
        size: 8,
        participants: [
            { id: "p1", name: "You", isHuman: true },
            { id: "p2", name: "Bot1", isHuman: false },
            { id: "p3", name: "Bot2", isHuman: false }
        ],
        rng: () => 0.5
    });
    while (tBye.status !== "completed") {
        const next = tBye.getNextPendingMatch();
        tBye.recordMatchWinner(next.id, next.p1.id);
    }
    assert.ok(tBye.champion);
});

test("Survival: Progressive difficulty (easy -> medium -> impossible), milestones & game-over lock", () => {
    const s = new EngineMod.SurvivalEngine(0);
    assert.strictEqual(s.difficulty, "easy");
    for (let i = 1; i <= 6; i++) {
        const r = s.recordRoundOutcome("win");
        assert.strictEqual(r.ok, true);
        if (i === 5) assert.strictEqual(r.milestoneReached, 5);
    }
    assert.strictEqual(s.difficulty, "impossible");
    assert.strictEqual(s.recordRoundOutcome("draw").isGameOver, false);
    assert.strictEqual(s.recordRoundOutcome("loss").isGameOver, true);
    assert.strictEqual(s.recordRoundOutcome("win").error, "SURVIVAL_GAME_OVER");
});

// ==========================================
// 4. PROGRESSION & STORAGE TESTS
// ==========================================
test("Progression: XP rates, Impossible achievement, duplicate reward protection & overflow", () => {
    assert.strictEqual(ProgressionMod.computeMatchXP({ matchId: "x1", mode: "pvai", outcome: "win", difficulty: "easy" }), 25);
    assert.strictEqual(ProgressionMod.computeMatchXP({ matchId: "x2", mode: "pvai", outcome: "win", difficulty: "medium" }), 35);
    assert.strictEqual(ProgressionMod.computeMatchXP({ matchId: "x3", mode: "pvai", outcome: "win", difficulty: "impossible" }), 60);
    assert.strictEqual(ProgressionMod.computeMatchXP({ matchId: "x4", mode: "pvp", outcome: "win", difficulty: "impossible" }), 30);

    let profile = StorageMod.createDefaultProfile();
    const impWin = ProgressionMod.recordMatchResult(profile, {
        matchId: "imp_1",
        mode: "pvai",
        outcome: "win",
        difficulty: "impossible"
    });
    assert.ok(impWin.newlyUnlocked.includes("impossible_victor"));
    assert.ok(impWin.newlyUnlocked.includes("first_victory"));
    profile = impWin.profile;

    // Duplicate matchId
    assert.strictEqual(ProgressionMod.recordMatchResult(profile, {
        matchId: "imp_1", mode: "pvai", outcome: "win", difficulty: "impossible"
    }).duplicate, true);

    // Overflow protection
    const ov = JSON.parse(JSON.stringify(profile));
    ov.xp = Number.MAX_SAFE_INTEGER;
    ov.level = 1000;
    assert.throws(() => ProgressionMod.recordMatchResult(ov, {
        matchId: "ov1", mode: "pvai", outcome: "win", difficulty: "easy"
    }), /NUMERIC_OVERFLOW/);
});

test("Storage: Validation, recovery, future schema protection, reset & reward retention", () => {
    const mem = createMemoryStorage();
    const sm = new StorageMod.StorageManager(mem);
    const validProfile = StorageMod.createDefaultProfile();

    const invalidCurrent = JSON.stringify({ schemaVersion: 1, playerName: "Broken", wins: 5 });
    mem.setItem(StorageMod.PROFILE_KEY, invalidCurrent);
    assert.strictEqual(sm.saveProfile(validProfile).error, "EXISTING_DATA_UNREADABLE");
    assert.strictEqual(sm.saveProfile(validProfile, { allowOverwriteMalformed: true }).ok, true);

    const future = JSON.stringify({ schemaVersion: 99, playerName: "Future" });
    mem.setItem(StorageMod.PROFILE_KEY, future);
    assert.strictEqual(sm.loadProfile().error, "UNSUPPORTED_FUTURE_SCHEMA");
    assert.strictEqual(sm.saveProfile(validProfile, { allowOverwriteMalformed: true }).error, "FUTURE_SCHEMA_PROTECTED");
    assert.strictEqual(sm.resetProfile({ force: true }).error, "FUTURE_SCHEMA_PROTECTED");
    assert.strictEqual(mem.getItem(StorageMod.PROFILE_KEY), future);

    // Theme & custom color settings validation
    const defSettings = StorageMod.createDefaultSettings();
    assert.strictEqual(defSettings.defaultDifficulty, "easy");
    assert.strictEqual(defSettings.theme, "ocean-blue");
    assert.strictEqual(defSettings.tutorialSeen, false);

    const customSettings = Object.assign({}, defSettings, {
        theme: "custom",
        customPrimary: "#12ab34",
        customAccent: "#ff00aa",
        tutorialSeen: true
    });
    assert.strictEqual(sm.saveSettings(customSettings).ok, true);
    assert.strictEqual(sm.loadSettings().data.theme, "custom");

    const badTheme = Object.assign({}, defSettings, { theme: "rainbow" });
    assert.strictEqual(sm.saveSettings(badTheme).error, "INVALID_THEME");
    const badHex = Object.assign({}, defSettings, { customPrimary: "red" });
    assert.strictEqual(sm.saveSettings(badHex).error, "INVALID_CUSTOM_PRIMARY");
});

test("Arena3D: Graceful offline/headless fallback when THREE is unavailable", () => {
    const fallback = ArenaMod.createArena3D("arena-canvas");
    assert.strictEqual(fallback.isSupported, false);
    assert.strictEqual(typeof fallback.playBattle, "function");
    assert.strictEqual(typeof fallback.destroy, "function");
});

// ==========================================
// REPORT
// ==========================================
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
console.log(`\nSummary: ${passed} passed, ${failed} failed out of ${results.length} tests.`);
process.exit(failed > 0 ? 1 : 0);
