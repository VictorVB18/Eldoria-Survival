import './style.css';
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { registerCollider, resolveCollisions } from './physics.js';

// --- CONFIG ---
const WORLD_SIZE = 2000;
const WORLD_BORDER = WORLD_SIZE * 0.48; // ~960 — hard border edge
const TILE_RES = 150; 
const noise2D = createNoise2D();

// --- ENGINE SETUP ---
const textureLoader = new THREE.TextureLoader();
const menuBgTexture = textureLoader.load('/menu_bg.png');

const scene = new THREE.Scene();
scene.background = menuBgTexture;
scene.fog = new THREE.FogExp2(0x87ceeb, 0.0018); // Tighter fog culls distant objects

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.getElementById('app').appendChild(renderer.domElement);
renderer.autoClear = false; // Important for multi-pass rendering

// --- UI SCENE FOR INVENTORY ---
const uiScene = new THREE.Scene();
const uiCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
uiCamera.position.set(0, 1.2, 4);

const uiAmbient = new THREE.AmbientLight(0xffffff, 1.2);
uiScene.add(uiAmbient);

const uiDirLight = new THREE.DirectionalLight(0xffeedd, 1.5);
uiDirLight.position.set(5, 5, 5);
uiScene.add(uiDirLight);

const uiBackLight = new THREE.DirectionalLight(0xddddff, 1.0);
uiBackLight.position.set(-5, 5, -5);
uiScene.add(uiBackLight);

let uiPlayer = null;

// --- LIGHTING ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const sun = new THREE.DirectionalLight(0xfff0dd, 1.2);
sun.position.set(100, 200, 100);
sun.castShadow = true;
scene.add(sun);

const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444444, 0.5);
scene.add(hemiLight);

// --- TERRAIN & BIOMES ---
const BIOMES = {
    LUSH: 0,
    MAGIC: 1,
    GOLDEN: 2,
    CRYSTAL: 3
};

function getBiomeData(x, z) {
    const islandNoise = noise2D(x * 0.002, z * 0.002);
    if (islandNoise <= -0.5) return { type: BIOMES.LUSH, h: -20 }; 
    
    const bNoise = noise2D(x * 0.0015, z * 0.0015);
    let type = BIOMES.LUSH;
    if (bNoise < -0.3) type = BIOMES.MAGIC;
    else if (bNoise > 0.4) type = BIOMES.GOLDEN;
    else if (bNoise > 0.1 && bNoise <= 0.4) type = BIOMES.CRYSTAL;

    let h = noise2D(x * 0.005, z * 0.005) * 3; // Base rolling hills
    
    // Mountains - Reduced frequency so there are fewer mountains
    let m = noise2D(x * 0.002, z * 0.002);
    if (type === BIOMES.CRYSTAL) {
        if (m > 0.3) h += Math.pow((m - 0.3) * 2, 2) * 120;
    } else {
        if (m > 0.65) h += Math.pow((m - 0.65) * 3, 2) * 80;
    }
    
    let hills = noise2D(x * 0.012, z * 0.012);
    if (hills > 0.5) h += (hills - 0.5) * 12;
    
    return { type, h };
}

function getTerrainHeight(x, z) {
    return getBiomeData(x, z).h;
}

const terrainGeometry = new THREE.PlaneGeometry(WORLD_SIZE * 4, WORLD_SIZE * 4, TILE_RES * 2, TILE_RES * 2);
terrainGeometry.rotateX(-Math.PI / 2);
const posAttr = terrainGeometry.getAttribute('position');
terrainGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(posAttr.count * 3), 3));
const colorAttr = terrainGeometry.getAttribute('color');

for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const biome = getBiomeData(x, z);
    const h = biome.h;
    posAttr.setY(i, h);
    
    let col = new THREE.Color();
    if (h < -3) col.setHex(0x3a2f24); // Dark sand
    else if (h < 0) col.setHex(0x4a3b2c); // Dark dirt
    else {
        if (biome.type === BIOMES.MAGIC) col.setHex(0x1d0b36); // Darker magic grass
        else if (biome.type === BIOMES.GOLDEN) col.setHex(0x8a6a1c); // Darker golden grass
        else if (biome.type === BIOMES.CRYSTAL) col.setHex(0x455a64); // Darker crystal ground
        else col.setHex(0x2e3b22); // Moody dark green grass
        
        if (h > 15) {
            let rockColor = new THREE.Color(0x2a2421); // Dark brown-grey rock
            if (biome.type === BIOMES.MAGIC) rockColor.setHex(0x10101c);
            if (biome.type === BIOMES.GOLDEN) rockColor.setHex(0x4a2c11);
            
            let blend = Math.min((h - 15) / 10, 1);
            col.lerp(rockColor, blend);
            
            if (h > 35) {
                let snowColor = new THREE.Color(0xffebc2); // Warm snow to match sunset vibe
                if (biome.type === BIOMES.MAGIC) snowColor.setHex(0x008888);
                if (biome.type === BIOMES.GOLDEN) snowColor.setHex(0xb89500);
                let snowBlend = Math.min((h - 35) / 15, 1);
                col.lerp(snowColor, snowBlend);
            }
        }
    }
    colorAttr.setXYZ(i, col.r, col.g, col.b);
}
terrainGeometry.computeVertexNormals();
const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true }));
terrain.receiveShadow = true;

// Group for all 3D world objects — hidden on the menu screen
const worldGroup = new THREE.Group();
scene.add(worldGroup);
worldGroup.add(terrain);

// --- PLAYER ---
const player = new THREE.Group();

const skinMat = new THREE.MeshStandardMaterial({ color: 0xffccaa });
const shirtMat = new THREE.MeshStandardMaterial({ color: 0x556b2f });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
const bagMat = new THREE.MeshStandardMaterial({ color: 0x3e2723 });
const shoeMat = new THREE.MeshStandardMaterial({ color: 0x212121 });

const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.4), shirtMat);
torso.position.y = 1.0;
torso.castShadow = true;
player.add(torso);

const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skinMat);
head.position.y = 1.75;
head.castShadow = true;
player.add(head);

const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), eyeMat);
leftEye.position.set(-0.1, 0.1, 0.25);
const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), eyeMat);
rightEye.position.set(0.1, 0.1, 0.25);
head.add(leftEye, rightEye);

const hairMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
const beardMat = new THREE.MeshStandardMaterial({ color: 0x222222 });

const hairGroup = new THREE.Group();
head.add(hairGroup);
const beardGroup = new THREE.Group();
head.add(beardGroup);

const hairStyles = {
    none: new THREE.Group(),
    short: (() => {
        const g = new THREE.Group();
        const main = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.15, 0.55), hairMat);
        main.position.y = 0.25;
        g.add(main);
        return g;
    })(),
    spiky: (() => {
        const g = new THREE.Group();
        for(let i=0; i<6; i++) {
            const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), hairMat);
            spike.position.set((Math.random()-0.5)*0.4, 0.25, (Math.random()-0.5)*0.4);
            spike.rotation.set((Math.random()-0.5), (Math.random()-0.5), (Math.random()-0.5));
            g.add(spike);
        }
        return g;
    })(),
    curly: (() => {
        const g = new THREE.Group();
        for(let i=0; i<15; i++) {
            const curl = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 5), hairMat);
            curl.position.set((Math.random()-0.5)*0.4, 0.25 + Math.random()*0.1, (Math.random()-0.5)*0.4);
            g.add(curl);
        }
        return g;
    })(),
    long: (() => {
        const g = new THREE.Group();
        const main = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.55), hairMat);
        main.position.y = 0.25;
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.2), hairMat);
        back.position.set(0, -0.1, -0.25);
        g.add(main, back);
        return g;
    })(),
    ponytail: (() => {
        const g = new THREE.Group();
        const main = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.15, 0.55), hairMat);
        main.position.y = 0.25;
        const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 0.4, 5), hairMat);
        tail.position.set(0, 0.1, -0.3);
        tail.rotation.x = -Math.PI / 4;
        g.add(main, tail);
        return g;
    })()
};

const beardStyles = {
    none: new THREE.Group(),
    stubble: (() => {
        const g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.15, 0.52), beardMat);
        b.position.set(0, -0.15, 0);
        g.add(b);
        return g;
    })(),
    mustache: (() => {
        const g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.08), beardMat);
        b.position.set(0, -0.05, 0.26);
        g.add(b);
        return g;
    })(),
    goatee: (() => {
        const g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.1), beardMat);
        b.position.set(0, -0.2, 0.26);
        g.add(b);
        return g;
    })(),
    full: (() => {
        const g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.2), beardMat);
        b.position.set(0, -0.2, 0.2);
        g.add(b);
        return g;
    })()
};

function updateHair(style) {
    hairGroup.clear();
    if(hairStyles[style]) hairGroup.add(hairStyles[style]);
}
function updateBeard(style) {
    beardGroup.clear();
    if(beardStyles[style]) beardGroup.add(beardStyles[style]);
}

updateHair('spiky');
updateBeard('none');

function createLimb(w, h, d, mat, yOffset) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.y = -h / 2 + yOffset;
    mesh.castShadow = true;
    group.add(mesh);
    return group;
}

const leftArm = createLimb(0.25, 0.9, 0.25, skinMat, 0.1);
leftArm.position.set(-0.5, 1.45, 0);
player.add(leftArm);

const rightArm = createLimb(0.25, 0.9, 0.25, skinMat, 0.1);
rightArm.position.set(0.5, 1.45, 0);
player.add(rightArm);

const leftLeg = createLimb(0.3, 0.9, 0.3, pantsMat, 0);
leftLeg.position.set(-0.2, 0.9, 0);
const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.15, 0.4), shoeMat);
leftShoe.position.set(0, -0.825, 0.05);
leftShoe.castShadow = true;
leftLeg.add(leftShoe);
player.add(leftLeg);

const rightLeg = createLimb(0.3, 0.9, 0.3, pantsMat, 0);
rightLeg.position.set(0.2, 0.9, 0);
const rightShoe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.15, 0.4), shoeMat);
rightShoe.position.set(0, -0.825, 0.05);
rightShoe.castShadow = true;
rightLeg.add(rightShoe);
player.add(rightLeg);

player.userData.limbs = { leftArm, rightArm, leftLeg, rightLeg };

const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.3), bagMat);
backpack.position.set(0, 1.1, -0.35); // Back of character (-Z side)
backpack.castShadow = true;
player.add(backpack);

scene.add(player);

const cameraPivot = new THREE.Object3D();
player.add(cameraPivot);
cameraPivot.add(camera);
camera.position.set(0, 5, 12);

// --- STATE ---
let gameStarted = false;
let isPaused = false;
let isInventoryOpen = false;
let lastTime = 0;
let dayTime = 0.25; // 0.25 = noon, 0.75 = midnight
const state = {
    pos: new THREE.Vector3(0, 20, 0),
    velY: 0,
    isGrounded: false,
    health: 100,
    hunger: 100,
    xp: 0,
    level: 1
};

// --- NPC DIALOG STATE ---
const VILLAGER_LINES = [
    "The wolves have been restless near the Magic Forest lately...",
    "I heard there's a floating island somewhere to the east. They say ancient ruins are up there!",
    "Strange crystals have been appearing on the mountain peaks. Some glow at night.",
    "A merchant passed through last week. He spoke of a dragon spotted over the Golden Plains!",
    "Be careful out there, traveller. The shadows move on their own after dark.",
    "My crops haven't grown right since that strange fog rolled in from the north.",
    "The castle on the hill... I've seen lights in the towers at midnight. No one lives there.",
    "They say if you climb high enough, you can see the entire realm from the peaks.",
    "I'd leave this village myself, if I had a sword like yours.",
    "Have you seen the bears in the forest? Stay well clear of them!",
];
let dialogOpen = false;
let nearVillager = null;
const interactPrompt = document.getElementById('interact-prompt');
const dialogBox = document.getElementById('dialog-box');
const dialogText = document.getElementById('dialog-text');
const npcRaycaster = new THREE.Raycaster();

let isCustomizing = false;
const playBtn = document.getElementById('play-button');
const customizeBtn = document.getElementById('customize-button');
const loreBtn = document.getElementById('lore-button');
const controlsBtn = document.getElementById('controls-button');

const mainMenu = document.getElementById('main-menu');
const hud = document.getElementById('hud');

const controlsModal = document.getElementById('controls-modal');
const loreModal = document.getElementById('lore-modal');
const customizerModal = document.getElementById('customizer-modal');

document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        if(controlsModal) controlsModal.classList.add('hidden');
        if(loreModal) loreModal.classList.add('hidden');
        if(customizerModal) {
            customizerModal.classList.add('hidden');
            mainMenu.classList.remove('hidden'); // Restore main menu when done customizing
        }
        isCustomizing = false;
    });
});

const saveSlotsModal = document.getElementById('save-slots-modal');
const ingamePauseModal = document.getElementById('ingame-pause');
let currentSaveSlot = 1;

function getSaveData(slot) {
    const data = localStorage.getItem(`eldoria_save_${slot}`);
    return data ? JSON.parse(data) : null;
}

function setSaveData(slot, data) {
    localStorage.setItem(`eldoria_save_${slot}`, JSON.stringify(data));
}

function deleteSaveData(slot) {
    localStorage.removeItem(`eldoria_save_${slot}`);
}

function updateSaveSlotsUI() {
    for (let i = 1; i <= 4; i++) {
        const data = getSaveData(i);
        const slotEl = document.getElementById(`slot-${i}`);
        if (!slotEl) continue;
        const nameEl = slotEl.querySelector('.slot-name');
        const metaEl = slotEl.querySelector('.slot-meta');
        const delBtn = slotEl.querySelector('.slot-delete');
        
        if (data) {
            slotEl.classList.add('filled');
            nameEl.textContent = `Level ${data.state.level} Adventurer`;
            const date = new Date(data.timestamp);
            metaEl.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
            delBtn.classList.remove('hidden');
        } else {
            slotEl.classList.remove('filled');
            nameEl.textContent = 'Empty';
            metaEl.textContent = '';
            delBtn.classList.add('hidden');
        }
    }
}

function startNewGame() {
    state.pos.set(0, 20, 0);
    state.health = 100;
    state.hunger = 100;
    state.xp = 0;
    state.level = 1;
    dayTime = 0.25;
    yaw = 0;
    pitch = 0;
}

function saveGame() {
    const data = {
        timestamp: Date.now(),
        state: {
            pos: { x: state.pos.x, y: state.pos.y, z: state.pos.z },
            health: state.health,
            hunger: state.hunger,
            xp: state.xp,
            level: state.level
        },
        dayTime: dayTime,
        yaw: yaw,
        pitch: pitch,
        appearance: {
            skin: document.getElementById('color-skin').value,
            eyes: document.getElementById('color-eyes').value,
            hairColor: document.getElementById('color-hair').value,
            beardColor: document.getElementById('color-beard').value,
            shirt: document.getElementById('color-shirt').value,
            pants: document.getElementById('color-pants').value,
            hairStyle: document.getElementById('select-hair').value,
            beardStyle: document.getElementById('select-beard').value
        }
    };
    setSaveData(currentSaveSlot, data);
}

function loadGame(data) {
    state.pos.set(data.state.pos.x, data.state.pos.y, data.state.pos.z);
    state.health = data.state.health;
    state.hunger = data.state.hunger;
    state.xp = data.state.xp;
    state.level = data.state.level;
    dayTime = data.dayTime;
    yaw = data.yaw;
    pitch = data.pitch;
    
    document.getElementById('color-skin').value = data.appearance.skin;
    skinMat.color.set(data.appearance.skin);
    document.getElementById('color-eyes').value = data.appearance.eyes;
    eyeMat.color.set(data.appearance.eyes);
    document.getElementById('color-hair').value = data.appearance.hairColor;
    hairMat.color.set(data.appearance.hairColor);
    document.getElementById('color-beard').value = data.appearance.beardColor;
    beardMat.color.set(data.appearance.beardColor);
    document.getElementById('color-shirt').value = data.appearance.shirt;
    shirtMat.color.set(data.appearance.shirt);
    document.getElementById('color-pants').value = data.appearance.pants;
    pantsMat.color.set(data.appearance.pants);
    
    document.getElementById('select-hair').value = data.appearance.hairStyle;
    updateHair(data.appearance.hairStyle);
    document.getElementById('select-beard').value = data.appearance.beardStyle;
    updateBeard(data.appearance.beardStyle);
}

