(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.SPSArena = root.SPSArena || {};
        root.SPSArena.Arena3D = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    function createArena3D(canvasId = "arena-canvas") {
        if (typeof THREE === "undefined" || typeof document === "undefined") {
            return {
                isSupported: false,
                playBattle: (_u, _c, _o, onImpact) => {
                    if (typeof onImpact === "function") setTimeout(onImpact, 180);
                },
                resetIdle: () => {},
                setReducedMotion: () => {},
                setTheme: () => {},
                destroy: () => {}
            };
        }

        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            return {
                isSupported: false,
                playBattle: (_u, _c, _o, onImpact) => {
                    if (typeof onImpact === "function") setTimeout(onImpact, 180);
                },
                resetIdle: () => {},
                setReducedMotion: () => {},
                setTheme: () => {},
                destroy: () => {}
            };
        }

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x070b14, 0.038);

        const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
        const baseCamPos = new THREE.Vector3(0, 3.3, 9.2);
        camera.position.copy(baseCamPos);
        camera.lookAt(0, 0.35, 0);

        // Lighting
        const ambient = new THREE.AmbientLight(0x94a3b8, 0.78);
        const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
        keyLight.position.set(4, 9, 6);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 1024;
        keyLight.shadow.mapSize.height = 1024;

        const playerLight = new THREE.PointLight(0x38bdf8, 2.2, 14);
        playerLight.position.set(-4.5, 2.8, 3);

        const compLight = new THREE.PointLight(0xa855f7, 2.2, 14);
        compLight.position.set(4.5, 2.8, 3);

        scene.add(ambient, keyLight, playerLight, compLight);

        // Arena Floor & Pedestals
        const floorGeo = new THREE.CircleGeometry(14, 64);
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x0b1222, roughness: 0.75, metalness: 0.25 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -1.2;
        floor.receiveShadow = true;
        scene.add(floor);

        const grid = new THREE.GridHelper(26, 36, 0x38bdf8, 0x1e293b);
        grid.position.y = -1.18;
        grid.material.opacity = 0.35;
        grid.material.transparent = true;
        scene.add(grid);

        function createPedestal(x, ringColor) {
            const group = new THREE.Group();
            const base = new THREE.Mesh(
                new THREE.CylinderGeometry(1.3, 1.55, 0.28, 32),
                new THREE.MeshStandardMaterial({ color: 0x162033, roughness: 0.4, metalness: 0.7 })
            );
            base.receiveShadow = true;
            group.add(base);

            const ringMat = new THREE.MeshBasicMaterial({ color: ringColor });
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(1.32, 0.045, 12, 48),
                ringMat
            );
            ring.rotation.x = Math.PI / 2;
            ring.position.y = 0.14;
            group.add(ring);

            group.position.set(x, -1.05, 0);
            scene.add(group);
            return { group, ringMat };
        }

        const p1Ped = createPedestal(-2.7, 0x38bdf8);
        const p2Ped = createPedestal(2.7, 0xa855f7);
        const playerPedestal = p1Ped.group;
        const compPedestal = p2Ped.group;
        const playerRingMat = p1Ped.ringMat;
        const compRingMat = p2Ped.ringMat;

        // Ambient Floating Stars
        const starCount = 160;
        const starGeo = new THREE.BufferGeometry();
        const starPos = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount; i++) {
            starPos[i * 3] = (Math.random() - 0.5) * 26;
            starPos[i * 3 + 1] = Math.random() * 10 - 0.5;
            starPos[i * 3 + 2] = (Math.random() - 0.5) * 20 - 4;
        }
        starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({ color: 0xbae6fd, size: 0.065, transparent: true, opacity: 0.65 });
        const stars = new THREE.Points(starGeo, starMat);
        scene.add(stars);

        // ==========================================
        // Cached Shared Geometries & Materials
        // ==========================================
        const stoneGeo = new THREE.IcosahedronGeometry(0.95, 1);
        const stonePos = stoneGeo.attributes.position;
        for (let i = 0; i < stonePos.count; i++) {
            const vx = stonePos.getX(i);
            const vy = stonePos.getY(i);
            const vz = stonePos.getZ(i);
            const n = 1 + 0.14 * Math.sin(vx * 3.1 + vy * 2.3) * Math.cos(vz * 2.7);
            stonePos.setXYZ(i, vx * n, vy * n * 0.88, vz * n);
        }
        stoneGeo.computeVertexNormals();
        const stoneWireGeo = new THREE.IcosahedronGeometry(0.98, 1);
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.72, metalness: 0.25, flatShading: true });

        const paperGeo = new THREE.BoxGeometry(1.45, 1.85, 0.07, 8, 10, 1);
        const paperPos = paperGeo.attributes.position;
        for (let i = 0; i < paperPos.count; i++) {
            const x = paperPos.getX(i);
            const y = paperPos.getY(i);
            const z = paperPos.getZ(i);
            paperPos.setZ(i, z + Math.sin(y * 2.2) * 0.14 + Math.cos(x * 2.4) * 0.06);
        }
        paperGeo.computeVertexNormals();
        const sheetMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4, metalness: 0.08 });
        const paperLineGeo = new THREE.BoxGeometry(0.85, 0.07, 0.09);

        const bladeGeo = new THREE.BoxGeometry(0.18, 1.45, 0.06);
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.22, metalness: 0.88 });
        const handleGeo = new THREE.TorusGeometry(0.24, 0.055, 12, 24);
        const pivotGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.14, 16);
        const pivotMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9, roughness: 0.2 });

        const accentMaterials = {
            0x38bdf8: {
                wire: new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.28 }),
                basic: new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
                handle: new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.35, metalness: 0.4 })
            },
            0xa855f7: {
                wire: new THREE.MeshBasicMaterial({ color: 0xa855f7, wireframe: true, transparent: true, opacity: 0.28 }),
                basic: new THREE.MeshBasicMaterial({ color: 0xa855f7 }),
                handle: new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.35, metalness: 0.4 })
            }
        };

        function createChoiceModel(type, accentHex) {
            const mats = accentMaterials[accentHex] || accentMaterials[0x38bdf8];
            const group = new THREE.Group();

            if (type === "stone") {
                const rock = new THREE.Mesh(stoneGeo, rockMat);
                rock.castShadow = true;
                const coreWire = new THREE.Mesh(stoneWireGeo, mats.wire);
                coreWire.scale.set(1, 0.88, 1);
                group.add(rock, coreWire);
                return group;
            }

            if (type === "paper") {
                const sheet = new THREE.Mesh(paperGeo, sheetMat);
                sheet.castShadow = true;
                group.add(sheet);
                for (let i = -1; i <= 1; i++) {
                    const line = new THREE.Mesh(paperLineGeo, mats.basic);
                    line.position.set(0, i * 0.35, 0.06);
                    group.add(line);
                }
                group.rotation.x = -0.2;
                return group;
            }

            function makeHalf(angle) {
                const half = new THREE.Group();
                const blade = new THREE.Mesh(bladeGeo, bladeMat);
                blade.position.y = 0.55;
                blade.castShadow = true;
                const handle = new THREE.Mesh(handleGeo, mats.handle);
                handle.position.y = -0.45;
                handle.castShadow = true;
                half.add(blade, handle);
                half.rotation.z = angle;
                return half;
            }

            const leftHalf = makeHalf(0.32);
            const rightHalf = makeHalf(-0.32);
            const pivot = new THREE.Mesh(pivotGeo, pivotMat);
            pivot.rotation.x = Math.PI / 2;
            group.add(leftHalf, rightHalf, pivot);
            group.userData.leftHalf = leftHalf;
            group.userData.rightHalf = rightHalf;
            return group;
        }

        // Particle Bursts
        const bursts = [];
        function spawnBurst(origin, colorHex) {
            if (reducedMotion) return;
            const count = 40;
            const geo = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);
            const velocities = [];
            for (let i = 0; i < count; i++) {
                positions[i * 3] = origin.x;
                positions[i * 3 + 1] = origin.y;
                positions[i * 3 + 2] = origin.z;
                velocities.push(new THREE.Vector3((Math.random() - 0.5) * 0.22, Math.random() * 0.18 + 0.04, (Math.random() - 0.5) * 0.22));
            }
            geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
            const mat = new THREE.PointsMaterial({ color: colorHex, size: 0.14, transparent: true, opacity: 1 });
            const points = new THREE.Points(geo, mat);
            scene.add(points);
            bursts.push({ points, velocities, life: 1 });
        }

        let playerMesh = createChoiceModel("stone", 0x38bdf8);
        let compMesh = createChoiceModel("scissors", 0xa855f7);
        playerMesh.position.set(-2.7, 0.45, 0);
        compMesh.position.set(2.7, 0.45, 0);
        scene.add(playerMesh, compMesh);

        let reducedMotion = Boolean(
            typeof window !== "undefined" &&
            window.matchMedia &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );

        let animState = { phase: "idle", timer: 0, outcome: "draw", shake: 0 };
        let rafId = null;
        let isPaused = false;
        const clock = new THREE.Clock();

        let layout = {
            pedestalX: 2.7,
            modelScale: 1,
            clashX: 0.85,
            winX: 1.35,
            drawX: 2.1
        };

        function applyResponsiveLayout() {
            const w = window.innerWidth || 1;
            const h = window.innerHeight || 1;
            const aspect = w / h;

            if (aspect < 1) {
                camera.fov = 54;
                baseCamPos.set(0, 3.0, Math.min(16.5, Math.max(10.5, 6.2 / aspect)));
                layout = {
                    pedestalX: aspect < 0.55 ? 1.55 : 1.85,
                    modelScale: aspect < 0.55 ? 0.78 : 0.86,
                    clashX: 0.65,
                    winX: 1.0,
                    drawX: 1.45
                };
            } else {
                camera.fov = 48;
                baseCamPos.set(0, 3.3, 9.2);
                layout = {
                    pedestalX: 2.7,
                    modelScale: 1,
                    clashX: 0.85,
                    winX: 1.35,
                    drawX: 2.1
                };
            }

            camera.aspect = aspect;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);

            playerPedestal.position.x = -layout.pedestalX;
            compPedestal.position.x = layout.pedestalX;
            playerPedestal.scale.setScalar(layout.modelScale);
            compPedestal.scale.setScalar(layout.modelScale);

            if (animState.phase === "idle") {
                playerMesh.position.x = -layout.pedestalX;
                compMesh.position.x = layout.pedestalX;
                playerMesh.scale.setScalar(layout.modelScale);
                compMesh.scale.setScalar(layout.modelScale);
            }
        }

        function swapModels(userChoice, compChoice) {
            scene.remove(playerMesh, compMesh);
            playerMesh = createChoiceModel(userChoice, 0x38bdf8);
            compMesh = createChoiceModel(compChoice, 0xa855f7);
            playerMesh.position.set(-layout.pedestalX, 0.45, 0);
            compMesh.position.set(layout.pedestalX, 0.45, 0);
            playerMesh.scale.setScalar(layout.modelScale);
            compMesh.scale.setScalar(layout.modelScale);
            scene.add(playerMesh, compMesh);
        }

        function playBattle(userChoice, compChoice, outcome, onImpact) {
            swapModels(userChoice, compChoice);

            if (reducedMotion) {
                playerMesh.position.set(-layout.winX, 0.55, 0);
                compMesh.position.set(layout.winX, 0.55, 0);
                animState = { phase: "settle", timer: 0.5, outcome, shake: 0 };
                if (typeof onImpact === "function") {
                    setTimeout(onImpact, 120);
                }
                return;
            }

            animState = {
                phase: "windup",
                timer: 0,
                outcome,
                shake: 0,
                onImpact,
                impactFired: false
            };
        }

        function resetIdle() {
            swapModels("stone", "scissors");
            animState = { phase: "idle", timer: 0, outcome: "draw", shake: 0 };
        }

        function setReducedMotion(flag) {
            reducedMotion = Boolean(flag);
        }

        function animate() {
            if (isPaused) return;
            rafId = requestAnimationFrame(animate);
            const dt = Math.min(clock.getDelta(), 0.05);
            const elapsed = clock.getElapsedTime();

            if (!reducedMotion) {
                stars.rotation.y = elapsed * 0.022;
                [playerMesh, compMesh].forEach((mesh) => {
                    if (mesh.userData.leftHalf && mesh.userData.rightHalf) {
                        const snip = Math.sin(elapsed * 5.5) * 0.12 + 0.32;
                        mesh.userData.leftHalf.rotation.z = snip;
                        mesh.userData.rightHalf.rotation.z = -snip;
                    }
                });
            }

            if (animState.phase === "idle" && !reducedMotion) {
                playerMesh.position.y = 0.45 + Math.sin(elapsed * 2.1) * 0.14;
                compMesh.position.y = 0.45 + Math.sin(elapsed * 2.1 + Math.PI) * 0.14;
                playerMesh.rotation.y = elapsed * 0.7;
                compMesh.rotation.y = -elapsed * 0.7;
            } else if (animState.phase === "windup") {
                animState.timer += dt;
                const t = Math.min(animState.timer / 0.4, 1);
                const bounce = Math.abs(Math.sin(t * Math.PI * 2)) * 0.52;
                playerMesh.position.set(-layout.pedestalX - t * 0.3, 0.45 + bounce, 0);
                compMesh.position.set(layout.pedestalX + t * 0.3, 0.45 + bounce, 0);
                playerMesh.rotation.z = t * 0.28;
                compMesh.rotation.z = -t * 0.28;
                if (t >= 1) {
                    animState.phase = "clash";
                    animState.timer = 0;
                }
            } else if (animState.phase === "clash") {
                animState.timer += dt;
                const t = Math.min(animState.timer / 0.2, 1);
                const ease = t * t;
                playerMesh.position.x = THREE.MathUtils.lerp(-(layout.pedestalX + 0.3), -layout.clashX, ease);
                compMesh.position.x = THREE.MathUtils.lerp(layout.pedestalX + 0.3, layout.clashX, ease);
                playerMesh.position.y = 0.65;
                compMesh.position.y = 0.65;

                if (t >= 1) {
                    animState.phase = "settle";
                    animState.timer = 0;
                    animState.shake = reducedMotion ? 0 : 0.28;
                    const burstColor =
                        animState.outcome === "win" ? 0x22c55e : animState.outcome === "lose" ? 0xf43f5e : 0xf59e0b;
                    spawnBurst(new THREE.Vector3(0, 0.65, 0), burstColor);
                    if (animState.onImpact && !animState.impactFired) {
                        animState.impactFired = true;
                        animState.onImpact();
                    }
                }
            } else if (animState.phase === "settle") {
                animState.timer += dt;
                const t = Math.min(animState.timer / 0.55, 1);
                if (animState.outcome === "win") {
                    playerMesh.position.x = THREE.MathUtils.lerp(-layout.clashX, -layout.winX, t);
                    playerMesh.scale.setScalar(layout.modelScale * 1.16);
                    if (!reducedMotion) playerMesh.rotation.y += dt * 4.2;
                    compMesh.position.x = THREE.MathUtils.lerp(layout.clashX, layout.pedestalX, t);
                    compMesh.scale.setScalar(THREE.MathUtils.lerp(layout.modelScale, layout.modelScale * 0.72, t));
                    compMesh.rotation.z = -0.45 * t;
                } else if (animState.outcome === "lose") {
                    compMesh.position.x = THREE.MathUtils.lerp(layout.clashX, layout.winX, t);
                    compMesh.scale.setScalar(layout.modelScale * 1.16);
                    if (!reducedMotion) compMesh.rotation.y -= dt * 4.2;
                    playerMesh.position.x = THREE.MathUtils.lerp(-layout.clashX, -layout.pedestalX, t);
                    playerMesh.scale.setScalar(THREE.MathUtils.lerp(layout.modelScale, layout.modelScale * 0.72, t));
                    playerMesh.rotation.z = 0.45 * t;
                } else {
                    playerMesh.position.x = THREE.MathUtils.lerp(-layout.clashX, -layout.drawX, t);
                    compMesh.position.x = THREE.MathUtils.lerp(layout.clashX, layout.drawX, t);
                }
            }

            if (animState.shake > 0.005) {
                camera.position.x = baseCamPos.x + (Math.random() - 0.5) * animState.shake;
                camera.position.y = baseCamPos.y + (Math.random() - 0.5) * animState.shake;
                animState.shake *= 0.88;
            } else if (!reducedMotion) {
                camera.position.x = baseCamPos.x + Math.sin(elapsed * 0.45) * 0.22;
                camera.position.y = baseCamPos.y;
            } else {
                camera.position.copy(baseCamPos);
            }
            camera.lookAt(0, 0.35, 0);

            for (let i = bursts.length - 1; i >= 0; i--) {
                const b = bursts[i];
                const posAttr = b.points.geometry.attributes.position;
                for (let j = 0; j < b.velocities.length; j++) {
                    const v = b.velocities[j];
                    posAttr.setXYZ(j, posAttr.getX(j) + v.x, posAttr.getY(j) + v.y, posAttr.getZ(j) + v.z);
                    v.y -= 0.006;
                }
                posAttr.needsUpdate = true;
                b.life -= dt * 1.45;
                b.points.material.opacity = Math.max(b.life, 0);
                if (b.life <= 0) {
                    scene.remove(b.points);
                    b.points.geometry.dispose();
                    b.points.material.dispose();
                    bursts.splice(i, 1);
                }
            }

            renderer.render(scene, camera);
        }

        function onResize() {
            applyResponsiveLayout();
        }

        function onVisibilityChange() {
            if (document.hidden) {
                isPaused = true;
                if (rafId !== null) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
            } else if (isPaused) {
                isPaused = false;
                clock.getDelta();
                animate();
            }
        }

        window.addEventListener("resize", onResize);
        document.addEventListener("visibilitychange", onVisibilityChange);
        applyResponsiveLayout();
        animate();

        function setTheme(themeOpts = {}) {
            try {
                if (themeOpts.primaryHex) {
                    const pColor = new THREE.Color(themeOpts.primaryHex);
                    playerLight.color.copy(pColor);
                    playerRingMat.color.copy(pColor);
                    accentMaterials[0x38bdf8].wire.color.copy(pColor);
                    accentMaterials[0x38bdf8].basic.color.copy(pColor);
                    accentMaterials[0x38bdf8].handle.color.copy(pColor);
                }
                if (themeOpts.accentHex) {
                    const aColor = new THREE.Color(themeOpts.accentHex);
                    compLight.color.copy(aColor);
                    compRingMat.color.copy(aColor);
                    accentMaterials[0xa855f7].wire.color.copy(aColor);
                    accentMaterials[0xa855f7].basic.color.copy(aColor);
                    accentMaterials[0xa855f7].handle.color.copy(aColor);
                }
                if (typeof themeOpts.isLight === "boolean") {
                    const bgHex = themeOpts.isLight ? 0xe2e8f0 : 0x070b14;
                    const floorHex = themeOpts.isLight ? 0xcbd5e1 : 0x0b1222;
                    scene.fog.color.setHex(bgHex);
                    floorMat.color.setHex(floorHex);
                    starMat.color.setHex(themeOpts.isLight ? 0x334155 : 0xbae6fd);
                }
            } catch {
                // Ignore invalid color strings
            }
        }

        return {
            isSupported: true,
            playBattle,
            resetIdle,
            setReducedMotion,
            setTheme,
            destroy: () => {
                isPaused = true;
                if (rafId !== null) cancelAnimationFrame(rafId);
                window.removeEventListener("resize", onResize);
                document.removeEventListener("visibilitychange", onVisibilityChange);
                bursts.forEach((b) => {
                    scene.remove(b.points);
                    b.points.geometry.dispose();
                    b.points.material.dispose();
                });
                bursts.length = 0;
                [floorGeo, stoneGeo, stoneWireGeo, paperGeo, paperLineGeo, bladeGeo, handleGeo, pivotGeo, starGeo].forEach((g) => g.dispose());
                [floorMat, rockMat, sheetMat, bladeMat, pivotMat, starMat].forEach((m) => m.dispose());
                Object.values(accentMaterials).forEach((group) => {
                    group.wire.dispose();
                    group.basic.dispose();
                    group.handle.dispose();
                });
                renderer.dispose();
            }
        };
    }

    return { createArena3D };
});
