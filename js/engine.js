(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.SPSArena = root.SPSArena || {};
        root.SPSArena.GameEngine = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const CHOICES = ["stone", "paper", "scissors"];
    const VALID_BEST_OF = [1, 3, 5, 7];
    const VALID_MODES = ["pvai", "pvp", "tournament", "survival"];
    const WIN_RULES = {
        stone: "scissors",
        paper: "stone",
        scissors: "paper"
    };
    const ACTION_VERBS = {
        "stone-scissors": "Stone crushes Scissors",
        "paper-stone": "Paper covers Stone",
        "scissors-paper": "Scissors cut Paper"
    };

    // Private WeakMap for Local PvP hidden state (never exposed on instance properties)
    const pvpPrivateState = new WeakMap();

    let matchCounter = 0;
    function generateMatchId(prefix) {
        matchCounter += 1;
        return `${prefix || "match"}_${Date.now()}_${matchCounter}`;
    }

    function isValidChoice(move) {
        return typeof move === "string" && CHOICES.includes(move);
    }

    function resolveRound(p1Move, p2Move) {
        if (!isValidChoice(p1Move) || !isValidChoice(p2Move)) {
            return {
                valid: false,
                error: "INVALID_MOVE"
            };
        }

        if (p1Move === p2Move) {
            return {
                valid: true,
                winner: "draw",
                p1Move,
                p2Move,
                reason: `Both chose ${p1Move}`
            };
        }

        const p1Wins = WIN_RULES[p1Move] === p2Move;
        const winner = p1Wins ? "p1" : "p2";
        const key = p1Wins ? `${p1Move}-${p2Move}` : `${p2Move}-${p1Move}`;
        return {
            valid: true,
            winner,
            p1Move,
            p2Move,
            reason: ACTION_VERBS[key]
        };
    }

    class MatchEngine {
        constructor(options = {}) {
            this.reset(options);
        }

        reset(options = {}) {
            const mode = options.mode !== undefined ? options.mode : "pvai";
            if (!VALID_MODES.includes(mode)) {
                throw new Error(`INVALID_MODE: ${mode}`);
            }
            const bestOf = options.bestOf !== undefined ? options.bestOf : 3;
            if (!VALID_BEST_OF.includes(bestOf)) {
                throw new Error(`INVALID_BEST_OF: ${bestOf}`);
            }

            this.mode = mode;
            this.bestOf = bestOf;
            this.targetWins = Math.ceil(bestOf / 2);
            this.matchId = options.matchId || generateMatchId(this.mode);
            this.p1Name = options.p1Name || "You";
            this.p2Name = options.p2Name || (this.mode === "pvp" ? "Player 2" : "Computer");
            this.p1Score = 0;
            this.p2Score = 0;
            this.draws = 0;
            this.round = 0;
            this.status = "in_progress"; // "in_progress" | "completed"
            this.winner = null; // "p1" | "p2" | null
            this.history = [];

            pvpPrivateState.set(this, {
                turn: "p1",
                pendingP1Move: null
            });
        }

        isCompleted() {
            return this.status === "completed";
        }

        playRound(p1Move, p2Move) {
            if (this.status === "completed") {
                return { ok: false, error: "MATCH_COMPLETED" };
            }
            if (this.mode === "pvp") {
                return { ok: false, error: "USE_PVP_TURN_METHODS" };
            }
            return this._commitRound(p1Move, p2Move);
        }

        submitPvPPlayer1Move(move) {
            if (this.mode !== "pvp") {
                return { ok: false, error: "NOT_PVP_MODE" };
            }
            if (this.status === "completed") {
                return { ok: false, error: "MATCH_COMPLETED" };
            }
            const priv = pvpPrivateState.get(this);
            if (priv.turn !== "p1") {
                return { ok: false, error: "NOT_P1_TURN" };
            }
            if (!isValidChoice(move)) {
                return { ok: false, error: "INVALID_MOVE" };
            }

            priv.pendingP1Move = move;
            priv.turn = "p2";
            return {
                ok: true,
                waitingFor: "p2"
            };
        }

        submitPvPPlayer2Move(move) {
            if (this.mode !== "pvp") {
                return { ok: false, error: "NOT_PVP_MODE" };
            }
            if (this.status === "completed") {
                return { ok: false, error: "MATCH_COMPLETED" };
            }
            const priv = pvpPrivateState.get(this);
            if (priv.turn !== "p2" || !priv.pendingP1Move) {
                return { ok: false, error: "NOT_P2_TURN" };
            }
            if (!isValidChoice(move)) {
                return { ok: false, error: "INVALID_MOVE" };
            }

            const p1Move = priv.pendingP1Move;
            priv.pendingP1Move = null;
            priv.turn = "p1";
            return this._commitRound(p1Move, move);
        }

        _commitRound(p1Move, p2Move) {
            const result = resolveRound(p1Move, p2Move);
            if (!result.valid) {
                return { ok: false, error: result.error };
            }

            this.round += 1;
            if (result.winner === "p1") {
                this.p1Score += 1;
            } else if (result.winner === "p2") {
                this.p2Score += 1;
            } else {
                this.draws += 1;
            }

            const roundRecord = {
                round: this.round,
                p1Move: result.p1Move,
                p2Move: result.p2Move,
                winner: result.winner,
                reason: result.reason
            };
            this.history.push(roundRecord);

            if (this.p1Score >= this.targetWins) {
                this.status = "completed";
                this.winner = "p1";
            } else if (this.p2Score >= this.targetWins) {
                this.status = "completed";
                this.winner = "p2";
            }

            return {
                ok: true,
                roundResult: Object.assign({}, roundRecord),
                matchCompleted: this.status === "completed",
                matchWinner: this.winner,
                state: this.getPublicState()
            };
        }

        getPublicState() {
            const priv = pvpPrivateState.get(this);
            return {
                matchId: this.matchId,
                mode: this.mode,
                bestOf: this.bestOf,
                targetWins: this.targetWins,
                p1Name: this.p1Name,
                p2Name: this.p2Name,
                p1Score: this.p1Score,
                p2Score: this.p2Score,
                draws: this.draws,
                round: this.round,
                status: this.status,
                winner: this.winner,
                pvpTurn: this.mode === "pvp" ? priv.turn : null,
                p1MoveLocked: this.mode === "pvp" ? priv.pendingP1Move !== null : false,
                history: this.history.map((entry) => Object.assign({}, entry))
            };
        }
    }

    function createValidatedRng(rng) {
        const fn = rng === undefined ? Math.random : rng;
        if (typeof fn !== "function") {
            throw new Error("INVALID_RNG_FUNCTION");
        }
        return () => {
            const val = fn();
            if (typeof val !== "number" || !Number.isFinite(val) || val < 0 || val >= 1) {
                throw new Error("INVALID_RNG_VALUE");
            }
            return val;
        };
    }

    function shuffleArray(arr, rng) {
        const copy = arr.slice();
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = copy[i];
            copy[i] = copy[j];
            copy[j] = tmp;
        }
        return copy;
    }

    function getRoundLabel(matchCountInRound) {
        if (matchCountInRound === 1) return "Final";
        if (matchCountInRound === 2) return "Semifinals";
        if (matchCountInRound === 4) return "Quarterfinals";
        if (matchCountInRound === 8) return "Round of 16";
        return `Round (${matchCountInRound * 2})`;
    }

    function validateParticipants(customParticipants, bracketSize) {
        if (!Array.isArray(customParticipants)) {
            throw new Error("INVALID_PARTICIPANTS_LIST");
        }
        if (customParticipants.length < 2 || customParticipants.length > bracketSize) {
            throw new Error("INVALID_PARTICIPANT_COUNT");
        }

        const seenIds = new Set();
        const normalized = [];

        for (let i = 0; i < customParticipants.length; i++) {
            const entry = customParticipants[i];
            let id;
            let name;
            let isHuman;

            if (typeof entry === "string") {
                const trimmed = entry.trim();
                if (!trimmed) throw new Error("INVALID_PARTICIPANT_NAME");
                id = `p_${i}_${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
                name = trimmed;
                isHuman = i === 0;
            } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
                if (typeof entry.id !== "string" || entry.id.trim() === "") {
                    throw new Error("INVALID_PARTICIPANT_ID");
                }
                if (typeof entry.name !== "string" || entry.name.trim() === "") {
                    throw new Error("INVALID_PARTICIPANT_NAME");
                }
                if (typeof entry.isHuman !== "boolean") {
                    throw new Error("INVALID_PARTICIPANT_ISHUMAN");
                }
                id = entry.id.trim();
                name = entry.name.trim();
                isHuman = entry.isHuman;
            } else {
                throw new Error("INVALID_PARTICIPANT_ENTRY");
            }

            if (seenIds.has(id)) {
                throw new Error("DUPLICATE_PARTICIPANT_ID");
            }
            seenIds.add(id);
            normalized.push({ id, name, isHuman });
        }

        return normalized;
    }

    class TournamentEngine {
        constructor(options = {}) {
            if (options.size !== undefined && options.size !== 8 && options.size !== 16) {
                throw new Error("INVALID_TOURNAMENT_SIZE");
            }
            this.size = options.size === 16 ? 16 : 8;
            this.rng = createValidatedRng(options.rng);
            this.playerName = typeof options.playerName === "string" && options.playerName.trim()
                ? options.playerName.trim()
                : "You";
            this.status = "in_progress"; // "in_progress" | "completed"
            this.champion = null;
            this.rounds = [];
            this._buildBracket(options.participants);
        }

        _buildBracket(customParticipants) {
            let participants;
            if (customParticipants !== undefined) {
                participants = validateParticipants(customParticipants, this.size);
            } else {
                participants = [{ id: "human", name: this.playerName, isHuman: true }];
                for (let i = 1; i < this.size; i++) {
                    participants.push({ id: `ai_${i}`, name: `CyberBot #${i}`, isHuman: false });
                }
            }

            // Pad with null BYEs up to bracket size
            while (participants.length < this.size) {
                participants.push(null);
            }

            const shuffled = shuffleArray(participants, this.rng);
            const totalRounds = Math.log2(this.size);
            this.rounds = [];

            let matchCount = this.size / 2;
            for (let r = 0; r < totalRounds; r++) {
                const matches = [];
                for (let m = 0; m < matchCount; m++) {
                    matches.push({
                        id: `r${r}_m${m}`,
                        roundIndex: r,
                        matchIndex: m,
                        p1: r === 0 ? shuffled[m * 2] : null,
                        p2: r === 0 ? shuffled[m * 2 + 1] : null,
                        winner: null,
                        status: "pending" // "pending" | "completed"
                    });
                }
                this.rounds.push({
                    name: getRoundLabel(matchCount),
                    matches
                });
                matchCount = matchCount / 2;
            }

            this._resolveByes();
        }

        _resolveByes() {
            for (let r = 0; r < this.rounds.length; r++) {
                const round = this.rounds[r];
                for (let m = 0; m < round.matches.length; m++) {
                    const match = round.matches[m];
                    if (match.status === "completed") continue;

                    if (r > 0) {
                        const prevMatches = this.rounds[r - 1].matches;
                        const feeder1 = prevMatches[m * 2];
                        const feeder2 = prevMatches[m * 2 + 1];
                        if (feeder1.status !== "completed" || feeder2.status !== "completed") {
                            continue;
                        }
                    }

                    if (match.p1 && !match.p2) {
                        this._advanceWinner(r, m, match.p1);
                    } else if (!match.p1 && match.p2) {
                        this._advanceWinner(r, m, match.p2);
                    } else if (!match.p1 && !match.p2 && r === 0) {
                        // Empty double-bye slot completes with null winner
                        match.status = "completed";
                        match.winner = null;
                    }
                }
            }
        }

        _advanceWinner(roundIndex, matchIndex, winnerObj) {
            const match = this.rounds[roundIndex].matches[matchIndex];
            match.winner = winnerObj;
            match.status = "completed";

            if (roundIndex + 1 < this.rounds.length) {
                const nextMatchIndex = Math.floor(matchIndex / 2);
                const nextMatch = this.rounds[roundIndex + 1].matches[nextMatchIndex];
                if (matchIndex % 2 === 0) {
                    nextMatch.p1 = winnerObj;
                } else {
                    nextMatch.p2 = winnerObj;
                }
            } else {
                this.status = "completed";
                this.champion = winnerObj;
            }
        }

        getNextPendingMatch() {
            for (let r = 0; r < this.rounds.length; r++) {
                const round = this.rounds[r];
                for (let m = 0; m < round.matches.length; m++) {
                    const match = round.matches[m];
                    if (match.status === "pending" && match.p1 && match.p2) {
                        return match;
                    }
                }
            }
            return null;
        }

        getHumanActiveMatch() {
            for (let r = 0; r < this.rounds.length; r++) {
                const round = this.rounds[r];
                for (let m = 0; m < round.matches.length; m++) {
                    const match = round.matches[m];
                    if (
                        match.status === "pending" &&
                        match.p1 &&
                        match.p2 &&
                        (match.p1.isHuman || match.p2.isHuman)
                    ) {
                        return match;
                    }
                }
            }
            return null;
        }

        recordMatchWinner(matchId, winnerId) {
            if (this.status === "completed") {
                return { ok: false, error: "TOURNAMENT_COMPLETED" };
            }
            for (let r = 0; r < this.rounds.length; r++) {
                const matches = this.rounds[r].matches;
                for (let m = 0; m < matches.length; m++) {
                    const match = matches[m];
                    if (match.id === matchId) {
                        if (match.status === "completed") {
                            return { ok: false, error: "MATCH_ALREADY_COMPLETED" };
                        }
                        if (!match.p1 || !match.p2) {
                            return { ok: false, error: "MATCH_NOT_READY" };
                        }
                        if (match.p1.id === winnerId) {
                            this._advanceWinner(r, m, match.p1);
                            this._resolveByes();
                            return { ok: true, winner: match.p1, champion: this.champion };
                        }
                        if (match.p2.id === winnerId) {
                            this._advanceWinner(r, m, match.p2);
                            this._resolveByes();
                            return { ok: true, winner: match.p2, champion: this.champion };
                        }
                        return { ok: false, error: "INVALID_WINNER_ID" };
                    }
                }
            }
            return { ok: false, error: "MATCH_NOT_FOUND" };
        }

        /**
         * Simulates bracket progression for AI-vs-AI matches only.
         * Does not represent actual RPS round gameplay and rejects human matches.
         */
        simulateAIMatch(matchId) {
            if (this.status === "completed") {
                return { ok: false, error: "TOURNAMENT_COMPLETED" };
            }
            for (let r = 0; r < this.rounds.length; r++) {
                const match = this.rounds[r].matches.find((m) => m.id === matchId);
                if (match) {
                    if (match.status === "completed") return { ok: false, error: "MATCH_ALREADY_COMPLETED" };
                    if (!match.p1 || !match.p2) return { ok: false, error: "MATCH_NOT_READY" };
                    if (match.p1.isHuman || match.p2.isHuman) {
                        return { ok: false, error: "CANNOT_SIMULATE_HUMAN_MATCH" };
                    }
                    const chosen = this.rng() < 0.5 ? match.p1 : match.p2;
                    return this.recordMatchWinner(matchId, chosen.id);
                }
            }
            return { ok: false, error: "MATCH_NOT_FOUND" };
        }
    }

    const SURVIVAL_PERSONALITIES = [
        { name: "Rookie Bot", bias: "balanced" },
        { name: "Granite Guard", bias: "stone" },
        { name: "Paper Tactician", bias: "paper" },
        { name: "Blade Striker", bias: "scissors" },
        { name: "Apex Sentinel", bias: "adaptive" }
    ];

    class SurvivalEngine {
        constructor(bestScore = 0) {
            this.bestScore = typeof bestScore === "number" && Number.isFinite(bestScore) && bestScore >= 0 ? Math.floor(bestScore) : 0;
            this.restart();
        }

        restart() {
            this.wins = 0;
            this.draws = 0;
            this.score = 0;
            this.isGameOver = false;
            this.milestones = [];
            this.difficulty = this._computeDifficulty(0);
            this.currentOpponent = this._pickOpponent(0);
        }

        _computeDifficulty(wins) {
            if (wins < 3) return "easy";
            if (wins < 6) return "medium";
            return "impossible";
        }

        _pickOpponent(wins) {
            return SURVIVAL_PERSONALITIES[wins % SURVIVAL_PERSONALITIES.length];
        }

        recordRoundOutcome(outcome) {
            if (this.isGameOver) {
                return { ok: false, error: "SURVIVAL_GAME_OVER" };
            }

            let milestoneReached = null;
            if (outcome === "win") {
                this.wins += 1;
                const multiplier = this.difficulty === "impossible" ? 3 : this.difficulty === "medium" ? 2 : 1;
                this.score += 100 * multiplier;
                if (this.score > this.bestScore) {
                    this.bestScore = this.score;
                }
                if (this.wins % 5 === 0) {
                    milestoneReached = this.wins;
                    this.milestones.push(milestoneReached);
                }
                this.difficulty = this._computeDifficulty(this.wins);
                this.currentOpponent = this._pickOpponent(this.wins);
            } else if (outcome === "loss") {
                this.isGameOver = true;
            } else if (outcome === "draw") {
                this.draws += 1;
            } else {
                return { ok: false, error: "INVALID_OUTCOME" };
            }

            return {
                ok: true,
                wins: this.wins,
                score: this.score,
                bestScore: this.bestScore,
                difficulty: this.difficulty,
                opponent: this.currentOpponent,
                milestoneReached,
                isGameOver: this.isGameOver
            };
        }
    }

    return {
        CHOICES,
        VALID_BEST_OF,
        VALID_MODES,
        WIN_RULES,
        ACTION_VERBS,
        isValidChoice,
        resolveRound,
        MatchEngine,
        TournamentEngine,
        SurvivalEngine
    };
});