if (playBtn) {
    playBtn.addEventListener('click', () => {
        updateSaveSlotsUI();
        mainMenu.classList.add('hidden');
        saveSlotsModal.classList.remove('hidden');
    });
}

document.querySelectorAll('.save-slot').forEach(slot => {
    slot.addEventListener('click', (e) => {
        if (e.target.classList.contains('slot-delete')) return;
        
        currentSaveSlot = parseInt(slot.dataset.slot);
        const data = getSaveData(currentSaveSlot);
        const isNewGame = !data;
        
        // Hide save slot modal immediately
        saveSlotsModal.classList.add('hidden');

        const showCinematic = isNewGame;

        runLoadingScreen(showCinematic, () => {
            // This fires after loading screen AND cutscene (if any) have completed.
            // Each path (cutscene / slideshow) handles its own fade-to-black before calling here.
            if (data) {
                loadGame(data);
            } else {
                startNewGame();
            }
            scene.background = new THREE.Color(0x87ceeb);
            hud.classList.remove('hidden');
            gameStarted = true;
            isPaused = false;
            setTimeout(() => renderer.domElement.requestPointerLock(), 200);
        });
    });
});

document.querySelectorAll('.slot-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Stop the click from bubbling up to the save slot
        if (confirm("Are you sure you want to delete this save? This cannot be undone.")) {
            const slot = e.target.dataset.slot || e.target.closest('.slot-delete').dataset.slot;
            deleteSaveData(slot);
            updateSaveSlotsUI();
        }
    });
});

document.getElementById('save-slots-back')?.addEventListener('click', () => {
    saveSlotsModal.classList.add('hidden');
    mainMenu.classList.remove('hidden');
});

// Pause Menu Logic
document.getElementById('resume-button')?.addEventListener('click', () => {
    isPaused = false;
    ingamePauseModal.classList.add('hidden');
    renderer.domElement.requestPointerLock();
});

document.getElementById('save-game-button')?.addEventListener('click', (e) => {
    saveGame();
    e.target.textContent = '✓ SAVED';
    setTimeout(() => { e.target.textContent = '💾 SAVE GAME'; }, 2000);
});

document.getElementById('return-menu-button')?.addEventListener('click', () => {
    isPaused = false;
    gameStarted = false;
    ingamePauseModal.classList.add('hidden');
    mainMenu.classList.remove('hidden');
    hud.classList.add('hidden');
});

// Auto-Save System
setInterval(() => {
    if (gameStarted && !isPaused) {
        saveGame();
        console.log(`Auto-saved to slot ${currentSaveSlot}`);
    }
}, 120000); // 120,000 ms = 2 minutes
if (customizeBtn) {
    customizeBtn.addEventListener('click', () => {
        mainMenu.classList.add('hidden'); // Hide main menu so only customizer is visible
        customizerModal.classList.remove('hidden');
        isCustomizing = true;
    });
}
// ===== LORE BOOK SYSTEM =====
const BOOK_SPREADS = [
    {
        left: `<h2>The Shattered Sky</h2>
            <p>Long ago, Eldoria was a single, unbroken continent. But the Great Cataclysm tore the earth asunder, sending massive chunks of land into the sky. Now, these floating islands hover silently above the clouds, holding ancient secrets and untold power.</p>
            <p>The largest of these islands — the Aether Isle — is said to hold the <em>Crown of the First King</em>, whose power could restore the world, or shatter it entirely.</p>
            <span class='page-num'>— I —</span>`,
        right: `<h2>The Crystal Peaks</h2>
            <p>To the north lie the Crystal Mountains. The glowing blue spires are not ice, but pure Aether-stone — solidified magic from before the Cataclysm. Those who harvest these crystals can harness the raw energy of the world.</p>
            <div class='hint-box'><strong>⚠ Adventurer's Note</strong>Few return from the freezing heights. The Crystal Golems that dwell there are ancient guardians — they will not attack unless provoked.</div>
            <span class='page-num'>— II —</span>`,
    },
    {
        left: `<h2>The Magic Forest</h2>
            <p>The Whispering Wood is no ordinary forest. Its trees pulse with violet light at night, and Shadow Wolves — creatures born from pure darkness — prowl its depths. Travellers report hearing whispers in languages long forgotten.</p>
            <p>The Ancient Pillars found within the forest are remnants of a civilization that mastered magic before humans discovered fire.</p>
            <span class='page-num'>— III —</span>`,
        right: `<h2>The Golden Plains</h2>
            <p>The vast Golden Plains shimmer in perpetual amber light. The golden trees that grow here produce sap that glows like the sun. Merchants prize it greatly — if only they could survive the journey to harvest it.</p>
            <div class='hint-box'><strong>🐉 Rumour</strong>Villagers speak of dragons spotted soaring above the Golden Plains. They say the creatures nest somewhere in the clouds above, and their scales are worth a king's ransom.</div>
            <span class='page-num'>— IV —</span>`,
    },
    {
        left: `<h2>The Castles of Eldoria</h2>
            <p>Six great fortresses were built by the Old Kings to guard the four corners of the realm. Each castle is a marvel of dark stone engineering — massive corner towers, thick walls, and a towering central Keep that can be seen for miles.</p>
            <p>No king has sat upon those thrones for centuries. What — or who — has taken their place, none dare to guess.</p>
            <span class='page-num'>— V —</span>`,
        right: `<h2>Castle Dungeons</h2>
            <p>Every castle holds a secret beneath its courtyard: a dungeon carved deep into the earth by the Old Kings to imprison those who defied them. The locks have long since rusted.</p>
            <div class='hint-box'><strong>🔮 Coming Soon</strong>Brave adventurers who venture into castle dungeons may find powerful relics, forgotten weapons, and terrible creatures that have claimed the darkness as their own.</div>
            <span class='page-num'>— VI —</span>`,
    },
    {
        left: `<h2>Treasure & Loot</h2>
            <p>The world of Eldoria is littered with the remnants of a fallen civilization. Chests left behind by long-dead merchants, soldiers, and explorers can be found in the most unlikely of places — beneath ancient trees, inside ruins, deep in caves.</p>
            <p>Do not dismiss a chest that looks ordinary. Appearances in Eldoria are always deceiving.</p>
            <span class='page-num'>— VII —</span>`,
        right: `<h2>What Chests May Hold</h2>
            <p>Those who seek treasure in Eldoria learn quickly: the harder the chest is to reach, the greater its reward.</p>
            <div class='hint-box'><strong>💎 Coming Soon</strong>Common chests may hold food, wood, or basic tools. But rare chests — found deep in dungeons or atop the floating islands — can contain enchanted weapons, ancient armour, and ingredients for powerful potions.</div>
            <span class='page-num'>— VIII —</span>`,
    },
    {
        left: `<h2>Creatures of the Realm</h2>
            <p>Eldoria teems with life. Noble <strong>Stags</strong> roam the lush forests, their antlers catching the morning light. In the deep woods, <strong>Grizzly Bears</strong> defend their territory with savage ferocity. Give them a wide berth.</p>
            <p>And in the Magic Forest, the <strong>Shadow Wolf</strong> — a creature of pure darkness with glowing red eyes — hunts anything that dares enter its domain.</p>
            <span class='page-num'>— IX —</span>`,
        right: `<h2>Bees & the Balance</h2>
            <p>Not all creatures in Eldoria seek to harm you. The golden <strong>Bees</strong> that drift through the lush forests are a sign that the land is healthy. Where bees fly, flowers bloom and food grows.</p>
            <div class='hint-box'><strong>🐝 Coming Soon</strong>Skilled apiarists can harvest bee hives to collect honey — a powerful healing ingredient and a valuable trade good in any village market.</div>
            <span class='page-num'>— X —</span>`,
    },
    {
        left: `<h2>The Villages</h2>
            <p>Scattered across the plains are small human settlements — villages of brave souls who refused to flee when the world broke. They build their homes of wood and thatch around a central plaza, where life continues despite the dangers that surround them.</p>
            <p>The people of these villages know things. Speak to them.</p>
            <span class='page-num'>— XI —</span>`,
        right: `<h2>Speaking with Villagers</h2>
            <p>Every villager in Eldoria has lived through hardship. They carry stories, warnings, and sometimes, the seeds of great quests. Approach them and press <strong>[E]</strong> to hear what they have to say.</p>
            <div class='hint-box'><strong>📜 Coming Soon</strong>In a future update, villagers will offer formal quests — from hunting dangerous creatures, to recovering stolen goods, to uncovering the truth behind the Cataclysm itself.</div>
            <span class='page-num'>— XII —</span>`,
    },
];

let currentSpread = 0;
let isFlipping = false;

function renderSpread(spread, leftEl, rightEl) {
    leftEl.innerHTML = spread.left;
    rightEl.innerHTML = spread.right;
}

function updateBookNav() {
    document.getElementById('book-prev').disabled = (currentSpread === 0);
    document.getElementById('book-next').disabled = (currentSpread === BOOK_SPREADS.length - 1);
    document.getElementById('book-page-num').textContent =
        `${currentSpread * 2 + 1}–${currentSpread * 2 + 2}  /  ${BOOK_SPREADS.length * 2}`;
}

function flipPage(direction) {
    if (isFlipping) return;
    const next = direction === 'next' ? currentSpread + 1 : currentSpread - 1;
    if (next < 0 || next >= BOOK_SPREADS.length) return;

    isFlipping = true;
    const flip = document.getElementById('page-flip');
    const flipFront = document.getElementById('page-flip-front');
    const flipBack = document.getElementById('page-flip-back');
    const leftContent = document.getElementById('book-left-content');
    const rightContent = document.getElementById('book-right-content');

    if (direction === 'next') {
        // Front shows current right page, Back shows next left page
        flipFront.innerHTML = BOOK_SPREADS[currentSpread].right;
        flipBack.innerHTML = BOOK_SPREADS[next].left;
        flip.style.display = 'block';
        flip.style.transition = 'none';
        flip.style.transform = 'rotateY(0deg)';
        void flip.offsetHeight; // force reflow
        flip.style.transition = 'transform 0.6s cubic-bezier(0.645, 0.045, 0.355, 1.000)';
        flip.style.transform = 'rotateY(-180deg)';
        // Mid-flip: update left static page
        setTimeout(() => {
            renderSpread(BOOK_SPREADS[next], leftContent, rightContent);
            currentSpread = next;
            updateBookNav();
        }, 300);
    } else {
        // Front shows next right page (hidden initially), Back shows current left
        flipFront.innerHTML = BOOK_SPREADS[next].right;
        flipBack.innerHTML = BOOK_SPREADS[currentSpread].left;
        flip.style.display = 'block';
        flip.style.transition = 'none';
        flip.style.transform = 'rotateY(-180deg)';
        void flip.offsetHeight;
        flip.style.transition = 'transform 0.6s cubic-bezier(0.645, 0.045, 0.355, 1.000)';
        flip.style.transform = 'rotateY(0deg)';
        setTimeout(() => {
            renderSpread(BOOK_SPREADS[next], leftContent, rightContent);
            currentSpread = next;
            updateBookNav();
        }, 300);
    }

    setTimeout(() => {
        flip.style.display = 'none'; // hide
        isFlipping = false;
    }, 650);
}

if (loreBtn) {
    loreBtn.addEventListener('click', () => {
        currentSpread = 0;
        isFlipping = false;
        loreModal.classList.remove('hidden');
        renderSpread(BOOK_SPREADS[0],
            document.getElementById('book-left-content'),
            document.getElementById('book-right-content'));
        // Hide flip overlay
        const flip = document.getElementById('page-flip');
        if (flip) flip.style.display = 'none';
        updateBookNav();
    });
}

document.getElementById('book-prev')?.addEventListener('click', () => flipPage('prev'));
document.getElementById('book-next')?.addEventListener('click', () => flipPage('next'));
document.getElementById('lore-close-btn')?.addEventListener('click', () => {
    loreModal.classList.add('hidden');
});

if (controlsBtn) {
    controlsBtn.addEventListener('click', () => {
        controlsModal.classList.remove('hidden');
    });
}

// Customizer Logic
document.getElementById('color-skin')?.addEventListener('input', (e) => skinMat.color.set(e.target.value));
document.getElementById('color-eyes')?.addEventListener('input', (e) => eyeMat.color.set(e.target.value));
document.getElementById('color-hair')?.addEventListener('input', (e) => hairMat.color.set(e.target.value));
document.getElementById('color-beard')?.addEventListener('input', (e) => beardMat.color.set(e.target.value));
document.getElementById('color-shirt')?.addEventListener('input', (e) => shirtMat.color.set(e.target.value));
document.getElementById('color-pants')?.addEventListener('input', (e) => pantsMat.color.set(e.target.value));
document.getElementById('select-hair')?.addEventListener('change', (e) => updateHair(e.target.value));
document.getElementById('select-beard')?.addEventListener('change', (e) => updateBeard(e.target.value));

// --- CONTROLS ---
const keys = {};
window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

let yaw = 0;
let pitch = 0;
document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === renderer.domElement) {
        yaw -= e.movementX * 0.003;
        pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.003, -1.5, 1.5);
    }
});

// Click canvas to re-acquire pointer lock while in game
document.addEventListener('click', (e) => {
    // Only lock if we aren't clicking an inventory UI element
    if (gameStarted && !isPaused && !isInventoryOpen && document.pointerLockElement !== renderer.domElement && !e.target.closest('.equip-slot') && !e.target.closest('#crafting') && !e.target.closest('#items-grid')) {
        renderer.domElement.requestPointerLock();
    }
});

// ESC and B keys
window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyB' && gameStarted && !isPaused) {
        isInventoryOpen = !isInventoryOpen;
        const inventoryEl = document.getElementById('inventory');
        if (isInventoryOpen) {
            inventoryEl.classList.remove('hidden');
            document.exitPointerLock();
            
            // Initialize empty grid if not already done
            const itemsGrid = document.getElementById('items-grid');
            if (itemsGrid && itemsGrid.children.length === 0) {
                for (let i = 0; i < 24; i++) {
                    const slot = document.createElement('div');
                    slot.className = 'inv-slot';
                    itemsGrid.appendChild(slot);
                }
            }
            
            // Clone the player for the UI scene
            if (uiPlayer) uiScene.remove(uiPlayer);
            uiPlayer = player.clone();
            // Remove the camera pivot from the clone so we don't have duplicate cameras
            const clonedPivot = uiPlayer.children.find(c => c === cameraPivot || c.children.includes(camera));
            if (clonedPivot) uiPlayer.remove(clonedPivot);
            
            uiPlayer.position.set(0, 0, 0); 
            uiPlayer.rotation.set(0, 0, 0);
            uiScene.add(uiPlayer);
            
        } else {
            inventoryEl.classList.add('hidden');
            if (uiPlayer) {
                uiScene.remove(uiPlayer);
                uiPlayer = null;
            }
            renderer.domElement.requestPointerLock();
        }
    }

    // E key — interact with NPC
    if (e.code === 'KeyE' && gameStarted && !isPaused && !isInventoryOpen) {
        if (dialogOpen) {
            // Close dialog
            dialogOpen = false;
            dialogBox.classList.add('hidden');
            renderer.domElement.requestPointerLock();
        } else if (nearVillager) {
            // Open dialog
            dialogOpen = true;
            const line = VILLAGER_LINES[Math.floor(Math.random() * VILLAGER_LINES.length)];
            dialogText.textContent = line;
            dialogBox.classList.remove('hidden');
            document.exitPointerLock();
        }
    }

    if (e.code === 'Escape' && gameStarted && !isPaused && !isCustomizing) {
        if (dialogOpen) {
            dialogOpen = false;
            dialogBox.classList.add('hidden');
            renderer.domElement.requestPointerLock();
            return;
        }
        if (isInventoryOpen) {
            isInventoryOpen = false;
            document.getElementById('inventory').classList.add('hidden');
            renderer.domElement.requestPointerLock();
        } else {
            isPaused = true;
            document.exitPointerLock();
            ingamePauseModal.classList.remove('hidden');
        }
    }
});

// --- DECORATORS & RESOURCES ---
const resources = [];

