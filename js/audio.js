(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.SPSArena = root.SPSArena || {};
        root.SPSArena.AudioEngine = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    class AudioEngine {
        constructor(options = {}) {
            this.enabled = typeof options.enabled === "boolean" ? options.enabled : true;
            this.volume = typeof options.volume === "number" && Number.isFinite(options.volume)
                ? Math.min(1, Math.max(0, options.volume))
                : 0.7;
            this._ctx = null;
        }

        setEnabled(enabled) {
            this.enabled = Boolean(enabled);
        }

        setVolume(vol) {
            if (typeof vol === "number" && Number.isFinite(vol)) {
                this.volume = Math.min(1, Math.max(0, vol));
            }
        }

        _ensureContext() {
            if (typeof window === "undefined") return null;
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return null;
            if (!this._ctx) {
                this._ctx = new AudioCtx();
            }
            if (this._ctx.state === "suspended") {
                this._ctx.resume().catch(() => {});
            }
            return this._ctx;
        }

        playTone(freq, duration, type = "sine", gainScale = 0.14, delay = 0) {
            if (!this.enabled || this.volume <= 0) return;
            try {
                const ctx = this._ensureContext();
                if (!ctx) return;

                const startAt = ctx.currentTime + delay;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                const targetGain = Math.max(0.002, gainScale * this.volume);

                osc.type = type;
                osc.frequency.setValueAtTime(freq, startAt);

                gain.gain.setValueAtTime(0.001, startAt);
                gain.gain.exponentialRampToValueAtTime(targetGain, startAt + 0.018);
                gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(startAt);
                osc.stop(startAt + duration);
            } catch {
                // Ignore Web Audio errors when blocked
            }
        }

        play(cue) {
            switch (cue) {
                case "select":
                    this.playTone(540, 0.08, "sine", 0.1);
                    break;
                case "countdown":
                    this.playTone(420, 0.09, "triangle", 0.11);
                    break;
                case "launch":
                    this.playTone(260, 0.14, "triangle", 0.13);
                    this.playTone(390, 0.16, "triangle", 0.11, 0.08);
                    break;
                case "impact":
                    this.playTone(130, 0.18, "sawtooth", 0.16);
                    this.playTone(95, 0.22, "triangle", 0.14, 0.03);
                    break;
                case "win":
                    this.playTone(523.25, 0.15, "sine", 0.16, 0);
                    this.playTone(659.25, 0.15, "sine", 0.16, 0.09);
                    this.playTone(783.99, 0.28, "sine", 0.18, 0.18);
                    break;
                case "lose":
                    this.playTone(300, 0.18, "sawtooth", 0.11, 0);
                    this.playTone(210, 0.3, "sawtooth", 0.11, 0.12);
                    break;
                case "draw":
                    this.playTone(440, 0.14, "triangle", 0.12, 0);
                    this.playTone(440, 0.16, "triangle", 0.12, 0.14);
                    break;
                case "achievement":
                    this.playTone(587.33, 0.12, "sine", 0.15, 0);
                    this.playTone(783.99, 0.12, "sine", 0.15, 0.09);
                    this.playTone(1046.5, 0.28, "sine", 0.17, 0.18);
                    break;
                case "tournament":
                    this.playTone(523.25, 0.14, "triangle", 0.16, 0);
                    this.playTone(659.25, 0.14, "triangle", 0.16, 0.11);
                    this.playTone(783.99, 0.14, "triangle", 0.16, 0.22);
                    this.playTone(1046.5, 0.36, "sine", 0.2, 0.33);
                    break;
                default:
                    break;
            }
        }
    }

    return { AudioEngine };
});
