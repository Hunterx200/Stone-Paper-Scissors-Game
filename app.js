(function () {
    "use strict";

    const { StorageManager } = window.SPSArena.StorageManager;
    const Progression = window.SPSArena.ProgressionManager;
    const Engine = window.SPSArena.GameEngine;
    const { AdaptiveAI } = window.SPSArena.AdaptiveAI;
    const { AudioEngine } = window.SPSArena.AudioEngine;
    const { createArena3D } = window.SPSArena.Arena3D;
    const { OnlineClient } = window.SPSArena.OnlineClient;

    // ==========================================
    // Ready-Made Themes
    // ==========================================
    const THEMES = {
        "ocean-blue": { label: "Ocean Blue", primary: "#38bdf8", accent: "#6366f1", bgDeep: "#070b14", bgRadial: "#111c33", isLight: false },
        "neon-purple": { label: "Neon Purple", primary: "#c084fc", accent: "#ec4899", bgDeep: "#0d0718", bgRadial: "#1f1136", isLight: false },
        "emerald-green": { label: "Emerald Green", primary: "#34d399", accent: "#0ea5e9", bgDeep: "#06130e", bgRadial: "#0d281e", isLight: false },
        "crimson-red": { label: "Crimson Red", primary: "#f43f5e", accent: "#fb923c", bgDeep: "#14070b", bgRadial: "#2c1018", isLight: false },
        "sunset-orange": { label: "Sunset Orange", primary: "#fb923c", accent: "#f43f5e", bgDeep: "#140c06", bgRadial: "#2d1a0d", isLight: false },
        "cyber-cyan": { label: "Cyber Cyan", primary: "#22d3ee", accent: "#a855f7", bgDeep: "#051014", bgRadial: "#0b222c", isLight: false },
        "midnight-dark": { label: "Midnight Dark", primary: "#94a3b8", accent: "#38bdf8", bgDeep: "#05070b", bgRadial: "#0f172a", isLight: false },
        "light-mode": { label: "Light Mode", primary: "#0284c7", accent: "#7c3aed", bgDeep: "#e2e8f0", bgRadial: "#f8fafc", isLight: true }
    };

    const DIFFICULTY_INFO = {
        easy: "Easy — Computer makes random moves.",
        medium: "Medium — Computer tries to notice your playing patterns.",
        impossible: "Impossible — Computer uses stronger pattern-based predictions."
    };

    // ==========================================
    // Core Instances
    // ==========================================
    const storage = new StorageManager();
    let profile = storage.loadProfile().data;
    let settings = storage.loadSettings().data;

    const audio = new AudioEngine({ enabled: settings.soundEnabled, volume: settings.volume });
    const ai = new AdaptiveAI();
    const arena3D = createArena3D("arena-canvas");
    arena3D.setReducedMotion(settings.reducedMotion);
    const onlineClient = new OnlineClient();

    let matchEngine = null;
    let tournamentEngine = null;
    let survivalEngine = null;
    let onlineRoomState = null;
    let currentSession = {
        mode: "pvai",
        difficulty: settings.defaultDifficulty,
        bestOf: settings.defaultBestOf,
        tournamentId: null,
        survivalRunId: null
    };
    let isAnimating = false;
    let toastTimer = null;
    let onModalCloseCallback = null;

    // ==========================================
    // DOM Elements
    // ==========================================
    const menuScreen = document.getElementById("menu-screen");
    const arenaScreen = document.getElementById("arena-screen");
    const modalBackdrop = document.getElementById("modal-backdrop");
    const modalTitle = document.getElementById("modal-title");
    const modalBody = document.getElementById("modal-body");
    const modalClose = document.getElementById("modal-close");
    const pvpHandoff = document.getElementById("pvp-handoff");
    const btnPvpReady = document.getElementById("btn-pvp-ready");
    const toastEl = document.getElementById("toast");

    const menuPlayerName = document.getElementById("menu-player-name");
    const menuPlayerLevel = document.getElementById("menu-player-level");
    const menuPlayerXp = document.getElementById("menu-player-xp");
    const menuPlayerStreak = document.getElementById("menu-player-streak");
    const quickPlayMeta = document.getElementById("quick-play-meta");

    const modeBadge = document.getElementById("mode-badge");
    const p1Label = document.getElementById("p1-label");
    const p2Label = document.getElementById("p2-label");
    const userScoreEl = document.getElementById("user-score");
    const compScoreEl = document.getElementById("computer-score");
    const roundCountEl = document.getElementById("round-count");
    const vsCenterText = document.getElementById("vs-center-text");
    const streakCountEl = document.getElementById("streak-count");
    const msgContainer = document.getElementById("msg-container");
    const reactionBadge = document.getElementById("reaction-badge");
    const msgEl = document.getElementById("msg");
    const subMsgEl = document.getElementById("sub-msg");
    const soundToggleBtn = document.getElementById("sound-toggle");
    const choiceBtns = document.querySelectorAll(".choice");

    // ==========================================
    // Theme Application (Live Preview & Persist)
    // ==========================================
    function applyThemeColors(themeKey, customPrimary, customAccent) {
        const rootStyle = document.documentElement.style;
        const preset = THEMES[themeKey] || THEMES["ocean-blue"];
        const isCustom = themeKey === "custom";
        const primary = isCustom ? (customPrimary || "#38bdf8") : preset.primary;
        const accent = isCustom ? (customAccent || "#a855f7") : preset.accent;
        const bgDeep = isCustom ? "#070b14" : preset.bgDeep;
        const bgRadial = isCustom ? "#111c33" : preset.bgRadial;
        const isLight = !isCustom && Boolean(preset.isLight);

        rootStyle.setProperty("--primary", primary);
        rootStyle.setProperty("--accent", accent);
        rootStyle.setProperty("--bg-deep", bgDeep);
        rootStyle.setProperty("--bg-radial", bgRadial);
        document.body.classList.toggle("theme-light", isLight);

        arena3D.setTheme({ primaryHex: primary, accentHex: accent, isLight });
    }

    // ==========================================
    // Helpers
    // ==========================================
    function capitalize(str) {
        return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, (ch) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[ch]));
    }

    function showToast(text) {
        toastEl.textContent = text;
        toastEl.classList.remove("hidden");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toastEl.classList.add("hidden");
        }, 2800);
    }

    function saveProfileSafe(nextProfile) {
        profile = nextProfile;
        const res = storage.saveProfile(profile);
        if (!res.ok) showToast(`Storage warning: ${res.error}`);
        refreshMenuHeader();
    }

    function saveSettingsSafe(nextSettings) {
        settings = nextSettings;
        audio.setEnabled(settings.soundEnabled);
        audio.setVolume(settings.volume);
        arena3D.setReducedMotion(settings.reducedMotion);
        applyThemeColors(settings.theme, settings.customPrimary, settings.customAccent);
        storage.saveSettings(settings);
        refreshMenuHeader();
    }

    function refreshMenuHeader() {
        menuPlayerName.textContent = profile.playerName;
        menuPlayerLevel.textContent = String(profile.level);
        menuPlayerXp.textContent = String(profile.xp);
        menuPlayerStreak.textContent = String(profile.currentStreak);
        quickPlayMeta.textContent = `Classic · ${capitalize(settings.defaultDifficulty)} · Best of ${settings.defaultBestOf}`;
        soundToggleBtn.textContent = settings.soundEnabled ? "🔊" : "🔇";
    }

    function setChoicesDisabled(disabled) {
        choiceBtns.forEach((btn) => {
            btn.disabled = disabled;
        });
    }

    function openModal(title, htmlContent, onBind, onClose) {
        onModalCloseCallback = typeof onClose === "function" ? onClose : null;
        modalTitle.textContent = title;
        modalBody.innerHTML = htmlContent;
        modalBackdrop.classList.remove("hidden");
        if (typeof onBind === "function") onBind(modalBody);
    }

    function closeModal() {
        if (typeof onModalCloseCallback === "function") {
            const cb = onModalCloseCallback;
            onModalCloseCallback = null;
            cb();
        }
        modalBackdrop.classList.add("hidden");
        modalBody.innerHTML = "";
    }

    function showMenu() {
        closeModal();
        pvpHandoff.classList.add("hidden");
        arenaScreen.classList.add("hidden");
        menuScreen.classList.remove("hidden");
        isAnimating = false;
        arena3D.resetIdle();
        refreshMenuHeader();
    }

    function requestBackToMenu() {
        const isOnlineActive = currentSession.mode === "online" && onlineRoomState && onlineRoomState.status === "playing";
        const isLocalActive = matchEngine && !matchEngine.isCompleted() && matchEngine.getPublicState().round > 0;
        if (isOnlineActive || isLocalActive) {
            openModal(
                "Leave Match?",
                `
                <p class="muted-text">Your current match is still in progress. Returning to the menu will end this match.</p>
                <div class="chip-row">
                    <button id="leave-yes" class="menu-btn danger" type="button">Leave Match</button>
                    <button id="leave-no" class="menu-btn" type="button">Keep Playing</button>
                </div>
                `,
                (body) => {
                    body.querySelector("#leave-yes").addEventListener("click", async () => {
                        if (currentSession.mode === "online") {
                            await onlineClient.leaveRoom();
                            onlineRoomState = null;
                        }
                        showMenu();
                    });
                    body.querySelector("#leave-no").addEventListener("click", closeModal);
                }
            );
            return;
        }
        if (currentSession.mode === "online" && onlineRoomState) {
            onlineClient.leaveRoom();
            onlineRoomState = null;
        }
        showMenu();
    }

    function showArena() {
        closeModal();
        menuScreen.classList.add("hidden");
        arenaScreen.classList.remove("hidden");
    }

    // ==========================================
    // Tutorial / Help
    // ==========================================
    function openTutorialModal(isFirstTime = false) {
        openModal(
            "How to Play",
            `
            <div class="tutorial-step"><span class="step-num">1</span><span>Choose <strong>Stone</strong>, <strong>Paper</strong>, or <strong>Scissors</strong>.</span></div>
            <div class="tutorial-step"><span class="step-num">2</span><span>The computer chooses its move at the same time.</span></div>
            <div class="tutorial-step"><span class="step-num">3</span><span>Stone beats Scissors · Scissors beats Paper · Paper beats Stone.</span></div>
            <div class="tutorial-step"><span class="step-num">4</span><span>First to win the required rounds wins the match and earns XP!</span></div>
            <div class="chip-row mt-1">
                <button id="tut-ok" class="menu-btn primary" type="button">${isFirstTime ? "Got It — Let's Play!" : "Close"}</button>
                ${isFirstTime ? `<button id="tut-skip" class="menu-btn" type="button">Skip</button>` : ""}
            </div>
            `,
            (body) => {
                const finish = () => {
                    if (!settings.tutorialSeen) {
                        saveSettingsSafe(Object.assign({}, settings, { tutorialSeen: true }));
                    }
                    closeModal();
                };
                body.querySelector("#tut-ok").addEventListener("click", finish);
                const skipBtn = body.querySelector("#tut-skip");
                if (skipBtn) skipBtn.addEventListener("click", finish);
            }
        );
    }

    // ==========================================
    // Mode Launchers
    // ==========================================
    function startClassicMatch(difficulty, bestOf) {
        ai.resetLearning();
        currentSession = {
            mode: "pvai",
            difficulty,
            bestOf,
            tournamentId: null,
            survivalRunId: null
        };
        matchEngine = new Engine.MatchEngine({
            mode: "pvai",
            bestOf,
            p1Name: profile.playerName,
            p2Name: `AI (${capitalize(difficulty)})`
        });
        syncArenaHUD(`CLASSIC · ${difficulty.toUpperCase()}`, profile.playerName, `AI (${capitalize(difficulty)})`, `BO${bestOf}`);
        setArenaMessage("Choose your weapon", "Click a card below or press 1, 2, 3");
        arena3D.resetIdle();
        showArena();
    }

    function startPvPMatch(bestOf) {
        currentSession = {
            mode: "pvp",
            difficulty: null,
            bestOf,
            tournamentId: null,
            survivalRunId: null
        };
        matchEngine = new Engine.MatchEngine({
            mode: "pvp",
            bestOf,
            p1Name: "Player 1",
            p2Name: "Player 2"
        });
        syncArenaHUD("LOCAL 2P", "Player 1", "Player 2", `BO${bestOf}`);
        setArenaMessage("Player 1: Choose your move", "Your move stays hidden from Player 2");
        arena3D.resetIdle();
        showArena();
    }

    function startSurvivalRun() {
        ai.resetLearning();
        survivalEngine = new Engine.SurvivalEngine(profile.survivalBestScore);
        currentSession = {
            mode: "survival",
            difficulty: survivalEngine.difficulty,
            bestOf: 1,
            tournamentId: null,
            survivalRunId: `surv_${Date.now()}`
        };
        matchEngine = new Engine.MatchEngine({
            mode: "survival",
            bestOf: 1,
            p1Name: profile.playerName,
            p2Name: survivalEngine.currentOpponent.name
        });
        syncArenaHUD("SURVIVAL", profile.playerName, survivalEngine.currentOpponent.name, `${survivalEngine.score} PTS`);
        setArenaMessage(`Vs ${survivalEngine.currentOpponent.name}`, `Difficulty: ${capitalize(survivalEngine.difficulty)}`);
        arena3D.resetIdle();
        showArena();
    }

    function startTournament(size) {
        tournamentEngine = new Engine.TournamentEngine({
            size,
            playerName: profile.playerName
        });
        currentSession = {
            mode: "tournament",
            difficulty: "medium",
            bestOf: 3,
            tournamentId: `tourney_${Date.now()}`,
            survivalRunId: null
        };
        advanceTournamentAIOnly();
        openTournamentModal();
    }

    function advanceTournamentAIOnly() {
        while (tournamentEngine && tournamentEngine.status !== "completed") {
            const next = tournamentEngine.getNextPendingMatch();
            if (!next) break;
            if (next.p1.isHuman || next.p2.isHuman) break;
            tournamentEngine.simulateAIMatch(next.id);
        }
    }

    function playNextTournamentHumanMatch() {
        if (!tournamentEngine) return;
        const active = tournamentEngine.getHumanActiveMatch();
        if (!active) {
            openTournamentModal();
            return;
        }
        ai.resetLearning();
        const opponent = active.p1.isHuman ? active.p2 : active.p1;
        const roundName = tournamentEngine.rounds[active.roundIndex].name;
        matchEngine = new Engine.MatchEngine({
            mode: "tournament",
            bestOf: 3,
            p1Name: profile.playerName,
            p2Name: opponent.name
        });
        syncArenaHUD(`TOURNAMENT · ${roundName.toUpperCase()}`, profile.playerName, opponent.name, "BO3");
        setArenaMessage(`${roundName}: Vs ${opponent.name}`, "Best of 3 — Choose your weapon");
        arena3D.resetIdle();
        showArena();
    }

    function syncArenaHUD(badgeText, p1Text, p2Text, centerText) {
        const st = matchEngine.getPublicState();
        modeBadge.textContent = badgeText;
        p1Label.textContent = p1Text;
        p2Label.textContent = p2Text;
        userScoreEl.textContent = String(st.p1Score);
        compScoreEl.textContent = String(st.p2Score);
        roundCountEl.textContent = String(st.round);
        vsCenterText.textContent = centerText;
        streakCountEl.textContent = currentSession.mode === "survival"
            ? String(survivalEngine.wins)
            : String(profile.currentStreak);
        setChoicesDisabled(false);
        choiceBtns.forEach((b) => b.classList.remove("selected"));
    }

    function setArenaMessage(main, sub, tone = "", reaction = "") {
        msgContainer.classList.remove("win", "lose", "draw");
        if (tone) msgContainer.classList.add(tone);
        if (reaction) {
            reactionBadge.textContent = reaction;
            reactionBadge.classList.remove("hidden");
        } else {
            reactionBadge.textContent = "";
            reactionBadge.classList.add("hidden");
        }
        msgEl.textContent = main;
        subMsgEl.textContent = sub;
    }

    function pickRoundReaction(outcome, st) {
        if (outcome === "draw") return "It's a Draw!";
        if (outcome === "win") {
            if (profile.currentStreak >= 2) return "You're on Fire!";
            if (st.p2Score > st.p1Score) return "What a Comeback!";
            return "Perfect Move!";
        }
        return st.p1Score > 0 ? "Nice Try!" : "Computer Outsmarted You!";
    }

    // ==========================================
    // Gameplay Flow
    // ==========================================
    function handleChoice(move) {
        if (currentSession.mode === "online") {
            handleOnlineChoice(move);
            return;
        }
        if (isAnimating || !matchEngine || matchEngine.isCompleted()) return;
        audio.play("select");

        if (currentSession.mode === "pvp") {
            handlePvPChoice(move);
            return;
        }

        isAnimating = true;
        setChoicesDisabled(true);
        choiceBtns.forEach((b) => b.classList.toggle("selected", b.dataset.choice === move));

        const aiBias = currentSession.mode === "survival" ? survivalEngine.currentOpponent.bias : null;
        const aiDifficulty = currentSession.mode === "survival" ? survivalEngine.difficulty : currentSession.difficulty;
        const oppMove = ai.chooseMove(aiDifficulty, { bias: aiBias });

        const roundRes = matchEngine.playRound(move, oppMove);
        if (!roundRes.ok) {
            isAnimating = false;
            setChoicesDisabled(false);
            return;
        }

        ai.observePlayerMove(move);
        run3DRoundAnimation(roundRes);
    }

    function handlePvPChoice(move) {
        const st = matchEngine.getPublicState();
        if (st.pvpTurn === "p1") {
            const res = matchEngine.submitPvPPlayer1Move(move);
            if (!res.ok) return;
            setChoicesDisabled(true);
            pvpHandoff.classList.remove("hidden");
        } else {
            isAnimating = true;
            setChoicesDisabled(true);
            const roundRes = matchEngine.submitPvPPlayer2Move(move);
            if (!roundRes.ok) {
                isAnimating = false;
                setChoicesDisabled(false);
                return;
            }
            run3DRoundAnimation(roundRes);
        }
    }

    function run3DRoundAnimation(roundRes) {
        const rr = roundRes.roundResult;
        const outcome = rr.winner === "p1" ? "win" : rr.winner === "p2" ? "lose" : "draw";

        setArenaMessage("Clash!", `${capitalize(rr.p1Move)} vs ${capitalize(rr.p2Move)}...`);
        audio.play("launch");

        arena3D.playBattle(rr.p1Move, rr.p2Move, outcome, () => {
            audio.play("impact");
            const st = roundRes.state;
            userScoreEl.textContent = String(st.p1Score);
            compScoreEl.textContent = String(st.p2Score);
            roundCountEl.textContent = String(st.round);

            const reaction = pickRoundReaction(outcome, st);
            if (outcome === "win") {
                setArenaMessage(`${st.p1Name} Wins Round!`, rr.reason, "win", reaction);
                audio.play("win");
            } else if (outcome === "lose") {
                setArenaMessage(`${st.p2Name} Wins Round!`, rr.reason, "lose", reaction);
                audio.play("lose");
            } else {
                setArenaMessage("Draw!", rr.reason, "draw", reaction);
                audio.play("draw");
            }

            setTimeout(() => {
                if (currentSession.mode === "survival") {
                    handleSurvivalPostRound(outcome);
                    return;
                }
                if (roundRes.matchCompleted) {
                    handleMatchCompleted(roundRes);
                } else {
                    isAnimating = false;
                    setChoicesDisabled(false);
                    if (currentSession.mode === "pvp") {
                        setArenaMessage("Player 1: Choose your move", "Your move stays hidden from Player 2");
                    }
                }
            }, 620);
        });
    }

    function handleSurvivalPostRound(outcome) {
        const survRes = survivalEngine.recordRoundOutcome(outcome);
        streakCountEl.textContent = String(survRes.wins);
        vsCenterText.textContent = `${survRes.score} PTS`;

        if (survRes.milestoneReached) {
            const progRes = Progression.recordMatchResult(profile, {
                matchId: `${currentSession.survivalRunId}_m_${survRes.milestoneReached}`,
                mode: "survival",
                outcome: "win",
                survivalMilestoneReached: true,
                survivalMilestoneId: `${currentSession.survivalRunId}_${survRes.milestoneReached}`,
                survivalWins: survRes.wins,
                survivalScore: survRes.score
            });
            saveProfileSafe(progRes.profile);
            audio.play("achievement");
            showToast(`Milestone ${survRes.wins} Wins! +${progRes.xpAwarded} XP`);
        }

        if (survRes.isGameOver) {
            const finalProg = Progression.recordMatchResult(profile, {
                matchId: `${currentSession.survivalRunId}_end`,
                mode: "survival",
                outcome: survRes.wins > 0 ? "win" : "loss",
                survivalWins: survRes.wins,
                survivalScore: survRes.score
            });
            saveProfileSafe(finalProg.profile);
            isAnimating = false;
            openModal(
                "Survival Over",
                `
                <div class="stat-grid">
                    <div class="stat-box"><strong>${survRes.wins}</strong><span>Wins</span></div>
                    <div class="stat-box"><strong>${survRes.score}</strong><span>Score</span></div>
                    <div class="stat-box"><strong>${profile.survivalBestScore}</strong><span>Best Score</span></div>
                </div>
                <button id="surv-replay" class="menu-btn primary" type="button">Play Again</button>
                <button id="surv-menu" class="menu-btn" type="button">Main Menu</button>
                `,
                (body) => {
                    body.querySelector("#surv-replay").addEventListener("click", startSurvivalRun);
                    body.querySelector("#surv-menu").addEventListener("click", showMenu);
                }
            );
            return;
        }

        matchEngine.reset({
            mode: "survival",
            bestOf: 1,
            p1Name: profile.playerName,
            p2Name: survRes.opponent.name
        });
        p2Label.textContent = survRes.opponent.name;
        userScoreEl.textContent = "0";
        compScoreEl.textContent = "0";
        roundCountEl.textContent = "0";
        setArenaMessage(`Next: ${survRes.opponent.name}`, `Difficulty: ${capitalize(survRes.difficulty)}`);
        isAnimating = false;
        setChoicesDisabled(false);
    }

    function handleMatchCompleted(roundRes) {
        const st = roundRes.state;
        const playerWon = roundRes.matchWinner === "p1";

        if (currentSession.mode === "tournament") {
            const active = tournamentEngine.getHumanActiveMatch();
            const winnerObj = playerWon ? (active.p1.isHuman ? active.p1 : active.p2) : (active.p1.isHuman ? active.p2 : active.p1);
            tournamentEngine.recordMatchWinner(active.id, winnerObj.id);
            advanceTournamentAIOnly();

            const isChampion = tournamentEngine.champion && tournamentEngine.champion.isHuman;
            const progRes = Progression.recordMatchResult(profile, {
                matchId: st.matchId,
                mode: "tournament",
                outcome: playerWon ? "win" : "loss",
                p1Score: st.p1Score,
                p2Score: st.p2Score,
                tournamentChampion: Boolean(isChampion),
                tournamentId: isChampion ? currentSession.tournamentId : undefined
            });
            saveProfileSafe(progRes.profile);
            if (isChampion) audio.play("tournament");
            else if (progRes.newlyUnlocked.length > 0) audio.play("achievement");

            isAnimating = false;
            openTournamentModal();
            return;
        }

        const progRes = Progression.recordMatchResult(profile, {
            matchId: st.matchId,
            mode: currentSession.mode,
            outcome: playerWon ? "win" : "loss",
            difficulty: currentSession.mode === "pvai" ? currentSession.difficulty : null,
            p1Score: st.p1Score,
            p2Score: st.p2Score
        });
        saveProfileSafe(progRes.profile);
        streakCountEl.textContent = String(profile.currentStreak);

        // Streak milestones (3, 5, 10) & Achievements
        if (progRes.newlyUnlocked.length > 0) {
            audio.play("achievement");
            const ach = Progression.ACHIEVEMENTS.find((a) => a.id === progRes.newlyUnlocked[0]);
            showToast(`🏅 Achievement Unlocked: ${ach ? ach.title : progRes.newlyUnlocked[0]}!`);
        } else if (playerWon && [3, 5, 10].includes(profile.currentStreak)) {
            audio.play("achievement");
            showToast(`🔥 ${profile.currentStreak}-Win Streak!`);
        } else {
            showToast(`+${progRes.xpAwarded} XP`);
        }

        const unlockedBanner = progRes.newlyUnlocked.length > 0
            ? `<div class="section-card center-text"><strong>🏅 Unlocked: ${escapeHtml(
                Progression.ACHIEVEMENTS.find((a) => a.id === progRes.newlyUnlocked[0])?.title || progRes.newlyUnlocked[0]
            )}</strong></div>`
            : "";

        isAnimating = false;
        openModal(
            playerWon ? `🏆 Victory! ${st.p1Name} Wins` : `Defeat — ${st.p2Name} Wins`,
            `
            <div class="stat-grid">
                <div class="stat-box"><strong>${st.p1Score}</strong><span>${escapeHtml(st.p1Name)}</span></div>
                <div class="stat-box"><strong>${st.p2Score}</strong><span>${escapeHtml(st.p2Name)}</span></div>
                <div class="stat-box"><strong>+${progRes.xpAwarded}</strong><span>XP Earned</span></div>
            </div>
            ${unlockedBanner}
            <button id="match-rematch" class="menu-btn primary" type="button">Rematch</button>
            <button id="match-change-diff" class="menu-btn" type="button">Change Difficulty</button>
            <button id="match-menu" class="menu-btn" type="button">Main Menu</button>
            `,
            (body) => {
                body.querySelector("#match-rematch").addEventListener("click", () => {
                    if (currentSession.mode === "pvp") startPvPMatch(currentSession.bestOf);
                    else startClassicMatch(currentSession.difficulty, currentSession.bestOf);
                });
                body.querySelector("#match-change-diff").addEventListener("click", openGameModesModal);
                body.querySelector("#match-menu").addEventListener("click", showMenu);
            }
        );
    }

    // ==========================================
    // Modals: Game Modes, Tournament, Profile (Stats/Achievements/Challenges), Settings (Themes)
    // ==========================================
    function openGameModesModal() {
        let selDiff = settings.defaultDifficulty;
        let selBo = settings.defaultBestOf;

        openModal(
            "Choose Game Mode",
            `
            <div class="section-card">
                <strong>Classic vs Computer</strong>
                <p class="muted-text" id="diff-desc">${DIFFICULTY_INFO[selDiff]}</p>
                <div class="chip-row" id="mode-diff-chips">
                    <button class="chip ${selDiff === "easy" ? "active" : ""}" data-diff="easy" type="button">Easy</button>
                    <button class="chip ${selDiff === "medium" ? "active" : ""}" data-diff="medium" type="button">Medium</button>
                    <button class="chip ${selDiff === "impossible" ? "active" : ""}" data-diff="impossible" type="button">Impossible</button>
                </div>
                <div class="chip-row" id="mode-bo-chips">
                    <button class="chip ${selBo === 1 ? "active" : ""}" data-bo="1" type="button">Best of 1</button>
                    <button class="chip ${selBo === 3 ? "active" : ""}" data-bo="3" type="button">Best of 3</button>
                    <button class="chip ${selBo === 5 ? "active" : ""}" data-bo="5" type="button">Best of 5</button>
                    <button class="chip ${selBo === 7 ? "active" : ""}" data-bo="7" type="button">Best of 7</button>
                </div>
                <button id="launch-pvai" class="menu-btn primary" type="button">Start Classic Match</button>
            </div>
            <div class="section-card">
                <strong>Local 2 Player</strong>
                <p class="muted-text">Play against a friend on the same device with hidden turns.</p>
                <button id="launch-pvp" class="menu-btn" type="button">Start Local 2P (Best of ${selBo})</button>
            </div>
            <div class="section-card">
                <strong>Knockout Tournament</strong>
                <p class="muted-text">Beat AI challengers in an 8 or 16-player bracket to become Champion.</p>
                <button id="launch-tournament" class="menu-btn" type="button">Open Tournament</button>
            </div>
            <div class="section-card">
                <strong>Survival Mode</strong>
                <p class="muted-text">Win as many rounds in a row as you can! Best: ${profile.survivalBestWins} wins.</p>
                <button id="launch-survival" class="menu-btn" type="button">Start Survival</button>
            </div>
            `,
            (body) => {
                body.querySelectorAll("[data-diff]").forEach((btn) => {
                    btn.addEventListener("click", () => {
                        selDiff = btn.dataset.diff;
                        body.querySelector("#diff-desc").textContent = DIFFICULTY_INFO[selDiff];
                        body.querySelectorAll("[data-diff]").forEach((b) => b.classList.toggle("active", b === btn));
                    });
                });
                body.querySelectorAll("[data-bo]").forEach((btn) => {
                    btn.addEventListener("click", () => {
                        selBo = Number(btn.dataset.bo);
                        body.querySelectorAll("[data-bo]").forEach((b) => b.classList.toggle("active", b === btn));
                        body.querySelector("#launch-pvp").textContent = `Start Local 2P (Best of ${selBo})`;
                    });
                });
                body.querySelector("#launch-pvai").addEventListener("click", () => startClassicMatch(selDiff, selBo));
                body.querySelector("#launch-pvp").addEventListener("click", () => startPvPMatch(selBo));
                body.querySelector("#launch-tournament").addEventListener("click", openTournamentModal);
                body.querySelector("#launch-survival").addEventListener("click", startSurvivalRun);
            }
        );
    }

    function openTournamentModal() {
        if (!tournamentEngine) {
            openModal(
                "Knockout Tournament",
                `
                <p class="muted-text">Compete in a single-elimination bracket against AI challengers.</p>
                <button id="t-start-8" class="menu-btn primary" type="button">Start 8-Player Tournament</button>
                <button id="t-start-16" class="menu-btn" type="button">Start 16-Player Tournament</button>
                `,
                (body) => {
                    body.querySelector("#t-start-8").addEventListener("click", () => startTournament(8));
                    body.querySelector("#t-start-16").addEventListener("click", () => startTournament(16));
                }
            );
            return;
        }

        const active = tournamentEngine.getHumanActiveMatch();
        const roundsHtml = tournamentEngine.rounds.map((r) => `
            <div class="bracket-round">
                <strong>${escapeHtml(r.name)}</strong>
                ${r.matches.map((m) => {
                    const p1 = m.p1 ? escapeHtml(m.p1.name) : "TBD";
                    const p2 = m.p2 ? escapeHtml(m.p2.name) : "BYE";
                    const win = m.winner ? `→ ${escapeHtml(m.winner.name)}` : "";
                    const isActive = active && active.id === m.id;
                    return `<div class="bracket-match ${isActive ? "active" : ""}"><span>${p1} vs ${p2}</span><span>${win}</span></div>`;
                }).join("")}
            </div>
        `).join("");

        const banner = tournamentEngine.status === "completed"
            ? `<div class="section-card center-text"><strong>🏆 Champion: ${escapeHtml(tournamentEngine.champion.name)}</strong></div>`
            : !active
                ? `<div class="section-card center-text"><strong>You were eliminated from the tournament.</strong></div>`
                : "";

        const actionBtn = active
            ? `<button id="t-play-next" class="menu-btn primary" type="button">Play Next Match</button>`
            : `<button id="t-new" class="menu-btn primary" type="button">New Tournament</button>`;

        openModal(
            "Tournament Bracket",
            `${banner}${roundsHtml}${actionBtn}<button id="t-menu" class="menu-btn" type="button">Main Menu</button>`,
            (body) => {
                const playBtn = body.querySelector("#t-play-next");
                if (playBtn) playBtn.addEventListener("click", playNextTournamentHumanMatch);
                const newBtn = body.querySelector("#t-new");
                if (newBtn) newBtn.addEventListener("click", () => {
                    tournamentEngine = null;
                    openTournamentModal();
                });
                body.querySelector("#t-menu").addEventListener("click", () => {
                    if (tournamentEngine.status === "completed" || !active) tournamentEngine = null;
                    showMenu();
                });
            }
        );
    }

    function openProfileModal(initialTab = "overview") {
        let activeTab = initialTab;
        const lv = Progression.calculateLevelFromXP(profile.xp);
        const pct = Math.min(100, Math.round((lv.currentLevelXP / lv.nextLevelXP) * 100));
        const winRate = Progression.getWinRate(profile);
        const unlockedSet = new Set(profile.achievements);

        const challenges = [
            { title: "Win 3 Matches", cur: Math.min(profile.wins, 3), target: 3, reward: "+XP & First Victory" },
            { title: "Win 5 Consecutive Rounds", cur: Math.min(profile.bestStreak, 5), target: 5, reward: "5-Match Win Streak" },
            { title: "Defeat Impossible AI", cur: unlockedSet.has("impossible_victor") ? 1 : 0, target: 1, reward: "Impossible Victory" }
        ];

        function renderTabContent() {
            if (activeTab === "stats") {
                const historyHtml = profile.matchHistory.length
                    ? profile.matchHistory.slice(0, 8).map((m) => `
                        <div class="bracket-match">
                            <span>${escapeHtml(m.mode.toUpperCase())} · ${capitalize(m.outcome)} (${m.p1Score}-${m.p2Score})</span>
                            <span>+${m.xpAwarded} XP</span>
                        </div>
                    `).join("")
                    : `<p class="muted-text">No matches played yet.</p>`;
                return `
                    <div class="stat-grid">
                        <div class="stat-box"><strong>${profile.totalMatches}</strong><span>Matches</span></div>
                        <div class="stat-box"><strong>${winRate}%</strong><span>Win Rate</span></div>
                        <div class="stat-box"><strong>${profile.wins}</strong><span>Wins</span></div>
                        <div class="stat-box"><strong>${profile.losses}</strong><span>Losses</span></div>
                        <div class="stat-box"><strong>${profile.draws}</strong><span>Draws</span></div>
                        <div class="stat-box"><strong>${profile.bestStreak}</strong><span>Best Streak</span></div>
                    </div>
                    <div class="section-card">
                        <strong>Mode Breakdown</strong>
                        ${["pvai", "pvp", "tournament", "survival", "online"].map((m) => {
                            const ms = profile.modeStats[m] || { wins: 0, losses: 0, draws: 0 };
                            return `<div class="form-row"><span>${m.toUpperCase()}</span><span>${ms.wins}W / ${ms.losses}L / ${ms.draws}D</span></div>`;
                        }).join("")}
                    </div>
                    <div class="section-card">
                        <strong>Recent Matches</strong>
                        ${historyHtml}
                    </div>
                `;
            }

            if (activeTab === "achievements") {
                return Progression.ACHIEVEMENTS.map((a) => {
                    const ok = unlockedSet.has(a.id);
                    return `
                        <div class="ach-item ${ok ? "unlocked" : ""}">
                            <div>
                                <strong>${escapeHtml(a.title)}</strong>
                                <p class="muted-text">${escapeHtml(a.description)}</p>
                            </div>
                            <span>${ok ? "✅" : "🔒"}</span>
                        </div>
                    `;
                }).join("");
            }

            if (activeTab === "challenges") {
                return challenges.map((c) => {
                    const done = c.cur >= c.target;
                    const p = Math.round((c.cur / c.target) * 100);
                    return `
                        <div class="section-card">
                            <div class="form-row">
                                <strong>${escapeHtml(c.title)}</strong>
                                <span>${done ? "✅ Done" : `${c.cur} / ${c.target}`}</span>
                            </div>
                            <div class="xp-bar"><div class="xp-fill" style="width:${p}%"></div></div>
                            <span class="muted-text">Reward: ${escapeHtml(c.reward)}</span>
                        </div>
                    `;
                }).join("");
            }

            return `
                <div class="section-card">
                    <label for="profile-name-input"><strong>Player Name</strong></label>
                    <div class="form-row">
                        <input id="profile-name-input" class="text-input" maxlength="24" value="${escapeHtml(profile.playerName)}">
                        <button id="save-name-btn" class="action-btn" type="button">Save</button>
                    </div>
                </div>
                <div class="section-card">
                    <div class="form-row"><strong>Level ${lv.level}</strong><span>${lv.currentLevelXP} / ${lv.nextLevelXP} XP</span></div>
                    <div class="xp-bar"><div class="xp-fill" style="width:${pct}%"></div></div>
                    <span class="muted-text">Total XP: ${profile.xp} · Achievements: ${profile.achievements.length}/${Progression.ACHIEVEMENTS.length}</span>
                </div>
            `;
        }

        function renderProfileShell() {
            openModal(
                "Player Profile",
                `
                <div class="tab-row">
                    <button class="chip ${activeTab === "overview" ? "active" : ""}" data-ptab="overview" type="button">Overview</button>
                    <button class="chip ${activeTab === "stats" ? "active" : ""}" data-ptab="stats" type="button">Statistics</button>
                    <button class="chip ${activeTab === "achievements" ? "active" : ""}" data-ptab="achievements" type="button">Achievements</button>
                    <button class="chip ${activeTab === "challenges" ? "active" : ""}" data-ptab="challenges" type="button">Challenges</button>
                </div>
                <div id="profile-tab-content">${renderTabContent()}</div>
                `,
                (body) => {
                    body.querySelectorAll("[data-ptab]").forEach((btn) => {
                        btn.addEventListener("click", () => {
                            activeTab = btn.dataset.ptab;
                            renderProfileShell();
                        });
                    });
                    const saveBtn = body.querySelector("#save-name-btn");
                    if (saveBtn) {
                        saveBtn.addEventListener("click", () => {
                            const val = body.querySelector("#profile-name-input").value.trim();
                            if (!val) {
                                showToast("Name cannot be empty");
                                return;
                            }
                            const next = JSON.parse(JSON.stringify(profile));
                            next.playerName = val.slice(0, 24);
                            saveProfileSafe(next);
                            showToast("Profile updated");
                        });
                    }
                }
            );
        }

        renderProfileShell();
    }

    function openSettingsModal() {
        let previewTheme = settings.theme;
        let previewPrimary = settings.customPrimary;
        let previewAccent = settings.customAccent;

        const themeSwatchesHtml = Object.entries(THEMES).map(([key, t]) => `
            <button class="theme-swatch ${previewTheme === key ? "active" : ""}" data-theme-key="${key}" type="button">
                <span class="swatch-dots">
                    <span class="swatch-dot" style="background:${t.primary}"></span>
                    <span class="swatch-dot" style="background:${t.accent}"></span>
                </span>
                <span>${escapeHtml(t.label)}</span>
            </button>
        `).join("");

        openModal(
            "Settings",
            `
            <div class="section-card">
                <strong>Appearance & Theme</strong>
                <div class="theme-grid" id="theme-grid">${themeSwatchesHtml}</div>
                <div class="color-picker-row">
                    <span>Custom Primary</span>
                    <input id="pick-primary" class="color-input" type="color" value="${escapeHtml(previewPrimary)}">
                </div>
                <div class="color-picker-row">
                    <span>Custom Accent</span>
                    <input id="pick-accent" class="color-input" type="color" value="${escapeHtml(previewAccent)}">
                </div>
                <div class="chip-row">
                    <button id="theme-apply-btn" class="chip active" type="button">Apply Theme</button>
                    <button id="theme-reset-btn" class="chip" type="button">Reset to Default</button>
                </div>
            </div>

            <div class="section-card">
                <strong>Audio</strong>
                <div class="form-row">
                    <span>Sound Effects</span>
                    <button id="set-sound-btn" class="chip ${settings.soundEnabled ? "active" : ""}" type="button">${settings.soundEnabled ? "On" : "Off"}</button>
                </div>
                <div class="form-row">
                    <span>Volume</span>
                    <input id="set-vol" type="range" min="0" max="100" value="${Math.round(settings.volume * 100)}">
                </div>
            </div>

            <div class="section-card">
                <strong>Gameplay</strong>
                <span class="muted-text">Default Difficulty</span>
                <div class="chip-row">
                    ${["easy", "medium", "impossible"].map((d) => `<button class="chip ${settings.defaultDifficulty === d ? "active" : ""}" data-set-diff="${d}" type="button">${capitalize(d)}</button>`).join("")}
                </div>
                <span class="muted-text">Default Match Length</span>
                <div class="chip-row">
                    ${[1, 3, 5, 7].map((b) => `<button class="chip ${settings.defaultBestOf === b ? "active" : ""}" data-set-bo="${b}" type="button">Best of ${b}</button>`).join("")}
                </div>
            </div>

            <div class="section-card">
                <strong>Accessibility</strong>
                <div class="form-row">
                    <span>Reduced Motion</span>
                    <button id="set-motion-btn" class="chip ${settings.reducedMotion ? "active" : ""}" type="button">${settings.reducedMotion ? "On" : "Off"}</button>
                </div>
            </div>

            <div class="section-card">
                <strong>Reset Progress</strong>
                <button id="set-reset-btn" class="menu-btn danger" type="button">Reset Game Progress</button>
                <div id="reset-confirm-box" class="hidden">
                    <p class="muted-text">Are you sure? This clears XP, stats, and achievements.</p>
                    <div class="chip-row mt-1">
                        <button id="confirm-reset-yes" class="menu-btn danger" type="button">Yes, Reset</button>
                        <button id="confirm-reset-no" class="menu-btn" type="button">Cancel</button>
                    </div>
                </div>
            </div>
            `,
            (body) => {
                function updateSwatchActive() {
                    body.querySelectorAll("[data-theme-key]").forEach((b) => {
                        b.classList.toggle("active", b.dataset.themeKey === previewTheme);
                    });
                }

                body.querySelectorAll("[data-theme-key]").forEach((btn) => {
                    btn.addEventListener("click", () => {
                        previewTheme = btn.dataset.themeKey;
                        updateSwatchActive();
                        applyThemeColors(previewTheme, previewPrimary, previewAccent);
                    });
                });

                body.querySelector("#pick-primary").addEventListener("input", (e) => {
                    previewTheme = "custom";
                    previewPrimary = e.target.value;
                    updateSwatchActive();
                    applyThemeColors(previewTheme, previewPrimary, previewAccent);
                });

                body.querySelector("#pick-accent").addEventListener("input", (e) => {
                    previewTheme = "custom";
                    previewAccent = e.target.value;
                    updateSwatchActive();
                    applyThemeColors(previewTheme, previewPrimary, previewAccent);
                });

                body.querySelector("#theme-apply-btn").addEventListener("click", () => {
                    saveSettingsSafe(Object.assign({}, settings, {
                        theme: previewTheme,
                        customPrimary: previewPrimary,
                        customAccent: previewAccent
                    }));
                    showToast("Theme saved!");
                });

                body.querySelector("#theme-reset-btn").addEventListener("click", () => {
                    previewTheme = "ocean-blue";
                    previewPrimary = "#38bdf8";
                    previewAccent = "#a855f7";
                    body.querySelector("#pick-primary").value = previewPrimary;
                    body.querySelector("#pick-accent").value = previewAccent;
                    updateSwatchActive();
                    saveSettingsSafe(Object.assign({}, settings, {
                        theme: previewTheme,
                        customPrimary: previewPrimary,
                        customAccent: previewAccent
                    }));
                    showToast("Theme reset to Ocean Blue");
                });

                body.querySelector("#set-sound-btn").addEventListener("click", (e) => {
                    const next = Object.assign({}, settings, { soundEnabled: !settings.soundEnabled });
                    saveSettingsSafe(next);
                    e.target.textContent = next.soundEnabled ? "On" : "Off";
                    e.target.classList.toggle("active", next.soundEnabled);
                });

                body.querySelector("#set-vol").addEventListener("input", (e) => {
                    saveSettingsSafe(Object.assign({}, settings, { volume: Number(e.target.value) / 100 }));
                });

                body.querySelectorAll("[data-set-diff]").forEach((btn) => {
                    btn.addEventListener("click", () => {
                        saveSettingsSafe(Object.assign({}, settings, { defaultDifficulty: btn.dataset.setDiff }));
                        body.querySelectorAll("[data-set-diff]").forEach((b) => b.classList.toggle("active", b === btn));
                    });
                });

                body.querySelectorAll("[data-set-bo]").forEach((btn) => {
                    btn.addEventListener("click", () => {
                        saveSettingsSafe(Object.assign({}, settings, { defaultBestOf: Number(btn.dataset.setBo) }));
                        body.querySelectorAll("[data-set-bo]").forEach((b) => b.classList.toggle("active", b === btn));
                    });
                });

                body.querySelector("#set-motion-btn").addEventListener("click", (e) => {
                    const next = Object.assign({}, settings, { reducedMotion: !settings.reducedMotion });
                    saveSettingsSafe(next);
                    e.target.textContent = next.reducedMotion ? "On" : "Off";
                    e.target.classList.toggle("active", next.reducedMotion);
                });

                body.querySelector("#set-reset-btn").addEventListener("click", () => {
                    body.querySelector("#reset-confirm-box").classList.remove("hidden");
                });
                body.querySelector("#confirm-reset-no").addEventListener("click", () => {
                    body.querySelector("#reset-confirm-box").classList.add("hidden");
                });
                body.querySelector("#confirm-reset-yes").addEventListener("click", () => {
                    const res = storage.resetProfile({ force: true });
                    if (res.ok) {
                        profile = res.data;
                        refreshMenuHeader();
                        closeModal();
                        showToast("Progress reset");
                    } else {
                        showToast(`Reset blocked: ${res.error}`);
                    }
                });
            },
            () => {
                // Revert unapplied live preview when modal closes
                applyThemeColors(settings.theme, settings.customPrimary, settings.customAccent);
            }
        );
    }

    // ==========================================
    // Online 1v1 Multiplayer
    // ==========================================
    const ONLINE_ERRORS = {
        SERVER_UNAVAILABLE: "Online 1v1 requires opening the game from the live website.",
        INVALID_ROOM_CODE: "Please enter a valid 6-digit room code.",
        ROOM_NOT_FOUND: "Room not found. Check the code and try again.",
        ROOM_EXPIRED: "This room has expired.",
        ROOM_FULL: "Room is full (2 players maximum).",
        MATCH_ALREADY_STARTED: "This match has already started.",
        RATE_LIMITED: "Too many attempts. Please wait a moment."
    };

    function openOnlineMenuModal() {
        if (!onlineClient.isAvailable()) {
            openModal(
                "Online 1v1",
                `<p class="muted-text">${ONLINE_ERRORS.SERVER_UNAVAILABLE}</p>
                 <button id="online-close-btn" class="menu-btn" type="button">Back</button>`,
                (body) => body.querySelector("#online-close-btn").addEventListener("click", closeModal)
            );
            return;
        }

        openModal(
            "Online 1v1",
            `
            <div class="section-card">
                <strong>Create a Room</strong>
                <p class="muted-text">Start a private match and share the 6-digit room code with a friend.</p>
                <button id="online-create-btn" class="menu-btn primary" type="button">CREATE ROOM</button>
            </div>
            <div class="section-card">
                <strong>Join a Room</strong>
                <p class="muted-text">Enter the 6-digit room code from your friend.</p>
                <div class="form-row">
                    <input id="online-code-input" class="text-input" maxlength="6" inputmode="numeric" placeholder="6-digit code">
                    <button id="online-join-btn" class="action-btn" type="button">JOIN ROOM</button>
                </div>
                <p id="online-error-msg" class="muted-text hidden" style="color:var(--rose)"></p>
            </div>
            `,
            (body) => {
                const errEl = body.querySelector("#online-error-msg");
                function showErr(code) {
                    errEl.textContent = ONLINE_ERRORS[code] || code || "Unable to connect.";
                    errEl.classList.remove("hidden");
                }

                body.querySelector("#online-create-btn").addEventListener("click", async () => {
                    const res = await onlineClient.createRoom(profile.playerName);
                    if (!res.ok) {
                        showErr(res.error);
                        return;
                    }
                    onlineRoomState = res.state;
                    currentSession.mode = "online";
                    renderOnlineLobbyModal();
                });

                body.querySelector("#online-join-btn").addEventListener("click", async () => {
                    const code = body.querySelector("#online-code-input").value.trim();
                    const res = await onlineClient.joinRoom(code, profile.playerName);
                    if (!res.ok) {
                        showErr(res.error);
                        return;
                    }
                    onlineRoomState = res.state;
                    currentSession.mode = "online";
                    renderOnlineLobbyModal();
                });
            }
        );
    }

    function renderOnlineLobbyModal() {
        if (!onlineRoomState) return;
        const st = onlineRoomState;
        const isHost = st.yourPlayerId === st.hostId;
        const me = st.players.find((p) => p.id === st.yourPlayerId);
        const bothConnected = st.players.length === 2 && st.players.every((p) => p.connected);
        const bothReady = bothConnected && st.players.every((p) => p.ready);

        const playersHtml = st.players.map((p) => `
            <div class="player-slot-row">
                <span><strong>${escapeHtml(p.name)}</strong> ${p.id === st.hostId ? "(Host)" : ""}</span>
                <span>${!p.connected ? "Disconnected" : p.ready ? "✅ Ready" : "Not Ready"}</span>
            </div>
        `).join("");

        const waitingNote = st.players.length < 2
            ? `<p class="muted-text center-text">Waiting for Player 2...</p>`
            : `<p class="muted-text center-text">${bothReady ? "Both players ready!" : "Both players must click Ready."}</p>`;

        const bestOfHtml = [3, 5, 7].map((b) => `
            <button class="chip ${st.bestOf === b ? "active" : ""}" data-online-bo="${b}" type="button" ${!isHost ? "disabled" : ""}>Best of ${b}</button>
        `).join("");

        openModal(
            "Online 1v1 Lobby",
            `
            <div class="room-code-box">
                <div>
                    <span class="muted-text">Room Code</span>
                    <div class="room-code-value" id="lobby-room-code">${escapeHtml(st.roomCode)}</div>
                </div>
                <button id="copy-room-code" class="action-btn" type="button">Copy Code</button>
            </div>
            <div class="section-card">
                <strong>Match Length ${isHost ? "(Host)" : "(Host Selects)"}</strong>
                <div class="chip-row">${bestOfHtml}</div>
            </div>
            <div class="section-card">
                <strong>Players</strong>
                ${playersHtml}
                ${waitingNote}
            </div>
            <div class="chip-row">
                <button id="online-ready-btn" class="menu-btn ${me && me.ready ? "primary" : ""}" type="button" ${!bothConnected ? "disabled" : ""}>
                    ${me && me.ready ? "Ready ✅ (Click to Unready)" : "Mark Ready"}
                </button>
                ${isHost ? `<button id="online-start-btn" class="menu-btn primary" type="button" ${!bothReady ? "disabled" : ""}>Start Match</button>` : ""}
                <button id="online-cancel-btn" class="menu-btn danger" type="button">${isHost ? "Cancel Room" : "Leave Room"}</button>
            </div>
            `,
            (body) => {
                body.querySelector("#copy-room-code").addEventListener("click", async () => {
                    try {
                        await navigator.clipboard.writeText(st.roomCode);
                        showToast("Room code copied!");
                    } catch {
                        showToast(`Room Code: ${st.roomCode}`);
                    }
                });

                body.querySelectorAll("[data-online-bo]").forEach((btn) => {
                    btn.addEventListener("click", async () => {
                        await onlineClient.setBestOf(Number(btn.dataset.onlineBo));
                    });
                });

                body.querySelector("#online-ready-btn").addEventListener("click", async () => {
                    if (!me) return;
                    await onlineClient.setReady(!me.ready);
                });

                const startBtn = body.querySelector("#online-start-btn");
                if (startBtn) {
                    startBtn.addEventListener("click", async () => {
                        await onlineClient.startMatch();
                    });
                }

                body.querySelector("#online-cancel-btn").addEventListener("click", async () => {
                    await onlineClient.leaveRoom();
                    onlineRoomState = null;
                    closeModal();
                });
            }
        );
    }

    function syncOnlineArena(st) {
        const me = st.players.find((p) => p.id === st.yourPlayerId) || st.players[0];
        const opp = st.players.find((p) => p.id !== st.yourPlayerId) || st.players[1] || { name: "Opponent", score: 0, connected: false, hasSubmittedMove: false };

        modeBadge.textContent = `ONLINE · ${st.roomCode}`;
        p1Label.textContent = `${me.name} (You)`;
        p2Label.textContent = opp.name;
        userScoreEl.textContent = String(me.score);
        compScoreEl.textContent = String(opp.score);
        roundCountEl.textContent = String(st.round);
        vsCenterText.textContent = `BO${st.bestOf}`;
        streakCountEl.textContent = String(profile.currentStreak);

        if (!isAnimating) {
            if (!opp.connected) {
                setChoicesDisabled(true);
                setArenaMessage("Opponent disconnected", "Waiting for reconnection...", "draw");
            } else if (st.status === "playing") {
                setChoicesDisabled(me.hasSubmittedMove);
                if (me.hasSubmittedMove) {
                    setArenaMessage("You selected your move", "Waiting for opponent...", "");
                } else if (opp.hasSubmittedMove) {
                    setArenaMessage("Opponent is ready!", "Choose your weapon — press 1, 2, or 3");
                } else {
                    setArenaMessage(`Round ${st.round}: Choose your move`, "Opponent is choosing...");
                }
            }
        }
    }

    async function handleOnlineChoice(move) {
        if (isAnimating || !onlineRoomState || onlineRoomState.status !== "playing") return;
        const me = onlineRoomState.players.find((p) => p.id === onlineRoomState.yourPlayerId);
        if (!me || me.hasSubmittedMove) return;

        audio.play("select");
        setChoicesDisabled(true);
        choiceBtns.forEach((b) => b.classList.toggle("selected", b.dataset.choice === move));
        setArenaMessage("You selected your move", "Waiting for opponent...");

        const res = await onlineClient.submitMove(move);
        if (!res.ok) {
            setChoicesDisabled(false);
            showToast(res.error || "Move failed");
        }
    }

    function handleOnlineState(st) {
        if (!st) return;
        onlineRoomState = st;
        currentSession.mode = "online";

        if (st.status === "waiting" || st.status === "lobby") {
            if (arenaScreen.classList.contains("hidden")) {
                renderOnlineLobbyModal();
            } else {
                showMenu();
                renderOnlineLobbyModal();
            }
            return;
        }

        if (st.status === "playing") {
            if (!arenaScreen.classList.contains("hidden") || !modalBackdrop.classList.contains("hidden")) {
                showArena();
            }
            syncOnlineArena(st);
            return;
        }

        if (st.status === "completed" && !isAnimating) {
            syncOnlineArena(st);
            openOnlineResultModal(st);
        }
    }

    function handleOnlineRoundResult(payload) {
        if (!onlineRoomState || !payload || !payload.roundResult) return;
        const rr = payload.roundResult;
        const myId = onlineRoomState.yourPlayerId;
        const iAmP1 = rr.p1Id === myId;
        const myMove = iAmP1 ? rr.p1Move : rr.p2Move;
        const oppMove = iAmP1 ? rr.p2Move : rr.p1Move;
        const outcome = rr.isDraw ? "draw" : rr.winnerId === myId ? "win" : "lose";

        isAnimating = true;
        setChoicesDisabled(true);
        setArenaMessage("Revealing moves...", `${capitalize(myMove)} vs ${capitalize(oppMove)}...`);
        audio.play("launch");

        arena3D.playBattle(myMove, oppMove, outcome, () => {
            audio.play("impact");
            if (outcome === "win") {
                setArenaMessage("You won this round!", rr.reason, "win", "Perfect Move!");
                audio.play("win");
            } else if (outcome === "lose") {
                setArenaMessage("You lost this round", rr.reason, "lose", "Nice Try!");
                audio.play("lose");
            } else {
                setArenaMessage("Draw!", rr.reason, "draw", "It's a Draw!");
                audio.play("draw");
            }

            setTimeout(() => {
                isAnimating = false;
                choiceBtns.forEach((b) => b.classList.remove("selected"));
                if (onlineRoomState) {
                    if (onlineRoomState.status === "completed") {
                        syncOnlineArena(onlineRoomState);
                        openOnlineResultModal(onlineRoomState);
                    } else {
                        syncOnlineArena(onlineRoomState);
                    }
                }
            }, 700);
        });
    }

    function openOnlineResultModal(st) {
        const myId = st.yourPlayerId;
        const me = st.players.find((p) => p.id === myId) || st.players[0];
        const opp = st.players.find((p) => p.id !== myId) || st.players[1];
        const iWon = st.matchWinnerId === myId;
        const votedCount = st.rematchVotes ? st.rematchVotes.length : 0;
        const iVoted = st.rematchVotes && st.rematchVotes.includes(myId);

        // Award server-verified XP once per matchId
        const progRes = Progression.recordMatchResult(profile, {
            matchId: st.matchId,
            mode: "online",
            outcome: iWon ? "win" : "loss",
            p1Score: me.score,
            p2Score: opp.score
        });
        if (!progRes.duplicate) {
            saveProfileSafe(progRes.profile);
            if (progRes.newlyUnlocked.length > 0) audio.play("achievement");
        }

        openModal(
            iWon ? "🏆 Match Completed — You Won!" : "Match Completed — You Lost",
            `
            <div class="stat-grid">
                <div class="stat-box"><strong>${me.score}</strong><span>${escapeHtml(me.name)}</span></div>
                <div class="stat-box"><strong>${opp.score}</strong><span>${escapeHtml(opp.name)}</span></div>
                <div class="stat-box"><strong>+${progRes.xpAwarded}</strong><span>XP Earned</span></div>
            </div>
            <p class="muted-text center-text">${votedCount === 1 ? "Waiting for opponent to agree to rematch (1/2)..." : "Both players must agree to rematch."}</p>
            <button id="online-rematch-btn" class="menu-btn primary" type="button" ${iVoted ? "disabled" : ""}>
                ${iVoted ? "Waiting for Opponent..." : "REMATCH"}
            </button>
            <button id="online-menu-btn" class="menu-btn" type="button">MAIN MENU</button>
            `,
            (body) => {
                body.querySelector("#online-rematch-btn").addEventListener("click", async () => {
                    await onlineClient.requestRematch();
                });
                body.querySelector("#online-menu-btn").addEventListener("click", async () => {
                    await onlineClient.declineRematch();
                    onlineRoomState = null;
                    showMenu();
                });
            }
        );
    }

    onlineClient.onState = handleOnlineState;
    onlineClient.onRoundResult = handleOnlineRoundResult;
    onlineClient.onRoomClosed = (payload) => {
        onlineRoomState = null;
        isAnimating = false;
        const reason = payload && payload.reason === "RECONNECT_TIMEOUT"
            ? "Match abandoned — opponent did not reconnect in time."
            : payload && payload.reason === "REMATCH_DECLINED"
                ? "Rematch declined — opponent left."
                : "Room closed by opponent.";
        showMenu();
        showToast(reason);
    };

    // ==========================================
    // Event Listeners
    // ==========================================
    document.getElementById("btn-quick-play").addEventListener("click", () => {
        startClassicMatch(settings.defaultDifficulty, settings.defaultBestOf);
    });
    document.getElementById("btn-online").addEventListener("click", openOnlineMenuModal);
    document.getElementById("btn-modes").addEventListener("click", openGameModesModal);
    document.getElementById("btn-profile").addEventListener("click", () => openProfileModal("overview"));
    document.getElementById("btn-settings").addEventListener("click", openSettingsModal);
    document.getElementById("btn-help").addEventListener("click", () => openTutorialModal(false));

    document.getElementById("btn-back-menu").addEventListener("click", requestBackToMenu);
    document.getElementById("btn-arena-help").addEventListener("click", () => openTutorialModal(false));
    document.getElementById("btn-arena-settings").addEventListener("click", openSettingsModal);

    modalClose.addEventListener("click", closeModal);
    modalBackdrop.addEventListener("click", (e) => {
        if (e.target === modalBackdrop) closeModal();
    });

    btnPvpReady.addEventListener("click", () => {
        pvpHandoff.classList.add("hidden");
        setChoicesDisabled(false);
        setArenaMessage("Player 2: Choose your move", "Both moves will reveal together!");
    });

    soundToggleBtn.addEventListener("click", () => {
        saveSettingsSafe(Object.assign({}, settings, { soundEnabled: !settings.soundEnabled }));
    });

    document.getElementById("reset-btn").addEventListener("click", () => {
        if (currentSession.mode === "pvp") startPvPMatch(currentSession.bestOf);
        else if (currentSession.mode === "survival") startSurvivalRun();
        else if (currentSession.mode === "tournament") playNextTournamentHumanMatch();
        else startClassicMatch(currentSession.difficulty, currentSession.bestOf);
    });

    choiceBtns.forEach((btn) => {
        btn.addEventListener("click", () => handleChoice(btn.dataset.choice));
    });

    window.addEventListener("keydown", (e) => {
        if (arenaScreen.classList.contains("hidden")) return;
        if (!modalBackdrop.classList.contains("hidden") || !pvpHandoff.classList.contains("hidden")) return;
        if (e.key === "1") handleChoice("stone");
        else if (e.key === "2") handleChoice("paper");
        else if (e.key === "3") handleChoice("scissors");
    });

    // Initial Boot
    applyThemeColors(settings.theme, settings.customPrimary, settings.customAccent);
    refreshMenuHeader();
    if (!settings.tutorialSeen) {
        openTutorialModal(true);
    }
})();