function createGrass(biomeType) {
    const g = new THREE.Group();
    let col = 0x4caf50;
    if (biomeType === BIOMES.MAGIC) col = 0x2a004f;
    if (biomeType === BIOMES.GOLDEN) col = 0xd4af37;
    
    const mat = new THREE.MeshStandardMaterial({ color: col, flatShading: true, side: THREE.DoubleSide });
    
    if (Math.random() > 0.5) {
        // Triangle blades
        for(let i=0; i<3; i++) {
            const blade = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.6 + Math.random()*0.4, 3), mat);
            blade.position.set((Math.random()-0.5)*0.5, 0.3, (Math.random()-0.5)*0.5);
            blade.rotation.set((Math.random()-0.5)*0.5, Math.random()*Math.PI, (Math.random()-0.5)*0.5);
            g.add(blade);
        }
    } else {
        // Flat cross planes
        const planeGeo = new THREE.PlaneGeometry(0.8, 0.8);
        const plane1 = new THREE.Mesh(planeGeo, mat);
        plane1.position.y = 0.4;
        const plane2 = plane1.clone();
        plane2.rotation.y = Math.PI / 2;
        g.add(plane1, plane2);
    }
    return g;
}

function createPineTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.4, 3, 5), new THREE.MeshStandardMaterial({ color: 0x3e2723 }));
    trunk.position.y = 1.5;
    trunk.castShadow = true;
    const mat = new THREE.MeshStandardMaterial({ color: 0x1b5e20, flatShading: true });
    for (let i=0; i<3; i++) {
        const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.5 - i*0.3, 2.5, 5), mat);
        leaves.position.y = 2.5 + i * 1.5;
        leaves.castShadow = true;
        g.add(leaves);
    }
    g.add(trunk);
    g.scale.set(3, 3, 3);
    return g;
}

function createFantasyTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 4, 5), new THREE.MeshStandardMaterial({ color: 0x1a237e }));
    trunk.position.y = 2;
    trunk.rotation.z = Math.random() * 0.4 - 0.2;
    trunk.castShadow = true;
    
    const isPink = Math.random() > 0.5;
    const color = isPink ? 0xff4081 : 0x18ffff;
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, flatShading: true });
    
    const leaves1 = new THREE.Mesh(new THREE.SphereGeometry(1.8, 6, 6), mat);
    leaves1.position.set(0, 4, 0);
    const leaves2 = new THREE.Mesh(new THREE.SphereGeometry(1.2, 6, 6), mat);
    leaves2.position.set(1.5, 3.5, 0);
    const leaves3 = new THREE.Mesh(new THREE.SphereGeometry(1.2, 6, 6), mat);
    leaves3.position.set(-1.5, 3.5, 0);
    g.add(trunk, leaves1, leaves2, leaves3);
    g.scale.set(4, 4, 4);
    return g;
}

function createGoldenTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.4, 2.5, 5), new THREE.MeshStandardMaterial({ color: 0x4e342e }));
    trunk.position.y = 1.25;
    trunk.castShadow = true;
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.6, 7, 7), new THREE.MeshStandardMaterial({ color: 0xffa000, flatShading: true }));
    leaves.position.y = 3;
    leaves.castShadow = true;
    g.add(trunk, leaves);
    g.scale.set(3.5, 3.5, 3.5);
    return g;
}

function createBush(biomeType) {
    let col = 0x2e7d32;
    if (biomeType === BIOMES.MAGIC) col = 0x6a1b9a;
    if (biomeType === BIOMES.GOLDEN) col = 0xf57f17;
    const size = 0.5 + Math.random() * 0.5;
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), new THREE.MeshStandardMaterial({ color: col, flatShading: true }));
    bush.position.y = size * 0.6;
    bush.castShadow = true;
    return bush;
}

function createRock() {
    const size = 0.3 + Math.random() * 1.5;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), new THREE.MeshStandardMaterial({ color: 0x757575, flatShading: true }));
    rock.position.y = size * 0.5;
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.scale.set(1, 0.6 + Math.random()*0.4, 1);
    rock.castShadow = true;
    return rock;
}

function createCrystal() {
    const h = 2 + Math.random() * 4;
    const crystal = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.8, h, 6), new THREE.MeshStandardMaterial({ 
        color: 0x80d8ff, emissive: 0x00b0ff, emissiveIntensity: 0.5, transparent: true, opacity: 0.8, flatShading: true
    }));
    crystal.position.y = h / 2;
    crystal.rotation.set((Math.random()-0.5)*0.2, Math.random(), (Math.random()-0.5)*0.2);
    return crystal;
}

function createAncientPillar() {
    const g = new THREE.Group();
    const h = 4 + Math.random() * 6;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, h, 6), new THREE.MeshStandardMaterial({ color: 0x424242, flatShading: true }));
    col.position.y = h / 2;
    col.castShadow = true;
    if (Math.random() > 0.5) {
        const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 2), new THREE.MeshStandardMaterial({ color: 0x424242 }));
        top.position.y = h;
        top.rotation.set((Math.random()-0.5)*0.3, Math.random(), (Math.random()-0.5)*0.3);
        top.castShadow = true;
        g.add(top);
    }
    g.add(col);
    return g;
}

// --- SETTLEMENTS & ARCHITECTURE ---
const houseMats = {
    plaster: new THREE.MeshStandardMaterial({ color: 0xd2ccbc, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.8 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x2c1f18, flatShading: true }),
    stone: new THREE.MeshStandardMaterial({ color: 0x455a64 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 }),
    door: new THREE.MeshStandardMaterial({ color: 0x24150d })
};

function createMedievalHouse() {
    const g = new THREE.Group();
    
    // Proper scaling to fit a 2-unit tall player
    const isLarge = Math.random() > 0.5;
    const w = (isLarge ? 6 : 4) + Math.random() * 3;
    const d = (isLarge ? 6 : 4) + Math.random() * 3;
    const h = 3.5 + Math.random() * 1.5;
    
    // Plaster/stone body
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), houseMats.plaster);
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    
    // Wood Beams (Trim)
    const beamThickness = 0.3;
    const bottomTrim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, beamThickness, d + 0.1), houseMats.wood);
    bottomTrim.position.y = beamThickness / 2;
    g.add(bottomTrim);
    
    const topTrim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, beamThickness, d + 0.2), houseMats.wood);
    topTrim.position.y = h;
    g.add(topTrim);
    
    // Vertical corner beams
    const offsets = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    offsets.forEach(([ox, oz]) => {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(beamThickness, h, beamThickness), houseMats.wood);
        pillar.position.set(ox * (w/2 + 0.05), h/2, oz * (d/2 + 0.05));
        g.add(pillar);
    });
    
    // Dark wood roof
    const roofH = 2.5 + Math.random() * 1.5;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, roofH, 4), houseMats.roof);
    roof.scale.set(w * 0.85, 1, d * 0.85); // Stretches pyramid to match rectangular base
    roof.rotation.y = Math.PI / 4;
    roof.position.y = h + roofH / 2;
    roof.castShadow = true;
    g.add(roof);
    
    // Door (Always on the front Z face)
    const doorW = 1.4;
    const doorH = 2.4;
    const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.2), houseMats.door);
    door.position.set((Math.random()-0.5)*w*0.4, doorH/2, d/2 + 0.05);
    g.add(door);
    
    // Windows
    const windowGeo = new THREE.BoxGeometry(1.2, 1.2, 0.2);
    // Add to -Z face (back)
    if (Math.random() > 0.2) {
        const winBack = new THREE.Mesh(windowGeo, houseMats.glass);
        winBack.position.set(0, h/2, -d/2 - 0.05);
        g.add(winBack);
    }
    // Add to +X face (right)
    if (Math.random() > 0.2) {
        const winRight = new THREE.Mesh(windowGeo, houseMats.glass);
        winRight.rotation.y = Math.PI / 2;
        winRight.position.set(w/2 + 0.05, h/2, 0);
        g.add(winRight);
    }
    // Add to -X face (left)
    if (Math.random() > 0.2) {
        const winLeft = new THREE.Mesh(windowGeo, houseMats.glass);
        winLeft.rotation.y = Math.PI / 2;
        winLeft.position.set(-w/2 - 0.05, h/2, 0);
        g.add(winLeft);
    }
    
    // Chimney
    if (Math.random() > 0.3) {
        const chim = new THREE.Mesh(new THREE.BoxGeometry(0.8, roofH + 1.5, 0.8), houseMats.stone);
        chim.position.set(w/4, h + roofH/2, -d/4);
        chim.castShadow = true;
        g.add(chim);
    }
    
    return g;
}

function createCastleTower() {
    const g = new THREE.Group();
    const r = 3.5;
    const h = 20 + Math.random() * 10;
    
    // Dark stone tower
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r*0.8, r+1, h, 8), houseMats.stone);
    body.position.y = h / 2;
    body.castShadow = true;
    g.add(body);
    
    // Wider battlement base
    const topR = r * 1.2;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(topR, topR, 3, 8), new THREE.MeshStandardMaterial({ color: 0x22262b, flatShading: true }));
    top.position.y = h + 1.5;
    top.castShadow = true;
    g.add(top);
    
    // Battlement teeth
    const teethMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, flatShading: true });
    for (let i = 0; i < 8; i++) {
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2, 1.5), teethMat);
        const angle = (i / 8) * Math.PI * 2;
        tooth.position.set(Math.cos(angle) * (topR - 0.5), h + 4, Math.sin(angle) * (topR - 0.5));
        tooth.rotation.y = -angle;
        tooth.castShadow = true;
        g.add(tooth);
    }
    
    // Flag pole
    if (Math.random() > 0.5) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 8, 4), new THREE.MeshStandardMaterial({ color: 0x3d2817 }));
        pole.position.y = h + 6;
        g.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), new THREE.MeshStandardMaterial({ color: 0x8b0000, side: THREE.DoubleSide }));
        flag.position.set(1.5, h + 8, 0);
        g.add(flag);
    }
    
    return g;
}

function createCastleWall(length, hasGate = false) {
    const g = new THREE.Group();
    const h = 14;
    const w = 3.5;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(length, h, w), houseMats.stone);
    wall.position.y = h / 2;
    wall.castShadow = true;
    g.add(wall);
    
    // Walkway battlements
    const teethMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, flatShading: true });
    const numTeeth = Math.floor(length / 3);
    for (let i = 0; i < numTeeth; i++) {
        const tx = -length/2 + 1.5 + (i * 3);
        const toothOuter = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2, 1), teethMat);
        toothOuter.position.set(tx, h + 1, w/2 - 0.5);
        g.add(toothOuter);
    }
    
    if (hasGate) {
        const gate = new THREE.Mesh(new THREE.BoxGeometry(8, 10, w + 0.5), new THREE.MeshStandardMaterial({ color: 0x1e1511 }));
        gate.position.y = 5;
        g.add(gate);
    }
    
    return g;
}

// --- ENTITY AI SYSTEM ---
const activeEntities = [];
const activeDamageNumbers = [];

function spawnDamageNumber(x, y, z, damage, isPlayerDamage) {
    const el = document.createElement('div');
    el.className = 'dmg-number ' + (isPlayerDamage ? 'player' : 'enemy');
    el.innerText = damage;
    document.getElementById('game-overlays').appendChild(el);
    
    activeDamageNumbers.push({
        el: el,
        pos: new THREE.Vector3(x + (Math.random() - 0.5), y + Math.random(), z + (Math.random() - 0.5)),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2),
        life: 1.0,
        maxLife: 1.0
    });
}

class Entity {
    constructor(mesh, x, z, type) {
        this.mesh = mesh;
        this.type = type;
        this.pos = new THREE.Vector3(x, 0, z);
        this.target = new THREE.Vector3(x, 0, z);
        this.state = 'idle';
        this.timer = Math.random() * 5;
        this.walkCycle = 0;
        this.speed = type === 'villager' ? 4 : type === 'bear' ? 5 : type === 'golem' ? 3 : 8;
        this.aggroRange = type === 'bear' ? 20 : type === 'wolf' ? 60 : 0; // 0 = passive
        this.isAggro = false;
        this.showHealthTimer = 0;
        this.hpBarEl = null;
        
        this.pos.y = getTerrainHeight(this.pos.x, this.pos.z);
        this.mesh.position.copy(this.pos);
        worldGroup.add(this.mesh);
    }
    
    update(dt, playerPos) {
        // Distance check for performance - only update AI if within 300 units
        if (this.pos.distanceTo(playerPos) > 300) return;
        
        this.timer -= dt;
        
        // --- WOLF AGGRESSIVE AI ---
        if (this.type === 'wolf' && this.mesh.userData.hp > 0) {
            const distToPlayer = this.pos.distanceTo(playerPos);
            if (distToPlayer < 60) {
                this.target.copy(playerPos);
                this.state = 'walking';
                this.speed = 10;
                if (distToPlayer < 4) {
                    if (this.timer <= 0) {
                        state.health = Math.max(0, state.health - 8);
                        spawnDamageNumber(playerPos.x, playerPos.y + 1.5, playerPos.z, 8, false);
                        this.timer = 2;
                    }
                }
                this.animateLimbs();
                this._moveToTarget(dt);
                return;
            } else {
                this.speed = 8;
            }
        }
        
        // --- BEAR TERRITORIAL AI ---
        if (this.type === 'bear' && this.mesh.userData.hp > 0) {
            const distToPlayer = this.pos.distanceTo(playerPos);
            if (distToPlayer < 20) {
                this.isAggro = true;
            }
            if (this.isAggro) {
                this.target.copy(playerPos);
                this.state = 'walking';
                this.speed = 7;
                if (distToPlayer < 5) {
                    if (this.timer <= 0) {
                        state.health = Math.max(0, state.health - 15);
                        spawnDamageNumber(playerPos.x, playerPos.y + 1.5, playerPos.z, 15, false);
                        this.timer = 2.5;
                    }
                }
                if (distToPlayer > 50) this.isAggro = false; // give up chase
                this.animateLimbs();
                this._moveToTarget(dt);
                return;
            }
        }
        
        // --- GOLEM RETALIATION AI (only attacks if attacked) ---
        if (this.type === 'golem' && this.mesh.userData.hp > 0) {
            if (this.isAggro) {
                const distToPlayer = this.pos.distanceTo(playerPos);
                this.target.copy(playerPos);
                this.state = 'walking';
                this.speed = 3;
                if (distToPlayer < 6) {
                    if (this.timer <= 0) {
                        state.health = Math.max(0, state.health - 25);
                        spawnDamageNumber(playerPos.x, playerPos.y + 2, playerPos.z, 25, false);
                        this.timer = 3;
                    }
                }
                this.animateLimbs();
                this._moveToTarget(dt);
                return;
            }
        }
        
        // --- BEE HOVERING AI ---
        if (this.type === 'bee') {
            this.walkCycle += dt * 8;
            this.pos.x += Math.sin(this.walkCycle * 0.5 + this.timer) * 0.03;
            this.pos.z += Math.cos(this.walkCycle * 0.3 + this.timer) * 0.03;
            this.pos.y += Math.sin(this.walkCycle * 2) * 0.02;
            // Flap wings
            if (this.mesh.userData.wings) {
                const { wingL, wingR } = this.mesh.userData.wings;
                wingL.rotation.y = Math.sin(this.walkCycle * 4) * 0.6;
                wingR.rotation.y = -Math.sin(this.walkCycle * 4) * 0.6;
            }
            this.mesh.position.copy(this.pos);
            return;
        }
        
        // --- DRAGON FLYING AI ---
        if (this.type === 'dragon') {
            this.walkCycle += dt * 0.5;
            const angle = this.walkCycle * 0.4;
            const orbitRadius = 80;
            this.pos.x += Math.cos(angle) * 0.6;
            this.pos.z += Math.sin(angle) * 0.6;
            this.pos.y = 90 + Math.sin(this.walkCycle) * 15;
            // Flap wings
            if (this.mesh.userData.wings) {
                const { wingL, wingR } = this.mesh.userData.wings;
                wingL.rotation.z = -Math.sin(this.walkCycle * 2) * 0.3 - 0.2;
                wingR.rotation.z = Math.sin(this.walkCycle * 2) * 0.3 + 0.2;
            }
            this.mesh.position.copy(this.pos);
            this.mesh.rotation.y = Math.atan2(Math.cos(angle), Math.sin(angle));
            return;
        }
        
        if (this.state === 'idle') {
            if (this.timer <= 0) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 10 + Math.random() * 20;
                this.target.set(this.pos.x + Math.cos(angle) * dist, 0, this.pos.z + Math.sin(angle) * dist);
                this.target.y = getTerrainHeight(this.target.x, this.target.z);
                
                // Only move if target isn't a steep cliff or water
                if (this.target.y > 0 && Math.abs(this.target.y - this.pos.y) < 5) {
                    this.state = 'walking';
                    this.timer = 5 + Math.random() * 5; // Walk for max 10 seconds
                } else {
                    this.timer = 2 + Math.random() * 3; // Try again soon
                }
            }
            this.walkCycle = 0;
        } else if (this.state === 'walking') {
            const dir = new THREE.Vector3().subVectors(this.target, this.pos);
            dir.y = 0; // Flat movement
            const dist = dir.length();
            
            if (dist < 1 || this.timer <= 0) {
                this.state = 'idle';
                this.timer = 2 + Math.random() * 5;
            } else {
                dir.normalize();
                
                // Rotate smoothly towards target
                const targetYaw = Math.atan2(dir.x, dir.z);
                let angleDiff = targetYaw - this.mesh.rotation.y;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                this.mesh.rotation.y += angleDiff * dt * 3;
                
                // Move forward
                const moveVec = new THREE.Vector3(Math.sin(this.mesh.rotation.y), 0, Math.cos(this.mesh.rotation.y)).multiplyScalar(this.speed * dt);
                this.pos.add(moveVec);
                
                // Snap to terrain height
                this.pos.y = getTerrainHeight(this.pos.x, this.pos.z);
                this.mesh.position.copy(this.pos);
                
                this.walkCycle += dt * (this.speed / 1.5);
            }
        }
        
