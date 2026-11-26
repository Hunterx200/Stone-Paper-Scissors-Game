(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.SPSArena = root.SPSArena || {};
        root.SPSArena.ProgressionManager = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const SCHEMA_VERSION = 1;
    // Replay-protection cap: only the most recent 200 matchIds are retained to bound localStorage size.
    const MAX_RECORDED_IDS = 200;

    const ACHIEVEMENTS = [
        { id: "first_victory", title: "First Victory", description: "Win your first match." },
        { id: "wins_10", title: "10 Victories", description: "Win 10 total matches." },
        { id: "streak_5", title: "5-Match Win Streak", description: "Achieve a 5-match win streak." },
        { id: "tournament_champion", title: "Tournament Champion", description: "Win an 8 or 16-player tournament." },
        { id: "survival_master", title: "Survival Master", description: "Reach 5+ consecutive wins in Survival mode." },
        { id: "impossible_victor", title: "Impossible Difficulty Victory", description: "Defeat the Impossible AI opponent." }
    ];

    const VALID_MODES = ["pvai", "pvp", "tournament", "survival", "online"];
    const VALID_OUTCOMES = ["win", "loss", "draw"];
    const VALID_DIFFICULTIES = ["easy", "medium", "impossible"];
    const MAX_LEVEL = 1000;

    const DIFFICULTY_XP = {
        easy: 25,
        medium: 35,
        impossible: 60
    };

    function isNonNegativeSafeInt(val) {
        return typeof val === "number" && Number.isSafeInteger(val) && val >= 0;
    }

    function safeAdd(a, b) {
        const sum = a + b;
        if (!Number.isSafeInteger(sum) || sum < 0) {
            throw new Error("NUMERIC_OVERFLOW");
        }
        return sum;
    }

    function isUniqueNonEmptyStringArray(arr) {
        if (!Array.isArray(arr)) return false;
        const seen = new Set();
        for (const item of arr) {
            if (typeof item !== "string" || item.trim() === "") return false;
            if (seen.has(item)) return false;
            seen.add(item);
        }
        return true;
    }

    function isValidMatchRecord(rec) {
        if (!rec || typeof rec !== "object" || Array.isArray(rec)) return false;
        if (typeof rec.matchId !== "string" || rec.matchId.trim() === "") return false;
        if (!VALID_MODES.includes(rec.mode)) return false;
        if (!VALID_OUTCOMES.includes(rec.outcome)) return false;
        if (!isNonNegativeSafeInt(rec.p1Score) || !isNonNegativeSafeInt(rec.p2Score)) return false;
        if (!isNonNegativeSafeInt(rec.xpAwarded)) return false;
        if (typeof rec.timestamp !== "number" || !Number.isFinite(rec.timestamp) || rec.timestamp < 0) return false;
        if (rec.difficulty !== undefined && rec.difficulty !== null) {
            if (rec.mode === "pvp") return false;
            if (!VALID_DIFFICULTIES.includes(rec.difficulty)) return false;
        }
        return true;
    }

    function getXPForNextLevel(level) {
        if (typeof level !== "number" || !Number.isSafeInteger(level) || level < 1) {
            throw new Error("INVALID_LEVEL");
        }
        return 100 + (level - 1) * 50;
    }

    function calculateLevelFromXP(totalXP) {
        if (!isNonNegativeSafeInt(totalXP)) {
            throw new Error("INVALID_XP");
        }
        let level = 1;
        let remaining = totalXP;
        while (level < MAX_LEVEL && remaining >= getXPForNextLevel(level)) {
            remaining -= getXPForNextLevel(level);
            level++;
        }
        return {
            level,
            currentLevelXP: remaining,
            nextLevelXP: getXPForNextLevel(level)
        };
    }

    function validateProfileStructure(profile) {
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
            throw new Error("INVALID_PROFILE");
        }
        if (profile.schemaVersion !== SCHEMA_VERSION) {
            throw new Error("INVALID_SCHEMA_VERSION");
        }
        if (typeof profile.playerName !== "string" || profile.playerName.trim() === "") {
            throw new Error("INVALID_PLAYER_NAME");
        }
        const requiredNums = [
            "level", "xp", "totalMatches", "wins", "losses", "draws",
            "currentStreak", "bestStreak", "survivalBestScore", "survivalBestWins", "tournamentsWon"
        ];
        for (const key of requiredNums) {
            if (!isNonNegativeSafeInt(profile[key])) {
                throw new Error(`INVALID_PROFILE_${key.toUpperCase()}`);
            }
        }
        if (profile.level < 1) {
            throw new Error("INVALID_PROFILE_LEVEL");
        }
        if (calculateLevelFromXP(profile.xp).level !== profile.level) {
            throw new Error("INCONSISTENT_XP_LEVEL");
        }
        const totalCheck = safeAdd(safeAdd(profile.wins, profile.losses), profile.draws);
        if (totalCheck !== profile.totalMatches) {
            throw new Error("INCONSISTENT_MATCH_TOTALS");
        }
        if (profile.bestStreak < profile.currentStreak) {
            throw new Error("INCONSISTENT_STREAK");
        }
        if (!profile.modeStats || typeof profile.modeStats !== "object" || Array.isArray(profile.modeStats)) {
            throw new Error("INVALID_PROFILE_MODE_STATS");
        }

        let modeMatchSum = 0;
        let modeWinSum = 0;
        let modeLossSum = 0;
        let modeDrawSum = 0;
        for (const mode of VALID_MODES) {
            const ms = profile.modeStats[mode] === undefined && mode === "online"
                ? { matches: 0, wins: 0, losses: 0, draws: 0 }
                : profile.modeStats[mode];
            if (
                !ms ||
                typeof ms !== "object" ||
                Array.isArray(ms) ||
                !isNonNegativeSafeInt(ms.matches) ||
                !isNonNegativeSafeInt(ms.wins) ||
                !isNonNegativeSafeInt(ms.losses) ||
                !isNonNegativeSafeInt(ms.draws) ||
                safeAdd(safeAdd(ms.wins, ms.losses), ms.draws) !== ms.matches
            ) {
                throw new Error(`INVALID_PROFILE_MODE_${mode.toUpperCase()}`);
            }
            modeMatchSum = safeAdd(modeMatchSum, ms.matches);
            modeWinSum = safeAdd(modeWinSum, ms.wins);
            modeLossSum = safeAdd(modeLossSum, ms.losses);
            modeDrawSum = safeAdd(modeDrawSum, ms.draws);
        }
        if (
            modeMatchSum !== profile.totalMatches ||
            modeWinSum !== profile.wins ||
            modeLossSum !== profile.losses ||
            modeDrawSum !== profile.draws
        ) {
            throw new Error("INCONSISTENT_MODE_STATS");
        }

        if (
            !isUniqueNonEmptyStringArray(profile.achievements) ||
            !Array.isArray(profile.matchHistory) ||
            !profile.matchHistory.every(isValidMatchRecord) ||
            !isUniqueNonEmptyStringArray(profile.recordedMatchIds) ||
            !isUniqueNonEmptyStringArray(profile.claimedTournamentIds) ||
            !isUniqueNonEmptyStringArray(profile.claimedSurvivalMilestoneIds)
        ) {
            throw new Error("INVALID_PROFILE_ARRAYS");
        }
    }

    function validateSummary(summary) {
        if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
            throw new Error("INVALID_MATCH_SUMMARY");
        }
        if (typeof summary.matchId !== "string" || summary.matchId.trim() === "") {
            throw new Error("INVALID_MATCH_ID");
        }
        if (!VALID_OUTCOMES.includes(summary.outcome)) {
            throw new Error("INVALID_OUTCOME");
        }
        const mode = summary.mode === undefined ? "pvai" : summary.mode;
        if (!VALID_MODES.includes(mode)) {
            throw new Error("INVALID_MODE");
        }

        if (summary.tournamentChampion !== undefined && typeof summary.tournamentChampion !== "boolean") {
            throw new Error("INVALID_TOURNAMENT_CHAMPION_FLAG");
        }
        if (summary.survivalMilestoneReached !== undefined && typeof summary.survivalMilestoneReached !== "boolean") {
            throw new Error("INVALID_SURVIVAL_MILESTONE_FLAG");
        }

        if (summary.difficulty !== undefined && summary.difficulty !== null) {
            if (!VALID_DIFFICULTIES.includes(summary.difficulty)) {
                throw new Error("INVALID_DIFFICULTY");
            }
        }

        if (summary.tournamentChampion === true) {
            if (mode !== "tournament") {
                throw new Error("INVALID_ACHIEVEMENT_MODE_COMBINATION");
            }
            if (summary.outcome !== "win") {
                throw new Error("INVALID_TOURNAMENT_CHAMPION_OUTCOME");
            }
            if (typeof summary.tournamentId !== "string" || summary.tournamentId.trim() === "") {
                throw new Error("MISSING_TOURNAMENT_ID");
            }
        }

        if (summary.survivalMilestoneReached === true) {
            if (mode !== "survival") {
                throw new Error("INVALID_ACHIEVEMENT_MODE_COMBINATION");
            }
            if (summary.outcome !== "win") {
                throw new Error("INVALID_SURVIVAL_MILESTONE_OUTCOME");
            }
            if (typeof summary.survivalMilestoneId !== "string" || summary.survivalMilestoneId.trim() === "") {
                throw new Error("MISSING_SURVIVAL_MILESTONE_ID");
            }
        }

        if (summary.survivalWins !== undefined && !isNonNegativeSafeInt(summary.survivalWins)) {
            throw new Error("INVALID_SURVIVAL_WINS");
        }
        if (summary.survivalScore !== undefined && !isNonNegativeSafeInt(summary.survivalScore)) {
            throw new Error("INVALID_SURVIVAL_SCORE");
        }
    }

    function computeMatchXP(summary, options = {}) {
        validateSummary(summary);

        const mode = summary.mode === undefined ? "pvai" : summary.mode;
        const outcome = summary.outcome;
        let xp = 0;

        if (outcome === "win") {
            if (mode === "pvp") {
                xp += 30;
            } else if (mode === "online") {
                xp += 40;
            } else {
                const difficulty = summary.difficulty || "medium";
                xp += DIFFICULTY_XP[difficulty] || 30;
            }
        } else if (outcome === "draw") {
            xp += 10;
        } else {
            xp += 5;
        }

        if (mode === "tournament" && summary.tournamentChampion === true && !options.tournamentAlreadyClaimed) {
            xp += 100;
        }

        if (mode === "survival" && summary.survivalMilestoneReached === true && !options.milestoneAlreadyClaimed) {
            xp += 50;
        }

        return xp;
    }

    function evaluateAchievements(profile, summary, mode) {
        const unlocked = new Set(profile.achievements);
        const newlyUnlocked = [];

        function unlock(id) {
            if (!unlocked.has(id)) {
                unlocked.add(id);
                newlyUnlocked.push(id);
            }
        }

        if (profile.wins >= 1) unlock("first_victory");
        if (profile.bestStreak >= 5 || profile.currentStreak >= 5) unlock("streak_5");
        if (profile.wins >= 10) unlock("wins_10");
        if (mode === "tournament" && summary.tournamentChampion === true && summary.outcome === "win") {
            unlock("tournament_champion");
        }
        if (mode === "survival" && ((summary.survivalWins || 0) >= 5 || profile.survivalBestWins >= 5)) {
            unlock("survival_master");
        }
        if (summary.outcome === "win" && mode === "pvai" && summary.difficulty === "impossible") {
            unlock("impossible_victor");
        }

        return {
            achievements: Array.from(unlocked),
            newlyUnlocked
        };
    }

    function recordMatchResult(profile, summary) {
        validateProfileStructure(profile);
        validateSummary(summary);

        const mode = summary.mode === undefined ? "pvai" : summary.mode;

        if (profile.recordedMatchIds.includes(summary.matchId)) {
            return {
                duplicate: true,
                xpAwarded: 0,
                newlyUnlocked: [],
                leveledUp: false,
                rewardWithheld: false,
                profile
            };
        }

        const tournamentId = summary.tournamentChampion ? summary.tournamentId.trim() : null;
        const milestoneId = summary.survivalMilestoneReached ? summary.survivalMilestoneId.trim() : null;

        const tournamentAlreadyClaimed = Boolean(tournamentId && profile.claimedTournamentIds.includes(tournamentId));
        const milestoneAlreadyClaimed = Boolean(milestoneId && profile.claimedSurvivalMilestoneIds.includes(milestoneId));

        const xpAwarded = computeMatchXP(summary, {
            tournamentAlreadyClaimed,
            milestoneAlreadyClaimed
        });

        const nextTotalMatches = safeAdd(profile.totalMatches, 1);
        const nextModeMatches = safeAdd(profile.modeStats[mode].matches, 1);
        const nextXp = safeAdd(profile.xp, xpAwarded);
        const outcome = summary.outcome;

        let nextWins = profile.wins;
        let nextLosses = profile.losses;
        let nextDraws = profile.draws;
        let nextModeWins = profile.modeStats[mode].wins;
        let nextModeLosses = profile.modeStats[mode].losses;
        let nextModeDraws = profile.modeStats[mode].draws;
        let nextCurrentStreak = profile.currentStreak;
        let nextBestStreak = profile.bestStreak;

        if (outcome === "win") {
            nextWins = safeAdd(nextWins, 1);
            nextModeWins = safeAdd(nextModeWins, 1);
            nextCurrentStreak = safeAdd(nextCurrentStreak, 1);
            if (nextCurrentStreak > nextBestStreak) {
                nextBestStreak = nextCurrentStreak;
            }
        } else if (outcome === "loss") {
            nextLosses = safeAdd(nextLosses, 1);
            nextModeLosses = safeAdd(nextModeLosses, 1);
            nextCurrentStreak = 0;
        } else {
            nextDraws = safeAdd(nextDraws, 1);
            nextModeDraws = safeAdd(nextModeDraws, 1);
            nextCurrentStreak = 0;
        }

        let nextTournamentsWon = profile.tournamentsWon;
        if (mode === "tournament" && summary.tournamentChampion && !tournamentAlreadyClaimed) {
            nextTournamentsWon = safeAdd(nextTournamentsWon, 1);
        }

        const levelInfo = calculateLevelFromXP(nextXp);

        const updated = JSON.parse(JSON.stringify(profile));
        if (!updated.modeStats.online) {
            updated.modeStats.online = { matches: 0, wins: 0, losses: 0, draws: 0 };
        }
        updated.totalMatches = nextTotalMatches;
        updated.modeStats[mode].matches = nextModeMatches;
        updated.wins = nextWins;
        updated.losses = nextLosses;
        updated.draws = nextDraws;
        updated.modeStats[mode].wins = nextModeWins;
        updated.modeStats[mode].losses = nextModeLosses;
        updated.modeStats[mode].draws = nextModeDraws;
        updated.currentStreak = nextCurrentStreak;
        updated.bestStreak = nextBestStreak;
        updated.tournamentsWon = nextTournamentsWon;
        updated.xp = nextXp;
        updated.level = levelInfo.level;

        if (mode === "tournament" && summary.tournamentChampion && !tournamentAlreadyClaimed) {
            updated.claimedTournamentIds.push(tournamentId);
        }
        if (mode === "survival" && summary.survivalMilestoneReached && !milestoneAlreadyClaimed) {
            updated.claimedSurvivalMilestoneIds.push(milestoneId);
        }
        if (mode === "survival" && typeof summary.survivalScore === "number" && summary.survivalScore > updated.survivalBestScore) {
            updated.survivalBestScore = summary.survivalScore;
        }
        if (mode === "survival" && typeof summary.survivalWins === "number" && summary.survivalWins > updated.survivalBestWins) {
            updated.survivalBestWins = summary.survivalWins;
        }

        const achResult = evaluateAchievements(updated, summary, mode);
        updated.achievements = achResult.achievements;

        updated.recordedMatchIds.push(summary.matchId);
        if (updated.recordedMatchIds.length > MAX_RECORDED_IDS) {
            updated.recordedMatchIds = updated.recordedMatchIds.slice(-MAX_RECORDED_IDS);
        }

        updated.matchHistory.unshift({
            matchId: summary.matchId,
            mode,
            outcome,
            p1Score: isNonNegativeSafeInt(summary.p1Score) ? summary.p1Score : 0,
            p2Score: isNonNegativeSafeInt(summary.p2Score) ? summary.p2Score : 0,
            difficulty: mode === "pvp" ? null : (summary.difficulty || null),
            xpAwarded,
            timestamp: typeof summary.timestamp === "number" && Number.isFinite(summary.timestamp) && summary.timestamp >= 0
                ? summary.timestamp
                : Date.now()
        });
        if (updated.matchHistory.length > 50) {
            updated.matchHistory = updated.matchHistory.slice(0, 50);
        }

        return {
            duplicate: false,
            rewardWithheld: tournamentAlreadyClaimed || milestoneAlreadyClaimed,
            tournamentRewardWithheld: tournamentAlreadyClaimed,
            survivalRewardWithheld: milestoneAlreadyClaimed,
            xpAwarded,
            newlyUnlocked: achResult.newlyUnlocked,
            leveledUp: updated.level > profile.level,
            levelInfo,
            profile: updated
        };
    }

    function getWinRate(profile) {
        if (!profile || !profile.totalMatches) return 0;
        return Math.round((profile.wins / profile.totalMatches) * 100);
    }

    return {
        ACHIEVEMENTS,
        VALID_MODES,
        VALID_OUTCOMES,
        VALID_DIFFICULTIES,
        MAX_RECORDED_IDS,
        getXPForNextLevel,
        calculateLevelFromXP,
        validateProfileStructure,
        computeMatchXP,
        recordMatchResult,
        getWinRate
    };
});
