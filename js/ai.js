(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.SPSArena = root.SPSArena || {};
        root.SPSArena.AdaptiveAI = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const CHOICES = ["stone", "paper", "scissors"];
    const VALID_DIFFICULTIES = ["easy", "medium", "impossible"];
    const COUNTER_OF = {
        stone: "paper",
        paper: "scissors",
        scissors: "stone"
    };

    function isValidMove(move) {
        return typeof move === "string" && CHOICES.includes(move);
    }

    function createValidatedRng(rng) {
        const fn = rng === undefined ? Math.random : rng;
        if (typeof fn !== "function") {
            throw new Error("INVALID_RNG_FUNCTION");
        }
        return () => {
            const v = fn();
            if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v >= 1) {
                throw new Error("INVALID_RNG_VALUE");
            }
            return v;
        };
    }

    class PlayerPatternTracker {
        constructor(maxHistory = 60) {
            this.maxHistory = maxHistory;
            this.history = [];
        }

        recordMove(move) {
            if (!isValidMove(move)) {
                throw new Error("INVALID_MOVE");
            }
            this.history.push(move);
            if (this.history.length > this.maxHistory) {
                this.history.shift();
            }
        }

        getHistory() {
            return this.history.slice();
        }

        reset() {
            this.history = [];
        }
    }

    class MoveFrequencyAnalyzer {
        static analyze(history) {
            const counts = { stone: 0, paper: 0, scissors: 0 };
            for (const move of history) {
                if (isValidMove(move)) counts[move] += 1;
            }
            const total = counts.stone + counts.paper + counts.scissors;
            const frequencies = {
                stone: total ? counts.stone / total : 1 / 3,
                paper: total ? counts.paper / total : 1 / 3,
                scissors: total ? counts.scissors / total : 1 / 3
            };
            return { counts, total, frequencies };
        }
    }

    class RecentHistoryAnalyzer {
        static analyze(history, windowSize = 8) {
            const recent = history.slice(-windowSize);
            const scores = { stone: 0, paper: 0, scissors: 0 };

            // Recency-weighted move counts
            for (let i = 0; i < recent.length; i++) {
                const weight = (i + 1) / recent.length;
                scores[recent[i]] += weight;
            }

            // Detect consecutive repeats (e.g. player played stone twice in a row)
            if (recent.length >= 2) {
                const last = recent[recent.length - 1];
                const prev = recent[recent.length - 2];
                if (last === prev) {
                    scores[last] += 0.9;
                }
            }

            // First-order Markov transition from the most recent observed move
            if (history.length >= 2) {
                const lastMove = history[history.length - 1];
                for (let i = 0; i < history.length - 1; i++) {
                    if (history[i] === lastMove) {
                        const nextMove = history[i + 1];
                        scores[nextMove] += 0.85;
                    }
                }
            }

            return scores;
        }
    }

    class WeightedPredictionEngine {
        static predict(history, difficulty) {
            if (!history || history.length === 0) {
                return null;
            }

            const freq = MoveFrequencyAnalyzer.analyze(history);
            if (difficulty === "medium") {
                // Basic frequency + slight repeat bias
                let bestMove = "stone";
                let bestScore = -1;
                const last = history[history.length - 1];
                for (const m of CHOICES) {
                    const repeatBonus = history.length >= 2 && history[history.length - 2] === last && m === last ? 0.2 : 0;
                    const score = freq.frequencies[m] + repeatBonus;
                    if (score > bestScore) {
                        bestScore = score;
                        bestMove = m;
                    }
                }
                return { predictedMove: bestMove, confidence: bestScore };
            }

            // Impossible: combine overall frequency + recent weighted transitions
            const recentScores = RecentHistoryAnalyzer.analyze(history, 10);
            const recentTotal = recentScores.stone + recentScores.paper + recentScores.scissors || 1;

            let bestMove = "stone";
            let bestScore = -1;
            for (const m of CHOICES) {
                const combined = freq.frequencies[m] * 0.35 + (recentScores[m] / recentTotal) * 0.65;
                if (combined > bestScore) {
                    bestScore = combined;
                    bestMove = m;
                }
            }

            return { predictedMove: bestMove, confidence: bestScore };
        }
    }

    class CounterStrategyEngine {
        static counterFor(predictedMove) {
            return COUNTER_OF[predictedMove] || CHOICES[0];
        }
    }

    class RandomizationEngine {
        static pickRandom(rng, biasMove = null) {
            if (biasMove && isValidMove(biasMove) && rng() < 0.45) {
                return biasMove;
            }
            return CHOICES[Math.floor(rng() * CHOICES.length)];
        }
    }

    class AdaptiveAI {
        /**
         * Heuristic pattern-based AI.
         * Never accesses any unrevealed/current player move; decisions are based
         * strictly on previously observed completed rounds and controlled randomness.
         */
        constructor(options = {}) {
            this.rng = createValidatedRng(options.rng);
            this.tracker = new PlayerPatternTracker(options.maxHistory || 60);
        }

        observePlayerMove(move) {
            this.tracker.recordMove(move);
        }

        resetLearning() {
            this.tracker.reset();
        }

        getObservedHistory() {
            return this.tracker.getHistory();
        }

        chooseMove(difficulty = "medium", options = {}) {
            if (!VALID_DIFFICULTIES.includes(difficulty)) {
                throw new Error(`INVALID_DIFFICULTY: ${difficulty}`);
            }

            const biasMove = options.bias && isValidMove(options.bias) ? options.bias : null;
            const history = this.tracker.getHistory();

            if (difficulty === "easy" || history.length === 0) {
                return RandomizationEngine.pickRandom(this.rng, biasMove);
            }

            const prediction = WeightedPredictionEngine.predict(history, difficulty);
            const counterMove = CounterStrategyEngine.counterFor(prediction.predictedMove);

            // Controlled randomness ensures AI is never 100% deterministic
            const counterProbability = difficulty === "impossible" ? 0.74 : 0.45;
            if (this.rng() < counterProbability) {
                return counterMove;
            }

            return RandomizationEngine.pickRandom(this.rng, biasMove);
        }
    }

    return {
        CHOICES,
        VALID_DIFFICULTIES,
        COUNTER_OF,
        PlayerPatternTracker,
        MoveFrequencyAnalyzer,
        RecentHistoryAnalyzer,
        WeightedPredictionEngine,
        CounterStrategyEngine,
        RandomizationEngine,
        AdaptiveAI
    };
});