        this.animateLimbs();
    }
    
    _moveToTarget(dt) {
        const dir = new THREE.Vector3().subVectors(this.target, this.pos);
        dir.y = 0;
        if (dir.length() < 1) return;
        dir.normalize();
        const targetYaw = Math.atan2(dir.x, dir.z);
        let angleDiff = targetYaw - this.mesh.rotation.y;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        this.mesh.rotation.y += angleDiff * dt * 4;
        const moveVec = new THREE.Vector3(Math.sin(this.mesh.rotation.y), 0, Math.cos(this.mesh.rotation.y)).multiplyScalar(this.speed * dt);
        this.pos.add(moveVec);
        this.pos.y = getTerrainHeight(this.pos.x, this.pos.z);
        this.mesh.position.copy(this.pos);
        this.walkCycle += dt * (this.speed / 1.5);
    }
    
    animateLimbs() {
        if (!this.mesh.userData.limbs) return;
        const { fl, fr, bl, br, la, ra } = this.mesh.userData.limbs;
        
        if (this.state === 'walking' && this.walkCycle > 0) {
            const swing = Math.sin(this.walkCycle) * 0.8;
            if (fl && fr && bl && br) { // Quadruped
                fl.rotation.x = -swing;
                fr.rotation.x = swing;
                bl.rotation.x = swing;
                br.rotation.x = -swing;
            } else if (fl && fr) { // Biped
                fl.rotation.x = -swing;
                fr.rotation.x = swing;
                if (la && ra) { // Biped arms
                    la.rotation.x = swing;
                    ra.rotation.x = -swing;
                }
            }
        } else {
            // Idle
            if (fl) fl.rotation.x = 0;
            if (fr) fr.rotation.x = 0;
            if (bl) bl.rotation.x = 0;
            if (br) br.rotation.x = 0;
            if (la) la.rotation.x = 0;
            if (ra) ra.rotation.x = 0;
        }
    }
}

function createVillager() {
    const g = new THREE.Group();
    const skinColors = [0xffccaa, 0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d];
    const clothesColors = [0x795548, 0x5d4037, 0x4caf50, 0x388e3c, 0x5c6bc0, 0x8d6e63];
    
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColors[Math.floor(Math.random()*skinColors.length)] });
    const shirtMat = new THREE.MeshStandardMaterial({ color: clothesColors[Math.floor(Math.random()*clothesColors.length)] });
    const pantsMat = new THREE.MeshStandardMaterial({ color: clothesColors[Math.floor(Math.random()*clothesColors.length)] });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x212121 });
    
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.4), shirtMat);
    torso.position.y = 1.0;
    torso.castShadow = true;
    g.add(torso);
    
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skinMat);
    head.position.y = 1.75;
    head.castShadow = true;
    g.add(head);
    
    function createLimb(w, h, d, mat, yOffset) {
        const group = new THREE.Group();
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.y = -h / 2 + yOffset;
        mesh.castShadow = true;
        group.add(mesh);
        return group;
    }
    
    const la = createLimb(0.25, 0.9, 0.25, shirtMat, 0.1); // sleeve
    la.position.set(-0.5, 1.45, 0);
    g.add(la);
    
    const ra = createLimb(0.25, 0.9, 0.25, shirtMat, 0.1); // sleeve
    ra.position.set(0.5, 1.45, 0);
    g.add(ra);
    
    const fl = createLimb(0.3, 0.9, 0.3, pantsMat, 0);
    fl.position.set(-0.2, 0.9, 0);
    const ls = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.15, 0.4), shoeMat);
    ls.position.set(0, -0.825, 0.05);
    fl.add(ls);
    g.add(fl);
    
    const fr = createLimb(0.3, 0.9, 0.3, pantsMat, 0);
    fr.position.set(0.2, 0.9, 0);
    const rs = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.15, 0.4), shoeMat);
    rs.position.set(0, -0.825, 0.05);
    fr.add(rs);
    g.add(fr);
    
    g.userData.limbs = { la, ra, fl, fr };
    return g;
}

function createStag() {
    const g = new THREE.Group();
    const furMat = new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.9 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.9 });
    const antlerMat = new THREE.MeshStandardMaterial({ color: 0xd7ccc8, roughness: 1.0 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });

    // Sleeker chest and hindquarters instead of one box
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 1.2, 8), furMat);
    chest.rotation.z = Math.PI / 2;
    chest.position.set(0, 2.1, 0.6);
    chest.castShadow = true;
    g.add(chest);

    const hind = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.45, 1.1, 8), furMat);
    hind.rotation.z = Math.PI / 2;
    hind.position.set(0, 2.0, -0.4);
    hind.castShadow = true;
    g.add(hind);
    
    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 1.2), furMat);
    belly.position.set(0, 1.8, 0.1);
    g.add(belly);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.2, 8), furMat);
    neck.position.set(0, 2.7, 1.1); 
    neck.rotation.x = -0.5; 
    neck.castShadow = true; 
    g.add(neck);

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 3.2, 1.4);
    headGroup.rotation.x = 0.2;
    
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.6), furMat);
    head.castShadow = true;
    headGroup.add(head);

    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.5), darkMat);
    snout.position.set(0, -0.1, 0.5);
    headGroup.add(snout);
    
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.1), noseMat);
    nose.position.set(0, 0.05, 0.75);
    headGroup.add(nose);

    const earGeo = new THREE.ConeGeometry(0.08, 0.4, 4);
    const earL = new THREE.Mesh(earGeo, furMat);
    earL.position.set(-0.25, 0.2, -0.1); 
    earL.rotation.z = 0.6; 
    earL.rotation.x = -0.2;
    headGroup.add(earL);
    
    const earR = new THREE.Mesh(earGeo, furMat);
    earR.position.set(0.25, 0.2, -0.1); 
    earR.rotation.z = -0.6; 
    earR.rotation.x = -0.2;
    headGroup.add(earR);

    // Intricate antlers
    const antlerBaseGeo = new THREE.CylinderGeometry(0.03, 0.05, 0.8, 5);
    const antlerBranchGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.5, 4);
    
    const aL = new THREE.Mesh(antlerBaseGeo, antlerMat);
    aL.position.set(-0.15, 0.5, 0); 
    aL.rotation.z = 0.4; 
    aL.rotation.x = -0.2;
    
    const aL2 = new THREE.Mesh(antlerBranchGeo, antlerMat);
    aL2.position.set(-0.1, 0.3, 0.1);
    aL2.rotation.z = -0.4;
    aL2.rotation.x = 0.4;
    aL.add(aL2);
    
    const aL3 = new THREE.Mesh(antlerBranchGeo, antlerMat);
    aL3.position.set(-0.15, 0.5, -0.1);
    aL3.rotation.z = 0.5;
    aL.add(aL3);
    headGroup.add(aL);

    const aR = new THREE.Mesh(antlerBaseGeo, antlerMat);
    aR.position.set(0.15, 0.5, 0); 
    aR.rotation.z = -0.4; 
    aR.rotation.x = -0.2;
    
    const aR2 = new THREE.Mesh(antlerBranchGeo, antlerMat);
    aR2.position.set(0.1, 0.3, 0.1);
    aR2.rotation.z = 0.4;
    aR2.rotation.x = 0.4;
    aR.add(aR2);
    
    const aR3 = new THREE.Mesh(antlerBranchGeo, antlerMat);
    aR3.position.set(0.15, 0.5, -0.1);
    aR3.rotation.z = -0.5;
    aR.add(aR3);
    headGroup.add(aR);

    g.add(headGroup);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 4), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    tail.position.set(0, 2.2, -0.9);
    tail.rotation.x = -0.5;
    g.add(tail);

    function createLeg() {
        const grp = new THREE.Group();
        const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.1, 0.9, 6), furMat);
        upper.position.y = -0.45; 
        upper.castShadow = true; 
        grp.add(upper);
        
        const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.8, 6), darkMat);
        lower.position.y = -1.3; 
        lower.castShadow = true; 
        grp.add(lower);
        
        const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.15, 0.18), noseMat);
        hoof.position.y = -1.75; 
        hoof.position.z = 0.05;
        grp.add(hoof);
        
        return grp;
    }
    
    const fl = createLeg(); fl.position.set(-0.35, 1.7, 0.9); g.add(fl);
    const fr = createLeg(); fr.position.set(0.35, 1.7, 0.9); g.add(fr);
    const bl = createLeg(); bl.position.set(-0.35, 1.7, -0.7); g.add(bl);
    const br = createLeg(); br.position.set(0.35, 1.7, -0.7); g.add(br);

    g.userData.limbs = { fl, fr, bl, br };
    g.userData.hp = 60;
    g.userData.maxHp = 60;
    g.scale.set(1.4, 1.4, 1.4);
    return g;
}

function createShadowWolf() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.9 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0f, roughness: 1.0 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xff1744, emissive: 0xff1744, emissiveIntensity: 2.5 });
    const teethMat = new THREE.MeshStandardMaterial({ color: 0xdddddd });

    // Thick chest
    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 1.1), bodyMat);
    chest.position.set(0, 1.4, 0.5); 
    chest.castShadow = true; 
    g.add(chest);

    // Tapered abdomen
    const abdomen = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 1.2), accentMat);
    abdomen.position.set(0, 1.2, -0.6); 
    abdomen.castShadow = true; 
    g.add(abdomen);
    
    // Glowing ribs
    for(let i=0; i<3; i++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.4, 0.1), glowMat);
        rib.position.set(0, 1.2, -0.3 - (i*0.3));
        g.add(rib);
    }

    // Scruff/Mane
    const mane = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 1.0), bodyMat);
    mane.position.set(0, 2.1, 0.5); 
    mane.rotation.x = 0.2;
    g.add(mane);

    // Neck
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.7), bodyMat);
    neck.position.set(0, 1.8, 1.2); 
    neck.rotation.x = -0.5; 
    g.add(neck);

    // Head
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 2.2, 1.6);
    headGroup.rotation.x = 0.2;
    
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.7, 0.8), bodyMat);
    head.castShadow = true; 
    headGroup.add(head);
    
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 0.8), accentMat);
    snout.position.set(0, -0.15, 0.7); 
    headGroup.add(snout);

    // Eyes
    const eyeGeo = new THREE.BoxGeometry(0.15, 0.08, 0.05);
    const eyeL = new THREE.Mesh(eyeGeo, glowMat); 
    eyeL.position.set(-0.25, 0.1, 0.41); 
    eyeL.rotation.z = 0.2;
    headGroup.add(eyeL);
    
    const eyeR = new THREE.Mesh(eyeGeo, glowMat); 
    eyeR.position.set(0.25, 0.1, 0.41); 
    eyeR.rotation.z = -0.2;
    headGroup.add(eyeR);

    // Ears
    const earGeo = new THREE.ConeGeometry(0.15, 0.5, 4);
    const earL = new THREE.Mesh(earGeo, accentMat); 
    earL.position.set(-0.3, 0.5, -0.1); 
    earL.rotation.z = -0.3; 
    headGroup.add(earL);
    
    const earR = new THREE.Mesh(earGeo, accentMat); 
    earR.position.set(0.3, 0.5, -0.1); 
    earR.rotation.z = 0.3; 
    headGroup.add(earR);

    // Fangs
    const fangGeo = new THREE.ConeGeometry(0.06, 0.25, 4);
    const fangL = new THREE.Mesh(fangGeo, teethMat); 
    fangL.position.set(-0.15, -0.4, 0.9); 
    fangL.rotation.x = Math.PI;
    headGroup.add(fangL);
    
    const fangR = new THREE.Mesh(fangGeo, teethMat); 
    fangR.position.set(0.15, -0.4, 0.9); 
    fangR.rotation.x = Math.PI;
    headGroup.add(fangR);

    g.add(headGroup);

    // Thick Tail
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 1.2), bodyMat);
    tail.position.set(0, 1.4, -1.6); 
    tail.rotation.x = -0.8; 
    g.add(tail);

    function createLeg(isFront) {
        const grp = new THREE.Group();
        const upper = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.3), bodyMat);
        upper.position.y = -0.45; 
        upper.castShadow = true; 
        grp.add(upper);
        
        const lower = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.8, 0.2), accentMat);
        lower.position.y = -1.2; 
        lower.castShadow = true; 
        grp.add(lower);
        
        const paw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.4), bodyMat);
        paw.position.set(0, -1.7, 0.1); 
        grp.add(paw);
        
        return grp;
    }
    
    // Front legs slightly longer to match thick chest
    const fl = createLeg(true); fl.position.set(-0.4, 1.1, 0.8); g.add(fl);
    const fr = createLeg(true); fr.position.set(0.4, 1.1, 0.8); g.add(fr);
    const bl = createLeg(false); bl.position.set(-0.35, 0.9, -1.0); g.add(bl);
    const br = createLeg(false); br.position.set(0.35, 0.9, -1.0); g.add(br);

    g.userData.limbs = { fl, fr, bl, br };
    g.userData.hp = 80;
    g.userData.maxHp = 80;
    g.userData.isWolf = true;
    g.scale.set(1.4, 1.4, 1.4);
    return g;
}

function createBear() {
    const g = new THREE.Group();
    const furMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 1.0 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x111111 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 2.6), furMat);
    body.position.y = 1.5; body.castShadow = true; g.add(body);

    const hump = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 1.0), furMat);
    hump.position.set(0, 2.3, 0.6); hump.castShadow = true; g.add(hump);

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.8, 1.6);
    
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 1.1), furMat);
    head.castShadow = true; headGroup.add(head);

    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.8), furMat);
    snout.position.set(0, -0.1, 0.8); headGroup.add(snout);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.2), noseMat);
    nose.position.set(0, 0.1, 1.25); headGroup.add(nose);

    const earGeo = new THREE.BoxGeometry(0.3, 0.3, 0.2);
    const earL = new THREE.Mesh(earGeo, furMat); earL.position.set(-0.4, 0.5, -0.2); headGroup.add(earL);
    const earR = new THREE.Mesh(earGeo, furMat); earR.position.set(0.4, 0.5, -0.2); headGroup.add(earR);

    g.add(headGroup);

    function createLeg() {
        const grp = new THREE.Group();
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), furMat);
        leg.position.y = -0.6; leg.castShadow = true; grp.add(leg);
        const paw = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.7), furMat);
        paw.position.set(0, -1.05, 0.1); paw.castShadow = true; grp.add(paw);
        return grp;
    }

    const fl = createLeg(); fl.position.set(-0.55, 1.2, 0.9); g.add(fl);
    const fr = createLeg(); fr.position.set(0.55, 1.2, 0.9); g.add(fr);
    const bl = createLeg(); bl.position.set(-0.55, 1.2, -0.9); g.add(bl);
    const br = createLeg(); br.position.set(0.55, 1.2, -0.9); g.add(br);

    g.userData.limbs = { fl, fr, bl, br };
    g.userData.hp = 150;
    g.userData.maxHp = 150;
    g.userData.isBear = true;
    g.scale.set(1.5, 1.5, 1.5);
    return g;
}

