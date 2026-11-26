(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.SPSArena = root.SPSArena || {};
        root.SPSArena.StorageManager = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const SCHEMA_VERSION = 1;
    const PROFILE_KEY = "sps_arena_profile_v1";
    const SETTINGS_KEY = "sps_arena_settings_v1";
    const MAX_MATCH_HISTORY = 50;
    // Replay-protection cap: only the most recent 200 matchIds are retained to bound localStorage size.
    // Match IDs older than the 200-entry window are evicted and are not guarded against replay.
    const MAX_RECORDED_IDS = 200;
    const VALID_MODES = ["pvai", "pvp", "tournament", "survival", "online"];
    const VALID_OUTCOMES = ["win", "loss", "draw"];
    const VALID_DIFFICULTIES = ["easy", "medium", "impossible"];
    const VALID_THEMES = [
        "ocean-blue",
        "neon-purple",
        "emerald-green",
        "crimson-red",
        "sunset-orange",
        "cyber-cyan",
        "midnight-dark",
        "light-mode",
        "custom"
    ];
    const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

    function createEmptyModeStats() {
        return { matches: 0, wins: 0, losses: 0, draws: 0 };
    }

    function createDefaultProfile() {
        return {
            schemaVersion: SCHEMA_VERSION,
            playerName: "Challenger",
            level: 1,
            xp: 0,
            totalMatches: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            currentStreak: 0,
            bestStreak: 0,
            survivalBestScore: 0,
            survivalBestWins: 0,
            tournamentsWon: 0,
            achievements: [],
            modeStats: {
                pvai: createEmptyModeStats(),
                pvp: createEmptyModeStats(),
                tournament: createEmptyModeStats(),
                survival: createEmptyModeStats(),
                online: createEmptyModeStats()
            },
            matchHistory: [],
            recordedMatchIds: [],
            claimedTournamentIds: [],
            claimedSurvivalMilestoneIds: []
        };
    }

    function createDefaultSettings() {
        return {
            schemaVersion: SCHEMA_VERSION,
            soundEnabled: true,
            volume: 0.7,
            reducedMotion: false,
            defaultBestOf: 3,
            defaultDifficulty: "easy",
            theme: "ocean-blue",
            customPrimary: "#38bdf8",
            customAccent: "#a855f7",
            tutorialSeen: false
        };
    }

    function isNonNegativeSafeInt(val) {
        return typeof val === "number" && Number.isSafeInteger(val) && val >= 0;
    }

    function safeAdd(a, b) {
        const sum = a + b;
        if (!Number.isSafeInteger(sum) || sum < 0) {
            return null;
        }
        return sum;
    }

    function getLevelForXP(totalXP) {
        let level = 1;
        let remaining = totalXP;
        while (level < 1000) {
            const threshold = 100 + (level - 1) * 50;
            if (remaining < threshold) break;
            remaining -= threshold;
            level++;
        }
        return level;
    }

    function isValidModeStats(raw) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
        if (
            !isNonNegativeSafeInt(raw.matches) ||
            !isNonNegativeSafeInt(raw.wins) ||
            !isNonNegativeSafeInt(raw.losses) ||
            !isNonNegativeSafeInt(raw.draws)
        ) {
            return false;
        }
        const wl = safeAdd(raw.wins, raw.losses);
        if (wl === null) return false;
        const total = safeAdd(wl, raw.draws);
        return total !== null && total === raw.matches;
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

    function validateProfile(raw) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return { valid: false, error: "INVALID_PROFILE_OBJECT", data: createDefaultProfile() };
        }
        if (raw.schemaVersion !== SCHEMA_VERSION) {
            return { valid: false, error: "INVALID_SCHEMA_VERSION", data: createDefaultProfile() };
        }
        if (typeof raw.playerName !== "string" || raw.playerName.trim() === "") {
            return { valid: false, error: "INVALID_PLAYER_NAME", data: createDefaultProfile() };
        }
        if (!isNonNegativeSafeInt(raw.level) || raw.level < 1) {
            return { valid: false, error: "INVALID_LEVEL", data: createDefaultProfile() };
        }
        const numericFields = [
            "xp",
            "totalMatches",
            "wins",
            "losses",
            "draws",
            "currentStreak",
            "bestStreak",
            "survivalBestScore",
            "survivalBestWins",
            "tournamentsWon"
        ];
        for (const field of numericFields) {
            if (!isNonNegativeSafeInt(raw[field])) {
                return { valid: false, error: `INVALID_${field.toUpperCase()}`, data: createDefaultProfile() };
            }
        }

        if (getLevelForXP(raw.xp) !== raw.level) {
            return { valid: false, error: "INCONSISTENT_XP_LEVEL", data: createDefaultProfile() };
        }

        const wlTotal = safeAdd(raw.wins, raw.losses);
        const computedTotal = wlTotal === null ? null : safeAdd(wlTotal, raw.draws);
        if (computedTotal === null || computedTotal !== raw.totalMatches) {
            return { valid: false, error: "INCONSISTENT_MATCH_TOTALS", data: createDefaultProfile() };
        }
        if (raw.bestStreak < raw.currentStreak) {
            return { valid: false, error: "INCONSISTENT_STREAK", data: createDefaultProfile() };
        }

        if (!raw.modeStats || typeof raw.modeStats !== "object" || Array.isArray(raw.modeStats)) {
            return { valid: false, error: "MISSING_MODE_STATS", data: createDefaultProfile() };
        }
        let modeMatchSum = 0;
        let modeWinSum = 0;
        let modeLossSum = 0;
        let modeDrawSum = 0;
        for (const mode of VALID_MODES) {
            const ms = raw.modeStats[mode] === undefined && mode === "online"
                ? createEmptyModeStats()
                : raw.modeStats[mode];
            if (!isValidModeStats(ms)) {
                return { valid: false, error: `INVALID_MODE_STATS_${mode.toUpperCase()}`, data: createDefaultProfile() };
            }
            modeMatchSum = safeAdd(modeMatchSum, ms.matches);
            modeWinSum = safeAdd(modeWinSum, ms.wins);
            modeLossSum = safeAdd(modeLossSum, ms.losses);
            modeDrawSum = safeAdd(modeDrawSum, ms.draws);
            if (modeMatchSum === null || modeWinSum === null || modeLossSum === null || modeDrawSum === null) {
                return { valid: false, error: "NUMERIC_OVERFLOW", data: createDefaultProfile() };
            }
        }
        if (
            modeMatchSum !== raw.totalMatches ||
            modeWinSum !== raw.wins ||
            modeLossSum !== raw.losses ||
            modeDrawSum !== raw.draws
        ) {
            return { valid: false, error: "INCONSISTENT_MODE_STATS", data: createDefaultProfile() };
        }

        if (!isUniqueNonEmptyStringArray(raw.achievements)) {
            return { valid: false, error: "INVALID_ACHIEVEMENTS", data: createDefaultProfile() };
        }
        if (!Array.isArray(raw.matchHistory) || !raw.matchHistory.every(isValidMatchRecord)) {
            return { valid: false, error: "INVALID_MATCH_HISTORY", data: createDefaultProfile() };
        }
        if (!isUniqueNonEmptyStringArray(raw.recordedMatchIds)) {
            return { valid: false, error: "INVALID_RECORDED_MATCH_IDS", data: createDefaultProfile() };
        }
        if (!isUniqueNonEmptyStringArray(raw.claimedTournamentIds)) {
            return { valid: false, error: "INVALID_CLAIMED_TOURNAMENT_IDS", data: createDefaultProfile() };
        }
        if (!isUniqueNonEmptyStringArray(raw.claimedSurvivalMilestoneIds)) {
            return { valid: false, error: "INVALID_CLAIMED_SURVIVAL_MILESTONE_IDS", data: createDefaultProfile() };
        }

        const validated = {
            schemaVersion: SCHEMA_VERSION,
            playerName: raw.playerName.trim().slice(0, 24),
            level: raw.level,
            xp: raw.xp,
            totalMatches: raw.totalMatches,
            wins: raw.wins,
            losses: raw.losses,
            draws: raw.draws,
            currentStreak: raw.currentStreak,
            bestStreak: raw.bestStreak,
            survivalBestScore: raw.survivalBestScore,
            survivalBestWins: raw.survivalBestWins,
            tournamentsWon: raw.tournamentsWon,
            achievements: raw.achievements.slice(),
            modeStats: {
                pvai: Object.assign({}, raw.modeStats.pvai),
                pvp: Object.assign({}, raw.modeStats.pvp),
                tournament: Object.assign({}, raw.modeStats.tournament),
                survival: Object.assign({}, raw.modeStats.survival),
                online: Object.assign({}, raw.modeStats.online || createEmptyModeStats())
            },
            matchHistory: raw.matchHistory.slice(0, MAX_MATCH_HISTORY).map((m) => Object.assign({}, m)),
            recordedMatchIds: raw.recordedMatchIds.slice(-MAX_RECORDED_IDS),
            claimedTournamentIds: raw.claimedTournamentIds.slice(),
            claimedSurvivalMilestoneIds: raw.claimedSurvivalMilestoneIds.slice()
        };

        return { valid: true, data: validated };
    }

    function validateSettings(raw) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return { valid: false, error: "INVALID_SETTINGS_OBJECT", data: createDefaultSettings() };
        }
        if (raw.schemaVersion !== SCHEMA_VERSION) {
            return { valid: false, error: "INVALID_SCHEMA_VERSION", data: createDefaultSettings() };
        }
        const validBestOf = [1, 3, 5, 7];

        if (typeof raw.soundEnabled !== "boolean") {
            return { valid: false, error: "INVALID_SOUND_ENABLED", data: createDefaultSettings() };
        }
        if (typeof raw.volume !== "number" || !Number.isFinite(raw.volume) || raw.volume < 0 || raw.volume > 1) {
            return { valid: false, error: "INVALID_VOLUME", data: createDefaultSettings() };
        }
        if (typeof raw.reducedMotion !== "boolean") {
            return { valid: false, error: "INVALID_REDUCED_MOTION", data: createDefaultSettings() };
        }
        if (!validBestOf.includes(raw.defaultBestOf)) {
            return { valid: false, error: "INVALID_DEFAULT_BEST_OF", data: createDefaultSettings() };
        }
        if (!VALID_DIFFICULTIES.includes(raw.defaultDifficulty)) {
            return { valid: false, error: "INVALID_DEFAULT_DIFFICULTY", data: createDefaultSettings() };
        }

        const theme = raw.theme === undefined ? "ocean-blue" : raw.theme;
        if (!VALID_THEMES.includes(theme)) {
            return { valid: false, error: "INVALID_THEME", data: createDefaultSettings() };
        }
        const customPrimary = raw.customPrimary === undefined ? "#38bdf8" : raw.customPrimary;
        const customAccent = raw.customAccent === undefined ? "#a855f7" : raw.customAccent;
        if (typeof customPrimary !== "string" || !HEX_COLOR_RE.test(customPrimary)) {
            return { valid: false, error: "INVALID_CUSTOM_PRIMARY", data: createDefaultSettings() };
        }
        if (typeof customAccent !== "string" || !HEX_COLOR_RE.test(customAccent)) {
            return { valid: false, error: "INVALID_CUSTOM_ACCENT", data: createDefaultSettings() };
        }
        const tutorialSeen = raw.tutorialSeen === undefined ? false : raw.tutorialSeen;
        if (typeof tutorialSeen !== "boolean") {
            return { valid: false, error: "INVALID_TUTORIAL_SEEN", data: createDefaultSettings() };
        }

        return {
            valid: true,
            data: {
                schemaVersion: SCHEMA_VERSION,
                soundEnabled: raw.soundEnabled,
                volume: raw.volume,
                reducedMotion: raw.reducedMotion,
                defaultBestOf: raw.defaultBestOf,
                defaultDifficulty: raw.defaultDifficulty,
                theme,
                customPrimary: customPrimary.toLowerCase(),
                customAccent: customAccent.toLowerCase(),
                tutorialSeen
            }
        };
    }

    function getDefaultStorageAdapter() {
        try {
            if (typeof window !== "undefined" && window.localStorage) {
                return window.localStorage;
            }
        } catch {
            // Fall through to in-memory storage
        }
        const mem = new Map();
        return {
            getItem: (k) => (mem.has(k) ? mem.get(k) : null),
            setItem: (k, v) => mem.set(k, String(v)),
            removeItem: (k) => mem.delete(k)
        };
    }

    class StorageManager {
        constructor(storageAdapter) {
            this.storage = storageAdapter || getDefaultStorageAdapter();
        }

        _inspectExisting(key) {
            let rawString = null;
            try {
                rawString = this.storage.getItem(key);
            } catch (err) {
                return { status: "READ_ERROR", details: err ? err.message : "Read failed" };
            }

            if (rawString === null || rawString === undefined || rawString === "") {
                return { status: "EMPTY" };
            }

            let parsed;
            try {
                parsed = JSON.parse(rawString);
            } catch (err) {
                return { status: "PARSE_ERROR", details: err.message };
            }

            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                return { status: "INVALID_SHAPE" };
            }

            if (typeof parsed.schemaVersion !== "number" || !Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 1) {
                return { status: "INVALID_SCHEMA_VERSION" };
            }

            if (parsed.schemaVersion > SCHEMA_VERSION) {
                return { status: "FUTURE_SCHEMA", schemaVersion: parsed.schemaVersion };
            }

            if (parsed.schemaVersion < SCHEMA_VERSION) {
                return { status: "UNSUPPORTED_OLDER_SCHEMA", schemaVersion: parsed.schemaVersion };
            }

            return { status: "CURRENT_SCHEMA", parsed };
        }

        _safeRead(key, validator, defaultsFactory) {
            const inspected = this._inspectExisting(key);
            if (inspected.status === "EMPTY") {
                return { ok: true, isNew: true, data: defaultsFactory() };
            }
            if (inspected.status === "READ_ERROR") {
                return { ok: false, error: "READ_ERROR", details: inspected.details, data: defaultsFactory() };
            }
            if (inspected.status === "PARSE_ERROR") {
                return { ok: false, error: "PARSE_ERROR", details: inspected.details, data: defaultsFactory() };
            }
            if (
                inspected.status === "INVALID_SHAPE" ||
                inspected.status === "INVALID_SCHEMA_VERSION" ||
                inspected.status === "UNSUPPORTED_OLDER_SCHEMA"
            ) {
                return { ok: false, error: inspected.status, data: defaultsFactory() };
            }
            if (inspected.status === "FUTURE_SCHEMA") {
                return {
                    ok: false,
                    error: "UNSUPPORTED_FUTURE_SCHEMA",
                    schemaVersion: inspected.schemaVersion,
                    data: defaultsFactory()
                };
            }

            const result = validator(inspected.parsed);
            if (!result.valid) {
                return { ok: false, error: result.error || "VALIDATION_ERROR", data: result.data };
            }
            return { ok: true, isNew: false, data: result.data };
        }

        _safeWrite(key, data) {
            try {
                const serialized = JSON.stringify(data);
                this.storage.setItem(key, serialized);
                return { ok: true };
            } catch (err) {
                const isQuota = err && (err.name === "QuotaExceededError" || err.code === 22 || err.code === 1014);
                return {
                    ok: false,
                    error: isQuota ? "QUOTA_EXCEEDED" : "WRITE_ERROR",
                    details: err ? err.message : "Unknown storage error"
                };
            }
        }

        _canSaveOverExisting(key, validator, options = {}) {
            const inspected = this._inspectExisting(key);

            if (inspected.status === "EMPTY") {
                return { allowed: true };
            }
            if (inspected.status === "READ_ERROR") {
                return { allowed: false, error: "READ_ERROR" };
            }
            if (inspected.status === "FUTURE_SCHEMA") {
                return { allowed: false, error: "FUTURE_SCHEMA_PROTECTED" };
            }
            // Never allow allowOverwriteMalformed to bypass parse errors, invalid shapes, or invalid schema versions
            if (inspected.status !== "CURRENT_SCHEMA") {
                return { allowed: false, error: "EXISTING_DATA_UNREADABLE" };
            }

            const existingValidation = validator(inspected.parsed);
            if (!existingValidation.valid) {
                const allowRecovery = Boolean(options && options.allowOverwriteMalformed === true);
                return allowRecovery
                    ? { allowed: true }
                    : { allowed: false, error: "EXISTING_DATA_UNREADABLE" };
            }

            return { allowed: true };
        }

        _canResetExisting(key, options = {}) {
            const inspected = this._inspectExisting(key);
            if (inspected.status === "READ_ERROR") {
                return { allowed: false, error: "READ_ERROR" };
            }
            if (inspected.status === "FUTURE_SCHEMA") {
                return { allowed: false, error: "FUTURE_SCHEMA_PROTECTED" };
            }
            if (inspected.status === "EMPTY" || inspected.status === "CURRENT_SCHEMA") {
                return { allowed: true };
            }
            // Unreadable / malformed / invalid schema: require explicit { force: true }
            return options && options.force === true
                ? { allowed: true }
                : { allowed: false, error: "EXISTING_DATA_UNREADABLE" };
        }

        loadProfile() {
            return this._safeRead(PROFILE_KEY, validateProfile, createDefaultProfile);
        }

        saveProfile(profile, options = {}) {
            const guard = this._canSaveOverExisting(PROFILE_KEY, validateProfile, options);
            if (!guard.allowed) {
                return { ok: false, error: guard.error };
            }
            const validated = validateProfile(profile);
            if (!validated.valid) {
                return { ok: false, error: validated.error || "VALIDATION_ERROR" };
            }
            return this._safeWrite(PROFILE_KEY, validated.data);
        }

        loadSettings() {
            return this._safeRead(SETTINGS_KEY, validateSettings, createDefaultSettings);
        }

        saveSettings(settings, options = {}) {
            const guard = this._canSaveOverExisting(SETTINGS_KEY, validateSettings, options);
            if (!guard.allowed) {
                return { ok: false, error: guard.error };
            }
            const validated = validateSettings(settings);
            if (!validated.valid) {
                return { ok: false, error: validated.error || "VALIDATION_ERROR" };
            }
            return this._safeWrite(SETTINGS_KEY, validated.data);
        }

        resetProfile(options = {}) {
            const guard = this._canResetExisting(PROFILE_KEY, options);
            if (!guard.allowed) {
                return { ok: false, error: guard.error };
            }
            const fresh = createDefaultProfile();
            const res = this._safeWrite(PROFILE_KEY, fresh);
            if (!res.ok) {
                return { ok: false, error: res.error, details: res.details };
            }
            return { ok: true, data: fresh };
        }

        resetSettings(options = {}) {
            const guard = this._canResetExisting(SETTINGS_KEY, options);
            if (!guard.allowed) {
                return { ok: false, error: guard.error };
            }
            const fresh = createDefaultSettings();
            const res = this._safeWrite(SETTINGS_KEY, fresh);
            if (!res.ok) {
                return { ok: false, error: res.error, details: res.details };
            }
            return { ok: true, data: fresh };
        }
    }

    return {
        SCHEMA_VERSION,
        PROFILE_KEY,
        SETTINGS_KEY,
        MAX_MATCH_HISTORY,
        MAX_RECORDED_IDS,
        StorageManager,
        createDefaultProfile,
        createDefaultSettings,
        validateProfile,
        validateSettings
    };
});