function createCrystalGolem() {
    const g = new THREE.Group();
    const crystalMat = new THREE.MeshStandardMaterial({ 
        color: 0x00ffff, 
        emissive: 0x0088ff, 
        emissiveIntensity: 0.8,
        roughness: 0.2,
        transparent: true,
        opacity: 0.9
    });
    const darkRockMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.5, 1.5), darkRockMat);
    torso.position.y = 3.5; torso.castShadow = true; g.add(torso);

    const chestCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), crystalMat);
    chestCrystal.position.set(0, 3.8, 0.6); 
    chestCrystal.scale.set(1, 1.5, 0.5);
    g.add(chestCrystal);

    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8), crystalMat);
    head.position.set(0, 5.5, 0.2); head.castShadow = true; g.add(head);

    function createArm(isLeft) {
        const grp = new THREE.Group();
        const shoulder = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), crystalMat);
        shoulder.position.set(0, 0, 0); shoulder.castShadow = true; grp.add(shoulder);
        
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.0, 0.8), darkRockMat);
        arm.position.set(0, -1.5, 0); arm.castShadow = true; grp.add(arm);
        
        const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7), crystalMat);
        fist.position.set(0, -3.0, 0); fist.castShadow = true; grp.add(fist);
        return grp;
    }
    const la = createArm(true); la.position.set(-1.8, 4.0, 0); g.add(la);
    const ra = createArm(false); ra.position.set(1.8, 4.0, 0); g.add(ra);

    function createLeg(isLeft) {
        const grp = new THREE.Group();
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.0, 0.9), darkRockMat);
        leg.position.y = -1.0; leg.castShadow = true; grp.add(leg);
        
        const foot = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.2), crystalMat);
        foot.position.set(0, -2.25, 0.1); foot.castShadow = true; grp.add(foot);
        return grp;
    }
    const fl = createLeg(true); fl.position.set(-0.6, 2.5, 0); g.add(fl);
    const fr = createLeg(false); fr.position.set(0.6, 2.5, 0); g.add(fr);

    g.userData.limbs = { la, ra, fl, fr };
    g.userData.hp = 300;
    g.userData.maxHp = 300;
    g.userData.isGolem = true;
    g.scale.set(1.5, 1.5, 1.5);
    return g;
}

function createBee() {
    const g = new THREE.Group();
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0xffd700 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide });

    const bodyGeo = new THREE.BoxGeometry(0.4, 0.4, 0.6);
    const body = new THREE.Mesh(bodyGeo, yellowMat);
    g.add(body);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.2), blackMat);
    stripe.position.z = 0; g.add(stripe);
    const stripe2 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.1), blackMat);
    stripe2.position.z = -0.2; g.add(stripe2);

    const wingL = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), wingMat);
    wingL.position.set(-0.3, 0.25, 0); wingL.rotation.x = Math.PI / 2; g.add(wingL);
    
    const wingR = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), wingMat);
    wingR.position.set(0.3, 0.25, 0); wingR.rotation.x = Math.PI / 2; g.add(wingR);

    g.userData.wings = { wingL, wingR };
    g.userData.hp = 1;
    g.userData.maxHp = 1;
    g.userData.isBee = true;
    return g;
}

function createDragon() {
    const g = new THREE.Group();
    // Darker, more intense red for scales, emissive orange for belly/spikes
    const scaleMat = new THREE.MeshStandardMaterial({ color: 0x4a0000, roughness: 0.8 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0xff2200, emissiveIntensity: 0.5 });
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 0.8 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x1a0000, side: THREE.DoubleSide, roughness: 0.9 });
    const boneMat = new THREE.MeshStandardMaterial({ color: 0x2a0000, roughness: 0.8 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0xffff00, emissiveIntensity: 2.0 });

    // --- BODY ---
    const bodyGroup = new THREE.Group();
    const chest = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.8, 3.5), scaleMat);
    chest.position.set(0, 0, 1.0);
    const abdomen = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.2, 4.0), scaleMat);
    abdomen.position.set(0, -0.2, -2.5);
    bodyGroup.add(chest, abdomen);

    const chestBelly = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 3.3), bellyMat);
    chestBelly.position.set(0, -1.4, 1.0);
    const abBelly = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 3.8), bellyMat);
    abBelly.position.set(0, -1.2, -2.5);
    bodyGroup.add(chestBelly, abBelly);
    
    // Back Spikes
    for (let i = -4; i <= 2; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.5, 4), spikeMat);
        spike.position.set(0, 1.5, i);
        bodyGroup.add(spike);
    }
    g.add(bodyGroup);

    // --- NECK & HEAD ---
    const neckGroup = new THREE.Group();
    neckGroup.position.set(0, 1.0, 2.5);
    
    // Curved neck using segments
    const neckPoints = [
        {y: 0.8, z: 1.0, rotX: 0.2, s: 1.0},
        {y: 1.8, z: 1.8, rotX: 0.4, s: 0.9},
        {y: 2.8, z: 2.3, rotX: 0.5, s: 0.8},
        {y: 3.8, z: 2.6, rotX: 0.6, s: 0.7}
    ];

    neckPoints.forEach(p => {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(1.5 * p.s, 1.5 * p.s, 1.8 * p.s), scaleMat);
        seg.position.set(0, p.y, p.z);
        seg.rotation.x = -p.rotX;
        
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.0, 4), spikeMat);
        spike.position.set(0, 0.8 * p.s, 0);
        seg.add(spike);
        
        neckGroup.add(seg);
    });

    // Head
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 4.5, 3.2);
    headGroup.rotation.x = 0.3; // Look down slightly

    const skull = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 2.2), scaleMat);
    headGroup.add(skull);

    // Jaw / Snout
    const upperJaw = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 2.0), scaleMat);
    upperJaw.position.set(0, -0.1, 1.8);
    headGroup.add(upperJaw);
    
    const lowerJaw = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 1.8), bellyMat);
    lowerJaw.position.set(0, -0.7, 1.7);
    lowerJaw.rotation.x = 0.2; // Open mouth
    headGroup.add(lowerJaw);

    // Eyes
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), eyeMat);
    eyeL.position.set(-0.85, 0.2, 0.5);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), eyeMat);
    eyeR.position.set(0.85, 0.2, 0.5);
    headGroup.add(eyeL, eyeR);

    // Majestic Horns
    const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.5, 5), boneMat);
    hornL.position.set(-0.7, 0.8, -1.0);
    hornL.rotation.set(-0.8, -0.2, -0.3);
    const hornR = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.5, 5), boneMat);
    hornR.position.set(0.7, 0.8, -1.0);
    hornR.rotation.set(-0.8, 0.2, 0.3);
    headGroup.add(hornL, hornR);

    neckGroup.add(headGroup);
    g.add(neckGroup);

    // --- TAIL ---
    const tailGroup = new THREE.Group();
    tailGroup.position.set(0, 0.5, -4.5);
    
    for(let i=0; i<8; i++) {
        const s = 1.0 - (i * 0.1);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(1.8 * s, 1.8 * s, 2.0), scaleMat);
        seg.position.set(0, -i*0.2, -i*1.8);
        
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.2 * s, 1.2 * s, 4), spikeMat);
        spike.position.set(0, 1.0 * s, 0);
        seg.add(spike);
        
        // Fin/Club at end
        if (i === 7) {
            const club = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.5, 2.5), spikeMat);
            club.rotation.y = Math.PI / 4;
            seg.add(club);
        }
        tailGroup.add(seg);
    }
    g.add(tailGroup);

    // --- LEGS & CLAWS ---
    function createLeg(isFront, isLeft) {
        const legGrp = new THREE.Group();
        const s = isFront ? 1.0 : 1.4; // Hind legs are bigger
        const dirX = isLeft ? -1 : 1;
        
        const thigh = new THREE.Mesh(new THREE.BoxGeometry(1.0*s, 2.5*s, 1.2*s), scaleMat);
        thigh.position.set(dirX * 1.5*s, -1.0*s, 0);
        thigh.rotation.z = dirX * 0.3;
        
        const calf = new THREE.Mesh(new THREE.BoxGeometry(0.8*s, 2.0*s, 0.8*s), scaleMat);
        calf.position.set(dirX * 1.8*s, -3.0*s, -0.5*s);
        calf.rotation.x = -0.4;
        
        const foot = new THREE.Mesh(new THREE.BoxGeometry(1.2*s, 0.6*s, 1.8*s), scaleMat);
        foot.position.set(dirX * 1.8*s, -4.0*s, 0.2*s);
        
        // Claws
        for (let i=-1; i<=1; i++) {
            const claw = new THREE.Mesh(new THREE.ConeGeometry(0.1*s, 0.8*s, 4), boneMat);
            claw.position.set(dirX * 1.8*s + (i*0.4*s), -4.0*s, 1.2*s); 
            claw.rotation.x = Math.PI/2;
            legGrp.add(claw);
        }

        legGrp.add(thigh, calf, foot);
        return legGrp;
    }
    
    const fl = createLeg(true, true); fl.position.set(0, 0, 2.0); g.add(fl);
    const fr = createLeg(true, false); fr.position.set(0, 0, 2.0); g.add(fr);
    const bl = createLeg(false, true); bl.position.set(0, 0, -2.0); g.add(bl);
    const br = createLeg(false, false); br.position.set(0, 0, -2.0); g.add(br);

    // --- SEGMENTED WINGS ---
    function createWing(isLeft) {
        const wingGrp = new THREE.Group();
        const dir = isLeft ? -1 : 1;
        
        // Wing bones
        const arm = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.4, 0.4), scaleMat);
        arm.position.set(dir * 2.5, 0, 0);
        wingGrp.add(arm);
        
        const forearm = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.3, 0.3), scaleMat);
        forearm.position.set(dir * 7.5, 0, -2.0);
        forearm.rotation.y = dir * 0.6;
        wingGrp.add(forearm);
        
        const finger1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 8.0), boneMat);
        finger1.position.set(dir * 5.0, 0, -4.0);
        wingGrp.add(finger1);
        
        const finger2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 9.0), boneMat);
        finger2.position.set(dir * 8.0, 0, -5.5);
        finger2.rotation.y = dir * -0.3;
        wingGrp.add(finger2);
        
        const finger3 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 7.0), boneMat);
        finger3.position.set(dir * 10.0, 0, -4.5);
        finger3.rotation.y = dir * -0.8;
        wingGrp.add(finger3);
        
        // Leathery Wing Membranes (using overlapping planes)
        const mem1 = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 8.0), wingMat);
        mem1.rotation.x = -Math.PI / 2;
        mem1.position.set(dir * 2.5, 0, -4.0);
        wingGrp.add(mem1);
        
        const mem2 = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 9.0), wingMat);
        mem2.rotation.x = -Math.PI / 2;
        mem2.rotation.z = dir * -0.15;
        mem2.position.set(dir * 6.5, 0, -5.0);
        wingGrp.add(mem2);

        const mem3 = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 7.0), wingMat);
        mem3.rotation.x = -Math.PI / 2;
        mem3.rotation.z = dir * -0.55;
        mem3.position.set(dir * 9.5, 0, -4.0);
        wingGrp.add(mem3);

        return wingGrp;
    }

    const wingL = createWing(true);
    wingL.position.set(-1.0, 2.0, 1.0);
    g.add(wingL);
    
    const wingR = createWing(false);
    wingR.position.set(1.0, 2.0, 1.0);
    g.add(wingR);

    // Save references for animation logic in Entity.update()
    g.userData.wings = { wingL, wingR };
    g.userData.limbs = { fl, fr, bl, br }; // Add limbs so they animate!
    g.userData.hp = 3000; // Epic boss HP
    g.userData.maxHp = 3000;
    g.userData.isDragon = true;
    
    // Scale up the dragon!
    g.scale.set(3, 3, 3);
    return g;
}

function spawnSettlements() {
    // Spawn 25 structured Villages
    for (let i = 0; i < 25; i++) {
        const x = (Math.random() - 0.5) * WORLD_SIZE * 0.85;
        const z = (Math.random() - 0.5) * WORLD_SIZE * 0.85;
        const h = getTerrainHeight(x, z);
        
        // Villages prefer flat plains
        if (h > 1 && h < 12) {
            // Slope check for village center
            const hOffset1 = getTerrainHeight(x + 20, z);
            const hOffset2 = getTerrainHeight(x, z + 20);
            if (Math.abs(h - hOffset1) > 4 || Math.abs(h - hOffset2) > 4) continue;
            
            const numHouses = 5 + Math.floor(Math.random() * 8); // 5 to 12 houses
            const housePositions = [];
            
            // Central plaza
            const plazaSize = 15 + Math.random() * 10;
            const plazaSegments = Math.ceil(plazaSize / 2);
            const plazaGeo = new THREE.PlaneGeometry(plazaSize, plazaSize, plazaSegments, plazaSegments);
            plazaGeo.rotateX(-Math.PI / 2);
            
            const pAttr = plazaGeo.getAttribute('position');
            for(let k = 0; k < pAttr.count; k++) {
                const wx = x + pAttr.getX(k);
                const wz = z + pAttr.getZ(k);
                pAttr.setY(k, getTerrainHeight(wx, wz) + 0.15);
            }
            plazaGeo.computeVertexNormals();
            
            const pathMat = new THREE.MeshStandardMaterial({ 
                color: 0x3d2817, 
                roughness: 1.0, 
                polygonOffset: true, 
                polygonOffsetFactor: -2, 
                polygonOffsetUnits: -2 
            });
            
            const plaza = new THREE.Mesh(plazaGeo, pathMat);
            plaza.position.set(x, 0, z);
            worldGroup.add(plaza);
            
            // Scatter houses around plaza
            let attempts = 0;
            while(housePositions.length < numHouses && attempts < 50) {
                attempts++;
                const angle = Math.random() * Math.PI * 2;
                const dist = plazaSize/2 + 10 + Math.random() * 20;
                
                const hx = x + Math.cos(angle) * dist;
                const hz = z + Math.sin(angle) * dist;
                const hh = getTerrainHeight(hx, hz);
                
                if (hh > 0 && Math.abs(hh - h) < 5) {
                    // Check collision
                    let collision = false;
                    for (const pos of housePositions) {
                        const dx = pos.x - hx;
                        const dz = pos.z - hz;
                        if (Math.sqrt(dx*dx + dz*dz) < 15) { // 15 units min distance between houses
                            collision = true;
                            break;
                        }
                    }
                    
                    if (!collision) {
                        const house = createMedievalHouse();
                        house.position.set(hx, hh, hz);
                        // Make house face the plaza
                        house.rotation.y = Math.atan2(x - hx, z - hz); 
                        worldGroup.add(house);
                        housePositions.push({x: hx, y: hh, z: hz});
                        // Register house as a solid collider for the player
                        registerCollider(hx, hz, 5.5);
                        
                        // Path from house to plaza
                        const pathDist = dist - plazaSize/2;
                        const pathSegments = Math.max(2, Math.ceil(pathDist / 2));
                        const pathGeo = new THREE.PlaneGeometry(6, pathDist, 2, pathSegments);
                        pathGeo.rotateX(-Math.PI / 2);
                        pathGeo.rotateY(-Math.atan2(hx - x, hz - z));
                        
                        const pxCenter = (hx + x) / 2;
                        const pzCenter = (hz + z) / 2;
                        
                        const pAttr2 = pathGeo.getAttribute('position');
                        for(let k = 0; k < pAttr2.count; k++) {
                            const wx = pxCenter + pAttr2.getX(k);
                            const wz = pzCenter + pAttr2.getZ(k);
                            pAttr2.setY(k, getTerrainHeight(wx, wz) + 0.15);
                        }
                        pathGeo.computeVertexNormals();
                        
                        const path = new THREE.Mesh(pathGeo, pathMat);
                        path.position.set(pxCenter, 0, pzCenter);
                        worldGroup.add(path);
                    }
                }
            }
            
            // Spawn Villagers in plaza
            const numVillagers = 2 + Math.floor(Math.random() * 4);
            for (let v = 0; v < numVillagers; v++) {
                const vx = x + (Math.random() - 0.5) * plazaSize/2;
                const vz = z + (Math.random() - 0.5) * plazaSize/2;
                const villagerMesh = createVillager();
                activeEntities.push(new Entity(villagerMesh, vx, vz, 'villager'));
            }
        }
    }

    // Spawn 6 Epic Castles
    for (let i = 0; i < 6; i++) {
        const x = (Math.random() - 0.5) * WORLD_SIZE * 0.8;
        const z = (Math.random() - 0.5) * WORLD_SIZE * 0.8;
        const h = getTerrainHeight(x, z);
        
        if (h > 8 && h < 30) {
            // Slope check for castle grounds
            const hOffset1 = getTerrainHeight(x + 30, z);
            const hOffset2 = getTerrainHeight(x, z + 30);
            if (Math.abs(h - hOffset1) > 6 || Math.abs(h - hOffset2) > 6) continue;
            
            const castleGroup = new THREE.Group();
            castleGroup.position.set(x, h - 2.5, z); // Sink it slightly
            
            // Central Courtyard Floor
            const courtyard = new THREE.Mesh(new THREE.PlaneGeometry(65, 65), houseMats.stone);
            courtyard.rotation.x = -Math.PI / 2;
            courtyard.position.y = 2.6; // Slightly above ground
            castleGroup.add(courtyard);
            
            // Massive Central Keep
            const keep = createCastleTower();
            keep.scale.set(4.0, 3.5, 4.0); // Scaled up massively
            castleGroup.add(keep);
            
            // 4 Corner Towers connected by walls
            const radius = 32; 
            const angles = [0, Math.PI/2, Math.PI, Math.PI*1.5];
            
            angles.forEach((angle, idx) => {
                const tower = createCastleTower();
                tower.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
                castleGroup.add(tower);
                
                const wallLen = radius * Math.sqrt(2);
                const hasGate = (idx === 0); // Front wall has gatehouse
                const wall = createCastleWall(wallLen, hasGate);
                
                const nextAngle = angle + Math.PI/2;
                const midX = (Math.cos(angle) + Math.cos(nextAngle)) * radius / 2;
                const midZ = (Math.sin(angle) + Math.sin(nextAngle)) * radius / 2;
                
                wall.position.set(midX, 0, midZ);
                wall.rotation.y = -angle - Math.PI/4;
                castleGroup.add(wall);
            });
            
            castleGroup.traverse(child => { child.matrixAutoUpdate = false; child.updateMatrix(); });
            castleGroup.matrixAutoUpdate = false;
            castleGroup.updateMatrix();
            worldGroup.add(castleGroup);
        }
    }
}

function createOakTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.6, 2.5, 6), new THREE.MeshStandardMaterial({ color: 0x3e2723 }));
    trunk.position.y = 1.25;
    trunk.castShadow = true;
    
    const mat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, flatShading: true });
    const leaves1 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.5, 0), mat);
    leaves1.position.set(0, 3, 0);
    leaves1.castShadow = true;
    
    const leaves2 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2, 0), mat);
    leaves2.position.set(1, 2.5, 1);
    leaves2.castShadow = true;
    
    const leaves3 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2, 0), mat);
    leaves3.position.set(-1, 2.5, -1);
    leaves3.castShadow = true;
    
    g.add(trunk, leaves1, leaves2, leaves3);
    g.scale.set(3.5, 3.5, 3.5);
    return g;
}

function createBirchTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 3.5, 5), new THREE.MeshStandardMaterial({ color: 0xe0e0e0 }));
    trunk.position.y = 1.75;
    trunk.castShadow = true;
    
    const mat = new THREE.MeshStandardMaterial({ color: 0x558b2f, flatShading: true });
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 0), mat);
    leaves.position.y = 4;
    leaves.castShadow = true;
    
    g.add(trunk, leaves);
    g.scale.set(3, 4, 3);
    return g;
}

function spawnDecor() {
    const gridCellSize = 10;
    const grid = new Map();
    
    function canPlace(x, z, radius) {
        if (radius === 0) return true; // grass can overlap
        const cx = Math.floor(x / gridCellSize);
        const cz = Math.floor(z / gridCellSize);
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                const key = `${cx + i},${cz + j}`;
                const cell = grid.get(key);
                if (cell) {
                    for (const item of cell) {
                        const dx = item.x - x;
                        const dz = item.z - z;
                        if (Math.sqrt(dx*dx + dz*dz) < (radius + item.r)) {
                            return false;
                        }
                    }
                }
            }
        }
        return true;
    }
    
    function register(x, z, radius) {
        if (radius === 0) return;
        const cx = Math.floor(x / gridCellSize);
        const cz = Math.floor(z / gridCellSize);
        const key = `${cx},${cz}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push({x, z, r: radius});
    }

    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x757575, flatShading: true });
    const rocksInstanced = new THREE.InstancedMesh(rockGeo, rockMat, 8000);
    rocksInstanced.castShadow = true;
    rocksInstanced.receiveShadow = true;
    let rockCount = 0;
    
    const bushGeo = new THREE.IcosahedronGeometry(1, 0);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
    const bushesInstanced = new THREE.InstancedMesh(bushGeo, bushMat, 8000);
    bushesInstanced.castShadow = false; // bushes don't need shadows
    bushesInstanced.receiveShadow = false;
    let bushCount = 0;

    const dummy = new THREE.Object3D();
    const instColor = new THREE.Color();

    for (let i = 0; i < 8000; i++) {
        const x = (Math.random() - 0.5) * WORLD_SIZE;
        const z = (Math.random() - 0.5) * WORLD_SIZE;
        const biome = getBiomeData(x, z);
        const h = biome.h;
        if (h < 0) continue;
        
        // Slope check to prevent floating on steep cliffs
        const hOffset1 = getTerrainHeight(x + 2, z);
        const hOffset2 = getTerrainHeight(x, z + 2);
        const maxSlope = Math.max(Math.abs(h - hOffset1), Math.abs(h - hOffset2));
        if (maxSlope > 2.5) continue; 
        
        let obj = null;
        let isInstancedRock = false;
        let isInstancedBush = false;
        let bushBiome = null;
        let radius = 2; // Default collision radius
        const r = Math.random();
        
        // Use noise to create clumps of trees (forests)
        const forestNoise = noise2D(x * 0.006, z * 0.006);
        const isForest = forestNoise > 0.3;
        
        if (biome.type === BIOMES.LUSH) {
            if (isForest) {
                if (r < 0.15) { obj = createOakTree(); radius = 3.5; }
                else if (r < 0.25) { obj = createBirchTree(); radius = 3; }
                else if (r < 0.35) { obj = createPineTree(); radius = 2.5; }
                else if (r < 0.36) {
                    if (canPlace(x, z, 2)) {
                        const stagMesh = createStag();
                        activeEntities.push(new Entity(stagMesh, x, z, 'stag'));
                        register(x, z, 2);
                    }
                    continue;
                }
                else if (r < 0.365) {
                    if (canPlace(x, z, 3)) {
                        const bearMesh = createBear();
                        activeEntities.push(new Entity(bearMesh, x, z, 'bear'));
                        register(x, z, 3);
                    }
                    continue;
                }
                else if (r < 0.38) {
                    if (canPlace(x, z, 1)) {
                        const beeMesh = createBee();
                        // Spawn bee slightly above ground
                        const beeEnt = new Entity(beeMesh, x, z, 'bee');
                        beeEnt.pos.y += 2 + Math.random() * 2;
                        beeMesh.position.y = beeEnt.pos.y;
                        activeEntities.push(beeEnt);
                        register(x, z, 1);
                    }
                    continue;
                }
                else if (r < 0.42) { isInstancedBush = true; bushBiome = BIOMES.LUSH; radius = 1.5; }
                else if (r < 0.9) { obj = createGrass(BIOMES.LUSH); radius = 0; } // Grass doesn't block
            } else {
                // Open Plains
                if (r < 0.01) { obj = createOakTree(); radius = 3.5; }
                else if (r < 0.02) { obj = createBirchTree(); radius = 3; }
                else if (r < 0.03) { obj = createPineTree(); radius = 2.5; }
                else if (r < 0.15) { isInstancedBush = true; bushBiome = BIOMES.LUSH; radius = 1.5; }
                else if (r < 0.2) { isInstancedRock = true; radius = 2; }
                else if (r < 0.8) { obj = createGrass(BIOMES.LUSH); radius = 0; }
            }
        } else if (biome.type === BIOMES.MAGIC) {
            if (isForest) {
                if (r < 0.08) { obj = createFantasyTree(); radius = 3.5; }
                else if (r < 0.085) {
                    if (canPlace(x, z, 2)) {
                        const wolfMesh = createShadowWolf();
                        activeEntities.push(new Entity(wolfMesh, x, z, 'wolf'));
                        register(x, z, 2);
                    }
                    continue;
                }
                else if (r < 0.15) { isInstancedBush = true; bushBiome = BIOMES.MAGIC; radius = 1.5; }
                else if (r < 0.8) { obj = createGrass(BIOMES.MAGIC); radius = 0; }
            } else {
                if (r < 0.01) { obj = createFantasyTree(); radius = 3.5; }
                else if (r < 0.015) {
                    if (canPlace(x, z, 2)) {
                        const wolfMesh = createShadowWolf();
                        activeEntities.push(new Entity(wolfMesh, x, z, 'wolf'));
                        register(x, z, 2);
                    }
                    continue;
                }
                else if (r < 0.05) { isInstancedBush = true; bushBiome = BIOMES.MAGIC; radius = 1.5; }
                else if (r < 0.1) { isInstancedRock = true; radius = 2; }
                else if (r < 0.12) { obj = createAncientPillar(); radius = 2.5; }
                else if (r < 0.8) { obj = createGrass(BIOMES.MAGIC); radius = 0; }
            }
        } else if (biome.type === BIOMES.GOLDEN) {
            if (r < 0.04) { obj = createGoldenTree(); radius = 3.5; }
            else if (r < 0.042) {
                // Sky dragons
                if (canPlace(x, z, 10)) {
                    const dragonMesh = createDragon();
                    const dragonEnt = new Entity(dragonMesh, x, z, 'dragon');
                    dragonEnt.pos.y = 80 + Math.random() * 40; // High in sky
                    dragonMesh.position.y = dragonEnt.pos.y;
                    activeEntities.push(dragonEnt);
                    register(x, z, 10);
                }
                continue;
            }
            else if (r < 0.15) { isInstancedBush = true; bushBiome = BIOMES.GOLDEN; radius = 1.5; }
            else if (r < 0.2) { isInstancedRock = true; radius = 2; }
            else if (r < 0.8) { obj = createGrass(BIOMES.GOLDEN); radius = 0; }
        } else if (biome.type === BIOMES.CRYSTAL) {
            if (h > 15) {
                if (r < 0.08) { obj = createCrystal(); radius = 1.5; }
                else if (r < 0.09) {
                    if (canPlace(x, z, 3)) {
                        const golemMesh = createCrystalGolem();
                        activeEntities.push(new Entity(golemMesh, x, z, 'golem'));
                        register(x, z, 3);
                    }
                    continue;
                }
                else if (r < 0.3) { isInstancedRock = true; radius = 2; }
            } else {
                if (r < 0.02) { obj = createPineTree(); radius = 2.5; }
                else if (r < 0.1) { isInstancedRock = true; radius = 2; }
                else if (r < 0.6) { obj = createGrass(BIOMES.LUSH); radius = 0; }
            }
        }
        
        if (isInstancedRock && rockCount < 8000) {
            if (canPlace(x, z, radius)) {
                const size = 0.3 + Math.random() * 1.5;
                dummy.position.set(x, h + size * 0.5, z);
                dummy.rotation.set(Math.random(), Math.random(), Math.random());
                dummy.scale.set(size, size * (0.6 + Math.random()*0.4), size);
                dummy.updateMatrix();
                rocksInstanced.setMatrixAt(rockCount, dummy.matrix);
                rockCount++;
                register(x, z, radius);
                if (radius >= 1.5) registerCollider(x, z, radius * 0.55);
            }
            continue;
        }

        if (isInstancedBush && bushCount < 8000) {
            if (canPlace(x, z, radius)) {
                let colHex = 0x2e7d32;
                if (bushBiome === BIOMES.MAGIC) colHex = 0x6a1b9a;
                if (bushBiome === BIOMES.GOLDEN) colHex = 0xf57f17;
                instColor.setHex(colHex);
                
                const size = 0.5 + Math.random() * 0.5;
                dummy.position.set(x, h + size * 0.6, z);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.set(size, size, size);
                dummy.updateMatrix();
                
                bushesInstanced.setMatrixAt(bushCount, dummy.matrix);
                bushesInstanced.setColorAt(bushCount, instColor);
                bushCount++;
                register(x, z, radius);
                if (radius >= 1.5) registerCollider(x, z, radius * 0.55);
            }
            continue;
        }

        if (obj && canPlace(x, z, radius)) {
            // Sink objects slightly into the ground to hide floating edges
            const sinkOffset = radius > 0 ? 0.4 : 0; 
            obj.position.set(x, h - sinkOffset, z);
            
            // Freeze matrix so the engine doesn't recalculate it every frame (big perf boost)
            obj.traverse(child => { child.matrixAutoUpdate = false; child.updateMatrix(); });
            obj.matrixAutoUpdate = false;
            obj.updateMatrix();
            worldGroup.add(obj);
            resources.push(obj);
            
            register(x, z, radius);
            // Also register for player collision (trees, rocks, pillars — not grass)
            if (radius >= 1.5) registerCollider(x, z, radius * 0.55);
        }
    }

    rocksInstanced.count = rockCount;
    worldGroup.add(rocksInstanced);
    bushesInstanced.count = bushCount;
    worldGroup.add(bushesInstanced);
}

function spawnEpicFloatingIsland() {
    const mainGroup = new THREE.Group();
    mainGroup.position.set(0, 150, 0);
    
    const mainRadius = 60;
    const mainDepth = 40;
    
    const base = new THREE.Mesh(
        new THREE.ConeGeometry(mainRadius, mainDepth, 9),
        new THREE.MeshStandardMaterial({ color: 0x5d4037, flatShading: true })
    );
    base.rotation.x = Math.PI;
    base.position.y = -mainDepth / 2;
    mainGroup.add(base);
    
    const top = new THREE.Mesh(
        new THREE.CylinderGeometry(mainRadius*0.9, mainRadius, 4, 9),
        new THREE.MeshStandardMaterial({ color: 0x2a004f, flatShading: true })
    );
    mainGroup.add(top);

    for(let i=0; i<10; i++) {
        const tree = createFantasyTree();
        tree.scale.set(3, 3, 3);
        tree.position.set((Math.random()-0.5)*mainRadius, 2, (Math.random()-0.5)*mainRadius);
        mainGroup.add(tree);
    }
    const ruin = createAncientPillar();
    ruin.scale.set(3,3,3);
    ruin.position.set(0, 2, 0);
    mainGroup.add(ruin);
    
    scene.add(mainGroup);
    worldGroup.add(mainGroup);

    for(let i=0; i<5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const dist = mainRadius + 30 + Math.random() * 20;
        const satGroup = new THREE.Group();
        satGroup.position.set(Math.cos(angle)*dist, 130 + Math.random()*40, Math.sin(angle)*dist);
        
        const satRad = 10 + Math.random() * 15;
        const satDepth = satRad * 0.8;
        
        const sBase = new THREE.Mesh(
            new THREE.ConeGeometry(satRad, satDepth, 7),
            new THREE.MeshStandardMaterial({ color: 0x5d4037, flatShading: true })
        );
        sBase.rotation.x = Math.PI;
        sBase.position.y = -satDepth / 2;
        satGroup.add(sBase);
        
        const sTop = new THREE.Mesh(
            new THREE.CylinderGeometry(satRad*0.9, satRad, 2, 7),
            new THREE.MeshStandardMaterial({ color: 0x2a004f, flatShading: true })
        );
        satGroup.add(sTop);
        
        if (Math.random() > 0.5) {
            const tree = createFantasyTree();
            tree.scale.set(1.5, 1.5, 1.5);
            tree.position.set(0, 1, 0);
            satGroup.add(tree);
        }
        scene.add(satGroup);
        worldGroup.add(satGroup);
    }
}

// ============================================================
// LOADING SCREEN ORCHESTRATOR
// ============================================================
const TIPS = [
    'Sprint with Shift to move faster across the world.',
    'Press E to talk to Villagers — they have useful hints.',
    'Crystal Golems only attack if you provoke them first.',
    'Wolves are far more aggressive at night. Stay near the villages.',
    'The Golden Plains biome is where Dragons roam the skies.',
    'Press B to open your inventory and inspect your character.',
    'Look out for glowing red walls — that\'s the edge of the world.',
    'Bears are territorial. Don\'t get too close to them.',
    'The higher you climb, the more Crystal resources you\'ll find.',
    'The floating island holds ancient ruins and powerful loot.',
];

const STORY_LINES = [
    'A world long forgotten stirs from its slumber...',
    'Ancient forces clash beneath the eternal sky...',
    'Your fate is written in the stars of Eldoria...',
    'The realm needs a hero. Are you brave enough?',
];

let worldGenerated = false; // Guard: world is spawned exactly once

function runLoadingScreen(isFirstTime, onComplete) {
    const cinematicEl = document.getElementById('loading-cinematic');
    const returningEl = document.getElementById('loading-returning');
    const lcBar       = document.getElementById('lc-bar');
    const lcPct       = document.getElementById('lc-progress-pct');
    const lcStory     = document.getElementById('lc-story-text');
    const lrBar       = document.getElementById('lr-bar');
    const lrPct       = document.getElementById('lr-pct');
    const lrTip       = document.getElementById('lr-tip');
    const slides      = document.querySelectorAll('.lr-slide');

    function hide(el) { if(el) { el.style.opacity = '0'; setTimeout(() => el.classList.add('hidden'), 1200); } }
    function show(el) { if(el) { el.classList.remove('hidden'); } }

    // Particles for cinematic
    function spawnParticles() {
        const container = document.getElementById('lc-particles');
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < 40; i++) {
            const p = document.createElement('div');
            p.className = 'lc-particle';
            p.style.left = Math.random() * 100 + '%';
            p.style.animationDuration = (4 + Math.random() * 8) + 's';
            p.style.animationDelay    = (Math.random() * 5) + 's';
            p.style.width = p.style.height = (1 + Math.random() * 3) + 'px';
            container.appendChild(p);
        }
    }

    // Slideshow for returning players
    let slideIndex = 0;
    function nextSlide() {
        slides[slideIndex].classList.remove('active');
        slideIndex = (slideIndex + 1) % slides.length;
        slides[slideIndex].classList.add('active');
    }

    function nextTip() {
        if (!lrTip) return;
        lrTip.style.opacity = '0';
        setTimeout(() => {
            lrTip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
            lrTip.style.opacity = '1';
        }, 500);
    }

    // Update both progress bars
    function setProgress(pct) {
        if (lcBar) lcBar.style.width = pct + '%';
        if (lcPct) lcPct.textContent = Math.round(pct) + '%';
        if (lrBar) lrBar.style.width = pct + '%';
        if (lrPct) lrPct.textContent = Math.round(pct) + '%';
    }

    // --- Yielding world generation ---
    // Break heavy work into chunks that yield to the browser between each chunk
    // so CSS animations stay smooth. Only runs if world hasn't been generated yet.
    function generateWorldAsync(onDone) {
        if (worldGenerated) { onDone(); return; }

        // Phase 1: spawnDecor (slow) broken into chunks of 200 iterations
        const CHUNK = 200;
        const TOTAL_ITERS = 8000;
        let iter = 0;

        // We need access to spawnDecor internals — so we refactor the progress
        // into a wrapper that calls spawnDecorChunked()
        const phase1Weight = 0.70; // 70% of bar
        const phase2Weight = 0.15;
        const phase3Weight = 0.15;

        function doPhase1() {
            // Run CHUNK iterations of the decor loop in each slice
            const end = Math.min(iter + CHUNK, TOTAL_ITERS);
            // We call the real spawnDecor once — it handles everything.
            // To show smooth progress we split it differently:
            // Just show smooth fake progress during the single heavy call.
            // We do it in a single rAF to let the browser paint first.
            requestAnimationFrame(() => {
                spawnDecor();
                setProgress(phase1Weight * 100);
                requestAnimationFrame(doPhase2);
            });
        }

        function doPhase2() {
            spawnEpicFloatingIsland();
            setProgress((phase1Weight + phase2Weight) * 100);
            requestAnimationFrame(doPhase3);
        }

        function doPhase3() {
            spawnSettlements();
            setProgress(100);
            worldGenerated = true;
            setTimeout(onDone, 300);
        }

        // Animate progress from 0 → 30% while world generation hasn't started
        // to give feedback immediately
        let fakeProgress = 0;
        const fakeTimer = setInterval(() => {
            fakeProgress += 3;
            if (fakeProgress >= 30) { clearInterval(fakeTimer); doPhase1(); return; }
            setProgress(fakeProgress);
        }, 60);
    }

    // ---- FIRST TIME (Cinematic loading) ----
    if (isFirstTime) {
        cinematicEl.style.opacity = '1';
        show(cinematicEl);
        spawnParticles();
        if (lcStory) lcStory.textContent = 'A world long forgotten stirs from its slumber...';

        let storyIdx = 0;
        const storyTimer = setInterval(() => {
            storyIdx = (storyIdx + 1) % STORY_LINES.length;
            if (lcStory) lcStory.textContent = STORY_LINES[storyIdx];
        }, 2800);

        const startTime = Date.now();
        generateWorldAsync(() => {
            const elapsed = Date.now() - startTime;
            const minTime = 4000; // Minimum 4 seconds to read intro text
            const remaining = Math.max(0, minTime - elapsed);

            setTimeout(() => {
                clearInterval(storyTimer);
                if (lcStory) lcStory.textContent = 'The world is ready. Your journey begins...';
                if (cinematicEl) {
                    // Flash black FIRST to hide the transition
                    flashBlack(600, () => {
                        cinematicEl.classList.add('hidden');
                        playCutscene(onComplete);
                    });
                }
            }, remaining);
        });

    // ---- RETURNING PLAYER (Slideshow loading) ----
    } else {
        returningEl.style.opacity = '1';
        show(returningEl);
        if (lrTip) lrTip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
        const si = setInterval(nextSlide, 5000);
        const ti = setInterval(nextTip, 4500);

        const startTime = Date.now();
        generateWorldAsync(() => {
            const elapsed = Date.now() - startTime;
            const minTime = 3500; // Minimum 3.5 seconds to see tips and slides
            const remaining = Math.max(0, minTime - elapsed);

            setTimeout(() => {
                // Flash black FIRST to hide the loading screen removal
                flashBlack(800, () => {
                    clearInterval(si);
                    clearInterval(ti);
                    if (returningEl) {
                        returningEl.classList.add('hidden');
                    }
                    onComplete();
                });
            }, remaining);
        });
    }
}

// ============================================================
// CINEMATIC CUTSCENE — Full movie-style intro (first time only)
// ============================================================
const CUTSCENE_SCENES = [
    {
        location: 'ELDORIA — THE LUSH FOREST',
        img: '/cutscene_forest.png',
        lines: [
            'A lone wanderer steps into the ancient forest of Eldoria...',
            'Trees older than memory tower overhead.',
            'Something stirs in the shadows between the roots.'
        ]
    },
    {
        location: 'THE MOUNTAIN PASS',
        img: '/cutscene_golem.png',
        lines: [
            'From the mountain passes, ancient guardians awaken.',
            'Crystal and stone, bound together by forgotten magic.',
            'They have waited centuries for an intruder to appear.'
        ]
    },
    {
        location: 'THE GOLDEN PLAINS — HIGH ABOVE',
        img: '/cutscene_dragon.png',
        lines: [
            'A shadow falls across the golden fields below.',
            'Wings wider than the oldest oak — a dragon circles.',
            'The skies of Eldoria belong to something ancient and terrible.'
        ]
    },
    {
        location: null, // Title card — pure black
        img: null,
        lines: []
    }
];

// Create a persistent black overlay element for fixing the flash
const _flashOverlay = document.createElement('div');
_flashOverlay.style.cssText = 'position:fixed;inset:0;z-index:9990;background:#000;opacity:0;pointer-events:none;transition:opacity 0.6s ease;';
document.body.appendChild(_flashOverlay);

function flashBlack(duration, cb) {
    _flashOverlay.style.pointerEvents = 'all';
    _flashOverlay.style.transition = 'none';
    _flashOverlay.style.opacity = '1';
    
    // Fire callback immediately while screen is black
    if (cb) cb();

    // Stay black for 'duration' then fade out slowly
    setTimeout(() => {
        _flashOverlay.style.transition = 'opacity 1.2s ease-out';
        _flashOverlay.style.opacity = '0';
        setTimeout(() => {
            _flashOverlay.style.pointerEvents = 'none';
        }, 1300);
    }, duration);
}

function playCutscene(onComplete) {
    // Build root element
    const cs = document.createElement('div');
    cs.id = 'cutscene';
    cs.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#000;overflow:hidden;opacity:1;transition:opacity 1s ease;';

    // Letterbox bars (cinematic feel)
    const barTop = document.createElement('div');
    barTop.style.cssText = 'position:absolute;top:0;left:0;right:0;height:12%;background:#000;z-index:5;transition:height 1.2s cubic-bezier(0.4, 0, 0.2, 1);';
    const barBot = document.createElement('div');
    barBot.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:12%;background:#000;z-index:5;transition:height 1.2s cubic-bezier(0.4, 0, 0.2, 1);';

    // Background image layer (Ken Burns container)
    const bg = document.createElement('div');
    bg.style.cssText = 'position:absolute;inset:0;background-size:cover;background-position:center;opacity:0;transition:opacity 1.4s ease, transform 12s ease-out;transform:scale(1.15);';

    // Cinematic vignette
    const vig = document.createElement('div');
    vig.style.cssText = 'position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 30%,rgba(0,0,0,0.7) 100%);z-index:2;pointer-events:none;';

    // Location caption (top-left, like a movie)
    const locationEl = document.createElement('div');
    locationEl.style.cssText = `
        position:absolute;top:15%;left:5%;z-index:6;
        font-family:'Cinzel',serif;font-size:0.75rem;letter-spacing:0.5em;
        color:rgba(255,220,100,0.9);text-transform:uppercase;
        opacity:0;transition:opacity 1.2s ease;
        text-shadow: 0 2px 10px rgba(0,0,0,0.8);
    `;

    // Subtitle bar at the bottom
    const subBar = document.createElement('div');
    subBar.style.cssText = `
        position:absolute;bottom:15%;left:0;right:0;z-index:6;
        text-align:center;padding:0.8rem 15%;
        font-family:'Outfit',sans-serif;font-size:1.2rem;font-style:italic;
        color:rgba(255,255,255,0.95);line-height:1.6;
        text-shadow:0 2px 10px rgba(0,0,0,1);
        min-height:4rem;
    `;

    // Title card elements
    const titleCard = document.createElement('div');
    titleCard.style.cssText = `
        position:absolute;inset:0;z-index:7;
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        opacity:0;transition:opacity 2s ease;background:#000;
    `;
    const titleMain = document.createElement('div');
    titleMain.style.cssText = 'font-family:"Cinzel",serif;font-size:clamp(4rem,10vw,8rem);font-weight:900;background:linear-gradient(135deg,#ffe066,#ffb347,#ff6600);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:0.15em;margin-bottom:0.5rem;filter:drop-shadow(0 0 30px rgba(255,100,0,0.4));';
    titleMain.textContent = 'Eldoria';
    const titleSub = document.createElement('div');
    titleSub.style.cssText = 'font-family:"Cinzel",serif;font-size:1.1rem;letter-spacing:0.8em;color:rgba(255,230,180,0.7);text-transform:uppercase;';
    titleSub.textContent = 'The Lost Realm';
    titleCard.append(titleMain, titleSub);

    // Skip button
    const skipBtn = document.createElement('button');
    skipBtn.textContent = 'SKIP CINEMATIC ›';
    skipBtn.style.cssText = `
        position:absolute;bottom:5%;right:5%;z-index:10;
        background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.2);
        color:rgba(255,255,255,0.5);padding:0.6rem 1.5rem;
        font-family:'Cinzel',serif;font-size:0.7rem;letter-spacing:0.3em;
        cursor:pointer;transition:all 0.4s;backdrop-filter:blur(5px);
        border-radius:4px;
    `;
    skipBtn.onmouseenter = () => { skipBtn.style.color='#fff'; skipBtn.style.background='rgba(255,255,255,0.15)'; skipBtn.style.borderColor='rgba(255,255,255,0.6)'; };
    skipBtn.onmouseleave = () => { skipBtn.style.color='rgba(255,255,255,0.5)'; skipBtn.style.background='rgba(255,255,255,0.05)'; skipBtn.style.borderColor='rgba(255,255,255,0.2)'; };

    cs.append(bg, vig, barTop, barBot, locationEl, subBar, titleCard, skipBtn);
    document.body.appendChild(cs);

    let sceneIdx = 0;
    let lineIdx = 0;
    let typeTimer = null;
    let sceneTimer = null;
    let exiting = false;

    function typeText(text, el, onDone) {
        clearInterval(typeTimer);
        el.textContent = '';
        let i = 0;
        typeTimer = setInterval(() => {
            el.textContent += text[i];
            i++;
            if (i >= text.length) {
                clearInterval(typeTimer);
                if (onDone) setTimeout(onDone, 2200);
            }
        }, 40);
    }

    function exitCutscene() {
        if (exiting) return;
        exiting = true;
        clearTimeout(sceneTimer);
        clearInterval(typeTimer);
        
        // Close letterbox bars for drama
        barTop.style.height = '50%';
        barBot.style.height = '50%';
        
        setTimeout(() => {
            // Flash black BEFORE removing the cutscene element
            flashBlack(500, () => {
                cs.remove();
                onComplete();
            });
        }, 1200);
    }

    function showScene(idx) {
        if (idx >= CUTSCENE_SCENES.length) { exitCutscene(); return; }
        const scene = CUTSCENE_SCENES[idx];
        clearTimeout(sceneTimer);
        clearInterval(typeTimer);
        lineIdx = 0;

        // Reset and fade out
        bg.style.opacity = '0';
        locationEl.style.opacity = '0';
        subBar.textContent = '';
        titleCard.style.opacity = '0';

        setTimeout(() => {
            if (scene.img) {
                bg.style.backgroundImage = `url('${scene.img}')`;
                bg.style.transition = 'none';
                bg.style.transform = 'scale(1.2) translateX(-2%)';
                
                // Force reflow
                bg.offsetHeight;
                
                bg.style.transition = 'opacity 1.6s ease, transform 12s ease-out';
                bg.style.opacity = '1';
                bg.style.transform = 'scale(1.0) translateX(2%)'; // Zoom out + Pan right

                if (scene.location) {
                    locationEl.textContent = scene.location;
                    locationEl.style.opacity = '1';
                }

                function nextLine() {
                    if (lineIdx >= scene.lines.length) {
                        sceneTimer = setTimeout(() => { sceneIdx++; showScene(sceneIdx); }, 3000);
                        return;
                    }
                    typeText(scene.lines[lineIdx], subBar, () => {
                        lineIdx++;
                        nextLine();
                    });
                }
                setTimeout(nextLine, 1200);

            } else {
                // Title card
                titleCard.style.opacity = '1';
                sceneTimer = setTimeout(exitCutscene, 5000);
            }
        }, 800);
    }

    skipBtn.onclick = exitCutscene;
    // Delay bars in
    setTimeout(() => {
        barTop.style.height = '12%';
        barBot.style.height = '12%';
        showScene(0);
    }, 200);
}

// --- WORLD BORDER WALLS ---
// 4 glowing walls at the edge of the playable area, initially invisible
const borderMat = new THREE.MeshStandardMaterial({
    color: 0xff2200,
    emissive: 0xff4400,
    emissiveIntensity: 1.5,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false
});
const borderWallH = 200;
const borderWalls = [];
const borderDefs = [
    { pos: [WORLD_BORDER, borderWallH / 2, 0], rot: [0, 0, 0], size: [4, borderWallH, WORLD_BORDER * 2] },
    { pos: [-WORLD_BORDER, borderWallH / 2, 0], rot: [0, 0, 0], size: [4, borderWallH, WORLD_BORDER * 2] },
    { pos: [0, borderWallH / 2, WORLD_BORDER], rot: [0, Math.PI / 2, 0], size: [4, borderWallH, WORLD_BORDER * 2] },
    { pos: [0, borderWallH / 2, -WORLD_BORDER], rot: [0, Math.PI / 2, 0], size: [4, borderWallH, WORLD_BORDER * 2] },
];
borderDefs.forEach(def => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(...def.size), borderMat.clone());
    wall.position.set(...def.pos);
    wall.rotation.set(...def.rot);
    wall.matrixAutoUpdate = false;
    wall.updateMatrix();
    scene.add(wall);
    borderWalls.push(wall);
});

// CSS warning overlay for near-border effect
const borderWarningEl = document.createElement('div');
borderWarningEl.id = 'border-warning';
borderWarningEl.style.cssText = `
    position: fixed; inset: 0; pointer-events: none; z-index: 999;
    background: radial-gradient(ellipse at center, transparent 60%, rgba(255,40,0,0) 100%);
    opacity: 0; transition: opacity 0.3s;
    box-shadow: inset 0 0 120px rgba(255, 40, 0, 0);
`;
document.body.appendChild(borderWarningEl);

const borderWarningText = document.createElement('div');
borderWarningText.style.cssText = `
    position: fixed; bottom: 30%; left: 50%; transform: translateX(-50%);
    color: #ff4400; font-family: 'Cinzel', serif; font-size: 1.4rem; font-weight: bold;
    text-shadow: 0 0 10px #ff0000, 0 0 20px #ff4400;
    pointer-events: none; z-index: 1000; opacity: 0; transition: opacity 0.3s;
    letter-spacing: 0.15em;
`;
borderWarningText.textContent = '⚠ WORLD BOUNDARY — TURN BACK';
document.body.appendChild(borderWarningText);

// --- LOOP ---
let walkCycle = 0;
let menuCameraYaw = 0;
let attackCooldown = 0;
let attackAnim = 0;

function update(dt) {
    const time = performance.now() * 0.001;
    
    if (isPaused) return; // Freeze the game state entirely while paused
    
    if (gameStarted && !isInventoryOpen) {
        player.rotation.y = yaw;
        
        const moveDir = new THREE.Vector3();
        if (keys['KeyW']) moveDir.z += 1; // Forward
        if (keys['KeyS']) moveDir.z -= 1; // Backward
        if (keys['KeyA']) moveDir.x += 1; // Strafe left
        if (keys['KeyD']) moveDir.x -= 1; // Strafe right

        const speed = keys['ShiftLeft'] ? 25 : 12;
        const isMoving = moveDir.length() > 0;
        if (isMoving) {
            moveDir.normalize().applyQuaternion(player.quaternion);
            state.pos.add(moveDir.multiplyScalar(speed * dt));
            
            // Hard stop at world border
            state.pos.x = THREE.MathUtils.clamp(state.pos.x, -WORLD_BORDER, WORLD_BORDER);
            state.pos.z = THREE.MathUtils.clamp(state.pos.z, -WORLD_BORDER, WORLD_BORDER);
            
            // Resolve world collisions after moving
            resolveCollisions(state.pos);
            walkCycle += dt * (speed / 1.5);
        } else {
            walkCycle = 0;
        }

        if (keys['Space'] && state.isGrounded) {
            state.velY = 15;
            state.isGrounded = false;
        }
    } else if (isInventoryOpen) {
        walkCycle = 0;
        // Player stands still in the main world while inventory is open.
        // The rotation is now handled by uiPlayer in the animate() loop.
    } else {
        walkCycle = 0;
    }
    
    // Update Entities & UI Overlays
    if (gameStarted) {
        activeEntities.forEach(ent => {
            ent.update(dt, player.position);
            
            // Health Bar Logic
            if (ent.showHealthTimer > 0) {
                ent.showHealthTimer -= dt;
                
                if (!ent.hpBarEl) {
                    ent.hpBarEl = document.createElement('div');
                    ent.hpBarEl.className = 'hp-bar-container';
                    
                    const fill = document.createElement('div');
                    fill.className = 'hp-bar-fill';
                    ent.hpBarEl.appendChild(fill);
                    
                    document.getElementById('game-overlays').appendChild(ent.hpBarEl);
                }
                
                // Map 3D pos to 2D
                const hpPos = ent.pos.clone();
                hpPos.y += 2.5; // Above head
                hpPos.project(camera);
                
                // Check if behind camera
                if (hpPos.z > 1) {
                    ent.hpBarEl.style.display = 'none';
                } else {
                    ent.hpBarEl.style.display = 'block';
                    const x = (hpPos.x * .5 + .5) * window.innerWidth;
                    const y = (hpPos.y * -.5 + .5) * window.innerHeight;
                    ent.hpBarEl.style.left = `${x}px`;
                    ent.hpBarEl.style.top = `${y}px`;
                    
                    // Update fill width
                    const hpPercent = Math.max(0, ent.mesh.userData.hp / ent.mesh.userData.maxHp) * 100;
                    ent.hpBarEl.firstChild.style.width = `${hpPercent}%`;
                    ent.hpBarEl.style.opacity = Math.min(1.0, ent.showHealthTimer);
                }
                
                if (ent.showHealthTimer <= 0) {
                    ent.hpBarEl.remove();
                    ent.hpBarEl = null;
                }
            }
        });

        // NPC Interact Prompt — check closest villager within 10 units
        if (!dialogOpen) {
            let closestVillager = null;
            let closestDist = 10;
            for (const ent of activeEntities) {
                if (ent.type === 'villager') {
                    const d = ent.pos.distanceTo(player.position);
                    if (d < closestDist) {
                        closestDist = d;
                        closestVillager = ent;
                    }
                }
            }
            nearVillager = closestVillager;
            if (closestVillager) {
                interactPrompt.classList.remove('hidden');
            } else {
                interactPrompt.classList.add('hidden');
            }
        } else {
            interactPrompt.classList.add('hidden');
        }
        
        // Damage Numbers Logic
        for (let i = activeDamageNumbers.length - 1; i >= 0; i--) {
            const dmg = activeDamageNumbers[i];
            dmg.life -= dt;
            if (dmg.life <= 0) {
                dmg.el.remove();
                activeDamageNumbers.splice(i, 1);
                continue;
            }
            
            // Physics
            dmg.pos.add(dmg.velocity.clone().multiplyScalar(dt));
            
            // Map to screen
            const dmgPos = dmg.pos.clone();
            dmgPos.project(camera);
            
            if (dmgPos.z > 1) {
                dmg.el.style.display = 'none';
            } else {
                dmg.el.style.display = 'block';
                const x = (dmgPos.x * .5 + .5) * window.innerWidth;
                const y = (dmgPos.y * -.5 + .5) * window.innerHeight;
                dmg.el.style.left = `${x}px`;
                dmg.el.style.top = `${y}px`;
                dmg.el.style.opacity = dmg.life / dmg.maxLife;
                // Scale effect
                const scale = 1.0 + (1.0 - dmg.life/dmg.maxLife) * 0.5;
                dmg.el.style.transform = `translate(-50%, -50%) scale(${scale})`;
            }
        }
    }
    
    // Combat Cooldown
    if (attackCooldown > 0) {
        attackCooldown -= dt;
    }
    if (attackAnim > 0) {
        attackAnim -= dt;
    }
    
    // Procedural Animation
    const { leftArm, rightArm, leftLeg, rightLeg } = player.userData.limbs;
    if (gameStarted && walkCycle > 0 && state.isGrounded) {
        const swing = Math.sin(walkCycle) * 0.8;
        leftArm.rotation.x = -swing;
        rightArm.rotation.x = swing;
        leftLeg.rotation.x = swing;
        rightLeg.rotation.x = -swing;
    } else if (gameStarted && !state.isGrounded) {
        // Jump pose
        leftArm.rotation.x = -Math.PI + 0.5; // Arms up
        rightArm.rotation.x = -Math.PI + 0.5;
        leftLeg.rotation.x = -0.2;
        rightLeg.rotation.x = 0.2;
    } else {
        // Idle
        const idleBreath = Math.sin(time * 2) * 0.05;
        leftArm.rotation.x = idleBreath;
        rightArm.rotation.x = -idleBreath;
        leftLeg.rotation.x = 0;
        rightLeg.rotation.x = 0;
    }

    // Override right arm for attack animation
    if (attackAnim > 0) {
        const progress = 1 - (attackAnim / 0.3); // 0 to 1
        rightArm.rotation.x = -Math.PI * 0.8 * Math.sin(progress * Math.PI);
    }

    state.velY -= 30 * dt;
    state.pos.y += state.velY * dt;
    const gh = getTerrainHeight(state.pos.x, state.pos.z);
    if (state.pos.y <= gh) {
        state.pos.y = gh;
        state.velY = 0;
        state.isGrounded = true;
    }

    player.position.copy(state.pos);
    
    // Day/Night Cycle Lighting
    if (gameStarted) {
        if (scene.background === menuBgTexture) {
            scene.background = new THREE.Color(0x87ceeb);
        }
        
        // 10 real minutes (600s) for day (0 to 0.5), 5 real minutes (300s) for night (0.5 to 1.0)
        const isDay = dayTime >= 0 && dayTime < 0.5;
        const timeSpeed = isDay ? (0.5 / 600) : (0.5 / 300);
        dayTime += dt * timeSpeed;
        if (dayTime > 1) dayTime -= 1;
        
        const sunAngle = dayTime * Math.PI * 2;
        const sunY = Math.sin(sunAngle);
        const sunZ = Math.cos(sunAngle);
        
        sun.position.set(100, sunY * 200, sunZ * 200);
        
        if (sunY > 0) {
            let intensity = Math.min(sunY * 2, 1);
            sun.intensity = 1.2 * intensity;
            ambientLight.intensity = 0.5 + (0.2 * intensity);
            
            if (sunY < 0.3) {
                let blend = sunY / 0.3;
                sun.color.setHex(0xffaa00).lerp(new THREE.Color(0xfff0dd), blend);
                scene.background.setHex(0xff7700).lerp(new THREE.Color(0x87ceeb), blend);
                scene.fog.color.copy(scene.background);
            } else {
                sun.color.setHex(0xfff0dd);
                scene.background.setHex(0x87ceeb);
                scene.fog.color.copy(scene.background);
            }
        } else {
            sun.intensity = 0;
            ambientLight.intensity = 0.2;
            scene.background.setHex(0x050510);
            scene.fog.color.copy(scene.background);
        }
    } else {
        if (isCustomizing) {
            scene.background = new THREE.Color(0x4a6fa5); // Nice sky blue so character is visible
        } else {
            scene.background = menuBgTexture;
        }
        sun.position.set(100, 100, 100);
        sun.intensity = 1.2;
        ambientLight.intensity = 0.8;
    }

    // Show/hide the 3D world based on game state
    worldGroup.visible = gameStarted;

    // Camera Logic
    if (gameStarted) {
        cameraPivot.rotation.set(pitch, 0, 0);
        cameraPivot.updateMatrixWorld();
        
        const idealLocal = new THREE.Vector3(0, 2.5, -8);
        const idealWorld = idealLocal.clone().applyMatrix4(cameraPivot.matrixWorld);
        const originWorld = new THREE.Vector3(player.position.x, player.position.y + 1.5, player.position.z);
        
        const dir = new THREE.Vector3().subVectors(idealWorld, originWorld).normalize();
        const maxDist = originWorld.distanceTo(idealWorld);
        
        const raycaster = new THREE.Raycaster(originWorld, dir, 0.1, maxDist);
        const intersects = raycaster.intersectObject(worldGroup, true);
        
        let finalLocal = idealLocal;
        if (intersects.length > 0) {
            const hitWorld = intersects[0].point.clone();
            hitWorld.add(dir.clone().multiplyScalar(-0.3));
            finalLocal = hitWorld.applyMatrix4(cameraPivot.matrixWorld.clone().invert());
        }
        
        camera.position.lerp(finalLocal, 0.2);
        camera.lookAt(player.position.x, player.position.y + 1.5, player.position.z);
    } else {
        if (isCustomizing) {
            cameraPivot.rotation.set(0, Math.PI, 0);
            camera.position.lerp(new THREE.Vector3(0, 1.75, -2.5), 0.1);
            camera.lookAt(player.position.x - 0.8, player.position.y + 1.75, player.position.z);
        } else {
            // Main menu cinematic camera
            cameraPivot.rotation.set(0, 0, 0);
            camera.position.lerp(new THREE.Vector3(-2.5, 0.5, -4.5), 0.05);
            camera.lookAt(player.position.x - 3, player.position.y + 2, player.position.z + 10);
        }
    }
    
    const hb = document.getElementById('health-bar');
    if (hb) {
        hb.style.width = state.health + '%';
        document.getElementById('hunger-bar').style.width = state.hunger + '%';
    }

    // --- BORDER PROXIMITY EFFECT ---
    if (gameStarted) {
        const distToEdge = Math.min(
            WORLD_BORDER - Math.abs(state.pos.x),
            WORLD_BORDER - Math.abs(state.pos.z)
        );
        const warnStart = 300; // Start warning at 300 units from edge
        const proximity = THREE.MathUtils.clamp(1 - distToEdge / warnStart, 0, 1);

        // Animate border walls opacity
        borderWalls.forEach(wall => {
            wall.material.opacity = proximity * 0.55;
            wall.material.emissiveIntensity = 0.8 + proximity * 1.5;
        });

        // Animate CSS vignette warning
        borderWarningEl.style.opacity = proximity;
        borderWarningEl.style.boxShadow = `inset 0 0 ${120 * proximity}px rgba(255, 40, 0, ${proximity * 0.5})`;
        borderWarningEl.style.background = `radial-gradient(ellipse at center, transparent 50%, rgba(255,40,0,${proximity * 0.35}) 100%)`;
        borderWarningText.style.opacity = proximity > 0.6 ? (proximity - 0.6) / 0.4 : 0;
    }
}

function animate() {
    requestAnimationFrame(animate);
    const time = performance.now();
    const dt = Math.min(time - lastTime, 100) / 1000;
    lastTime = time;
    update(dt);
    
    // 1. Render main game
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);
    
    // 2. Render UI Scene if inventory is open
    if (isInventoryOpen && uiPlayer) {
        const pane = document.getElementById('character-pane');
        if (pane) {
            const rect = pane.getBoundingClientRect();
            // WebGL viewport uses bottom-left origin
            const bottom = window.innerHeight - rect.bottom;
            
            renderer.setScissorTest(true);
            renderer.setScissor(rect.left, bottom, rect.width, rect.height);
            renderer.setViewport(rect.left, bottom, rect.width, rect.height);
            
            uiCamera.aspect = rect.width / rect.height;
            uiCamera.updateProjectionMatrix();
            
            uiPlayer.rotation.y += 0.01; // spin in UI
            
            renderer.clearDepth(); // render on top of existing main scene output
            renderer.render(uiScene, uiCamera);
            renderer.setScissorTest(false);
        }
    }
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- M1 COMBAT SYSTEM ---
const ATTACK_RANGE = 8;
const ATTACK_DAMAGE = 20;

// Flash a red hit indicator briefly on screen
function showHitFlash() {
    const flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;inset:0;background:rgba(255,0,0,0.25);pointer-events:none;z-index:9999;transition:opacity 0.3s;';
    document.body.appendChild(flash);
    setTimeout(() => { flash.style.opacity = '0'; }, 50);
    setTimeout(() => flash.remove(), 400);
}

window.addEventListener('mousedown', (e) => {
    // M1 = left click (button 0)
    if (e.button !== 0 || !gameStarted || isPaused || isInventoryOpen) return;
    if (attackCooldown > 0) return;
    attackCooldown = 0.6; // 0.6s between swings
    attackAnim = 0.3; // 0.3s attack animation duration

    // Raycast from camera forward to find entities
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    
    const raycaster = new THREE.Raycaster(origin, dir, 0, ATTACK_RANGE);
    
    // Check all entity meshes
    let hit = false;
    for (let i = activeEntities.length - 1; i >= 0; i--) {
        const ent = activeEntities[i];
        if (!ent.mesh.userData.hp) continue;
        
        const meshes = [];
        ent.mesh.traverse(child => { if (child.isMesh) meshes.push(child); });
        const intersects = raycaster.intersectObjects(meshes, false);
        
        if (intersects.length > 0) {
            ent.mesh.userData.hp -= ATTACK_DAMAGE;
            ent.showHealthTimer = 5.0; // Show health bar for 5 seconds
            spawnDamageNumber(ent.pos.x, ent.pos.y + 2, ent.pos.z, ATTACK_DAMAGE, true);
            
            showHitFlash();
            hit = true;
            
            // Knock entity back slightly
            const knockDir = new THREE.Vector3().subVectors(ent.pos, state.pos).normalize();
            ent.pos.add(knockDir.multiplyScalar(3));
            
            if (ent.mesh.userData.hp <= 0) {
                // Entity is dead — remove from scene and array
                worldGroup.remove(ent.mesh);
                if (ent.hpBarEl) {
                    ent.hpBarEl.remove();
                    ent.hpBarEl = null;
                }
                activeEntities.splice(i, 1);
                // Grant XP
                state.xp += ent.type === 'wolf' ? 15 : 5;
                const xpEl = document.getElementById('xp-bar');
                if (xpEl) xpEl.style.width = Math.min(state.xp % 100, 100) + '%';
            }
            break; // Only hit one entity per swing
        }
    }
});

