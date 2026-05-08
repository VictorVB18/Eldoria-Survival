import './style.css';
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { registerCollider, resolveCollisions, checkCollision } from './physics.js';

function spawnGroundCrack(x, y, z, rotation) {
    const geom = new THREE.PlaneGeometry(8, 8);
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    for(let j=0; j<4; j++) {
        ctx.beginPath();
        ctx.moveTo(128, 128);
        let currX = 128, currY = 128;
        const angle = (Math.PI / 2) * j + (Math.random() * 0.5 - 0.25);
        for(let i=0; i<4; i++) {
            currX += Math.cos(angle) * (20 + Math.random()*20);
            currY += Math.sin(angle) * (20 + Math.random()*20);
            ctx.lineTo(currX, currY);
        }
        ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.8, color: 0x222222, depthWrite: false });
    const mesh = new THREE.Mesh(geom, mat);
    
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rotation;
    mesh.position.set(x, getTerrainHeight(x, z) + 0.15, z);
    
    worldGroup.add(mesh);
    activeCracks.push({ mesh, timer: 10.0 });
}

// --- CONFIG ---
const WORLD_SIZE = 2000;
const WORLD_BORDER = WORLD_SIZE * 0.48; // ~960 — hard border edge
const TILE_RES = 200;
const WATER_LEVEL = -10; // Global sea level
const noise2D = createNoise2D();

// --- AUDIO SYSTEM (Procedural) ---
let audioCtx = null;
let ambientWind = null;
let musicPad = null; // Cinematic pad
let adventureMusic = null; // Upbeat exploration
let menuMusic = null;
let masterMusicGain = null;

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();

    masterMusicGain = audioCtx.createGain();
    masterMusicGain.gain.value = state.settings.musicEnabled ? 1.0 : 0.0;
    masterMusicGain.connect(audioCtx.destination);

    setupMenuMusic();
    setupAmbientWind();
    setupMusicPad();
    setupAdventureMusic();
}

function setupMenuMusic() {
    const musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.0;
    musicGain.connect(masterMusicGain);
    musicGain.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 2);

    // Deep atmospheric drone instead of annoying melody
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 55; // Low A
    osc.connect(musicGain);
    osc.start();

    // Subtle wind texture
    const bufferSize = audioCtx.sampleRate * 2;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    
    noise.connect(filter);
    filter.connect(musicGain);
    noise.start();

    menuMusic = musicGain;
}

function setupAdventureMusic() {
    // Lush generative ambient synth for adventure
    const musicGain = audioCtx.createGain();
    musicGain.gain.value = state.settings.musicEnabled ? 0.8 : 0.0;
    musicGain.connect(masterMusicGain);

    // Delay Node for Echo
    const delayNode = audioCtx.createDelay();
    delayNode.delayTime.value = 0.75; 
    const delayFeedback = audioCtx.createGain();
    delayFeedback.gain.value = 0.4;
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(musicGain);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.connect(delayNode);
    filter.connect(musicGain);

    const scale = [196.00, 220.00, 246.94, 293.66, 329.63, 392.00, 440.00]; // G Major Pentatonic
    
    const playNote = (freq, len) => {
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc1.type = 'sine';
        osc2.type = 'triangle';
        osc1.frequency.value = freq;
        osc2.frequency.value = freq * 1.002;
        
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(filter);
        
        const now = audioCtx.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.15, now + len * 0.3);
        gain.gain.setTargetAtTime(0, now + len * 0.3, len * 0.5);
        
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + len * 2);
        osc2.stop(now + len * 2);
    };

    const playBass = () => {
        if (!gameStarted) { setTimeout(playBass, 1000); return; }
        playNote(98.00, 8); // G2 bass
        setTimeout(playBass, 16000); 
    };

    const playMelody = () => {
        if (!gameStarted) { setTimeout(playMelody, 1000); return; }
        const numNotes = 1 + Math.floor(Math.random() * 3);
        let timeOffset = 0;
        for (let i = 0; i < numNotes; i++) {
            const freq = scale[Math.floor(Math.random() * scale.length)];
            setTimeout(() => playNote(freq, 4), timeOffset * 1000);
            timeOffset += 0.5 + Math.random() * 1.5;
        }
        setTimeout(playMelody, 4000 + Math.random() * 8000);
    };

    playBass();
    playMelody();

    adventureMusic = musicGain;
}

function setupAmbientWind() {
    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = audioCtx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 10;

    const gain = audioCtx.createGain();
    gain.gain.value = 0.0;

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    whiteNoise.start();

    ambientWind = { filter, gain };
}

function setupMusicPad() {
    const musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.0;
    musicGain.connect(masterMusicGain);

    const playNote = (freq, delay, vol = 1.0) => {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + delay);
        g.gain.setValueAtTime(0, audioCtx.currentTime + delay);
        g.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + delay + 2);
        g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + delay + 8);
        osc.connect(g);
        g.connect(musicGain);
        osc.start(audioCtx.currentTime + delay);
        osc.stop(audioCtx.currentTime + delay + 10);
    };

    const loop = () => {
        const baseNotes = [110, 130.81, 164.81, 196.00];
        const highNotes = [220, 261.63, 329.63, 392.00];
        baseNotes.forEach((n, i) => playNote(n, i * 2, 0.6));
        highNotes.forEach((n, i) => playNote(n, i * 2 + 1, 0.3));
        setTimeout(loop, 15000);
    };
    loop();
    musicPad = musicGain;
}

function playSound(type, pitch = 1.0, volume = 1.0) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'hit_wood') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150 * pitch, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3 * volume, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    } else if (type === 'hit_rock') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(800 * pitch, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.1 * volume, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.05);
    } else if (type === 'death') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(20, audioCtx.currentTime + 1.0);
        gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.0);
        osc.start();
        osc.stop(audioCtx.currentTime + 1.0);
    } else if (type === 'wolf') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200 * pitch, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(300 * pitch, audioCtx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.1 * volume, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    } else if (type === 'bear') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(60 * pitch, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(40 * pitch, audioCtx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.4 * volume, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.5);
    } else if (type === 'stag') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400 * pitch, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(500 * pitch, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1 * volume, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.2);
    } else if (type === 'wendigo_whistle') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200 * pitch, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(1800 * pitch, audioCtx.currentTime + 0.4);
        osc.frequency.linearRampToValueAtTime(1200 * pitch, audioCtx.currentTime + 1.2);
        gain.gain.setValueAtTime(0.0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.5 * volume, audioCtx.currentTime + 0.4);
        gain.gain.linearRampToValueAtTime(0.0, audioCtx.currentTime + 1.2);
        osc.start();
        osc.stop(audioCtx.currentTime + 1.2);
    }
}

// --- GLOBAL PLACEMENT TOOLS ---
let terrainPosAttr = null; // Will be set after terrain geometry is built

/**
 * High-performance height check that reads directly from the terrain mesh vertices.
 * Uses bilinear interpolation to find the exact height at any coordinate (x, z).
 */
function getMeshHeight(x, z) {
    if (!terrainPosAttr) return getTerrainHeight(x, z);

    const worldTotalSize = WORLD_SIZE * 4;
    const segments = TILE_RES * 2;
    const halfSize = WORLD_SIZE * 2;

    // Map world coords to grid coords [0, segments]
    const gridX = (x + halfSize) / worldTotalSize * segments;
    const gridZ = (z + halfSize) / worldTotalSize * segments;

    const ix = Math.floor(gridX);
    const iz = Math.floor(gridZ);

    // Boundary check
    if (ix < 0 || ix >= segments || iz < 0 || iz >= segments) {
        return getTerrainHeight(x, z);
    }

    // Get 4 surrounding vertex indices
    const rowLen = segments + 1;
    const idx00 = (iz * rowLen) + ix;
    const idx10 = idx00 + 1;
    const idx01 = idx00 + rowLen;
    const idx11 = idx01 + 1;

    const y00 = terrainPosAttr.getY(idx00);
    const y10 = terrainPosAttr.getY(idx10);
    const y01 = terrainPosAttr.getY(idx01);
    const y11 = terrainPosAttr.getY(idx11);

    // Bilinear interpolation
    const fx = gridX - ix;
    const fz = gridZ - iz;
    const hTop = y00 * (1 - fx) + y10 * fx;
    const hBot = y01 * (1 - fx) + y11 * fx;
    return hTop * (1 - fz) + hBot * fz;
}

// --- ENGINE SETUP ---
const textureLoader = new THREE.TextureLoader();
const menuBgTexture = textureLoader.load(`${import.meta.env.BASE_URL}menu_bg.png`);

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
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const sun = new THREE.DirectionalLight(0xfff0dd, 1.4);
sun.position.set(100, 200, 100);
sun.castShadow = true;
// High-res crisp shadows!
sun.shadow.mapSize.width = 1024;
sun.shadow.mapSize.height = 1024;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 300;
sun.shadow.camera.left = -100;
sun.shadow.camera.right = 100;
sun.shadow.camera.top = 100;
sun.shadow.camera.bottom = -100;
sun.shadow.bias = -0.0005;
scene.add(sun);
scene.add(sun.target); // Needed to move the sun target dynamically

const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x4caf50, 0.4);
scene.add(hemiLight);

// --- ENVIRONMENTAL EFFECTS ---
// Stars
const starsGeo = new THREE.BufferGeometry();
const starsVerts = [];
for(let i=0; i<3000; i++) {
    const x = (Math.random() - 0.5) * 2000;
    const y = 200 + Math.random() * 800;
    const z = (Math.random() - 0.5) * 2000;
    starsVerts.push(x, y, z);
}
starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starsVerts, 3));
const starsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.0, sizeAttenuation: true, transparent: true, opacity: 0 });
const stars = new THREE.Points(starsGeo, starsMat);
scene.add(stars);

// Fireflies
const firefliesGeo = new THREE.BufferGeometry();
const firefliesVerts = [];
for(let i=0; i<400; i++) {
    firefliesVerts.push((Math.random() - 0.5) * 300, Math.random() * 8, (Math.random() - 0.5) * 300);
}
firefliesGeo.setAttribute('position', new THREE.Float32BufferAttribute(firefliesVerts, 3));
const firefliesMat = new THREE.PointsMaterial({ color: 0xffffaa, size: 0.6, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
const fireflies = new THREE.Points(firefliesGeo, firefliesMat);
scene.add(fireflies);

// --- NARRATION SYSTEM ---
function narrate(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();

    // Prioritize deeper, more cinematic male voices
    const narratorVoice = voices.find(v => v.name.includes('Google UK English Male')) ||
        voices.find(v => v.name.includes('Male')) ||
        voices.find(v => v.lang === 'en-GB') ||
        voices[0];

    if (narratorVoice) utterance.voice = narratorVoice;
    utterance.pitch = 0.5; // Much deeper for "ancient" feel
    utterance.rate = 0.85; // Slower, more deliberate
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
}

// --- TERRAIN & BIOMES ---
const BIOMES = {
    LUSH: 0,
    MAGIC: 1,
    GOLDEN: 2,
    CRYSTAL: 3
};

function getBiomeData(x, z) {
    // Flatten center for Capital City
    const distToCenter = Math.sqrt(x*x + z*z);
    let centerFlatness = 0;
    if (distToCenter < 160) {
        centerFlatness = 1;
    } else if (distToCenter < 220) {
        centerFlatness = 1 - (distToCenter - 160) / 60;
    }

    // Lake/Ocean Noise - Much smoother dipping
    const lakeNoise = noise2D(x * 0.001, z * 0.001);
    let lakeDepth = 0;
    if (lakeNoise < -0.4) {
        lakeDepth = Math.pow((lakeNoise + 0.4) * 3, 2) * -30;
    }

    const bNoise = noise2D(x * 0.0015, z * 0.0015);
    let type = BIOMES.LUSH;
    if (bNoise < -0.3) type = BIOMES.MAGIC;
    else if (bNoise > 0.4) type = BIOMES.GOLDEN;
    else if (bNoise > 0.1 && bNoise <= 0.4) type = BIOMES.CRYSTAL;

    let h = (noise2D(x * 0.005, z * 0.005) * 3) + lakeDepth;

    if (centerFlatness > 0) {
        h = h * (1 - centerFlatness) + 3.0 * centerFlatness;
        if (centerFlatness === 1) type = BIOMES.LUSH;
    }

    // Mountains - Create sharp, ridged peaks matching the low-poly aesthetic
    let m = noise2D(x * 0.0008, z * 0.0008);
    // Use absolute value noise to create sharp geometric ridges
    let ridge = 1.0 - Math.abs(noise2D(x * 0.0015, z * 0.0015));
    
    if (centerFlatness > 0) {
        m = m * (1 - centerFlatness); // Suppress mountains near capital
        ridge = ridge * (1 - centerFlatness);
    }
    
    if (type === BIOMES.CRYSTAL) {
        if (m > 0.25) h += ((m - 0.25) * 250) + (ridge * 60 * (m - 0.25));
    } else {
        if (m > 0.4) {
            let base = (m - 0.4) * 220; // Linear scaling for straighter slopes
            h += base + (ridge * base * 0.8); // Add sharp geometric ridges
        }
    }

    // Add extra rolling hills for "thickness"
    let hills = noise2D(x * 0.008, z * 0.008);
    if (hills > 0.4) h += (hills - 0.4) * 15 * (1 - centerFlatness);

    // Safety: No bottomless pits
    if (h < -25) h = -25;

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
    if (h < -12) col.setHex(0x1a3a4c); // Deep blue water
    else if (h < -7) col.setHex(0xe0cd8b); // Sand
    else if (h < 0) col.setHex(0xd0b46b); // Dry sand/path
    else {
        if (biome.type === BIOMES.MAGIC) col.setHex(0x7e57c2); 
        else if (biome.type === BIOMES.GOLDEN) col.setHex(0xffca28); 
        else if (biome.type === BIOMES.CRYSTAL) col.setHex(0x80cbc4); 
        else {
            // Bright vibrant green with a slight organic variation
            col.setHex(0x8bc34a);
            let colorVariation = (Math.sin(x * 0.2) + Math.cos(z * 0.2)) * 0.03;
            col.offsetHSL(colorVariation, 0, colorVariation);
        }

        if (h > 15) {
            let rockColor = new THREE.Color(0x8a9ba8); // Cool purplish-blue rock matching the image
            if (biome.type === BIOMES.MAGIC) rockColor.setHex(0x4527a0);
            if (biome.type === BIOMES.GOLDEN) rockColor.setHex(0x8d6e63);

            let blend = Math.min((h - 15) / 10, 1);
            col.lerp(rockColor, blend);

            if (h > 45) { // Higher, sharper snow line
                let snowColor = new THREE.Color(0xffffff); // Crisp white snow
                if (biome.type === BIOMES.MAGIC) snowColor.setHex(0x00bcd4);
                if (biome.type === BIOMES.GOLDEN) snowColor.setHex(0xffecb3);
                let snowBlend = Math.min((h - 45) / 8, 1); // Quicker transition
                col.lerp(snowColor, snowBlend);
            }
        }
    }
    colorAttr.setXYZ(i, col.r, col.g, col.b);
}
terrainPosAttr = posAttr; // Set global reference for getMeshHeight

// Use flatShading on the indexed geometry. This gives a nice low-poly lighting effect
// without breaking the color gradients which makes the diagonal grid too obvious.
terrainGeometry.computeVertexNormals();
const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));

terrain.receiveShadow = true;

// Group for all 3D world objects — hidden on the menu screen
const worldGroup = new THREE.Group();
scene.add(worldGroup);
worldGroup.add(terrain);

// Optimization: Dedicated group for camera/interaction collisions
const collisionGroup = new THREE.Group();
scene.add(collisionGroup);

// --- WATER SYSTEM ---
const waterGeo = new THREE.PlaneGeometry(WORLD_SIZE * 4, WORLD_SIZE * 4, 128, 128);
waterGeo.rotateX(-Math.PI / 2);

const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1ca3ec,
    transparent: true,
    opacity: 0.85,
    roughness: 0.05,
    metalness: 0.9,
    flatShading: true,
    depthWrite: false
});

waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.time = { value: 0 };
    waterMat.userData.shader = shader; // store for updates
    
    // Inject uniform and modify vertex position
    shader.vertexShader = `
        uniform float time;
    ` + shader.vertexShader;
    
    shader.vertexShader = shader.vertexShader.replace(
        `#include <begin_vertex>`,
        `
        vec3 transformed = vec3( position );
        // Plane is rotated -PI/2 on X, so Z is up/down in local space.
        // position.x and position.y are the horizontal axes.
        transformed.z += sin(position.x * 0.5 + time * 2.0) * 0.2 + cos(position.y * 0.5 + time * 1.5) * 0.2;
        `
    );
};

const water = new THREE.Mesh(waterGeo, waterMat);
water.position.y = WATER_LEVEL;
worldGroup.add(water);



// --- PLAYER ---
const player = new THREE.Group();

const skinMat = new THREE.MeshStandardMaterial({ color: 0xffccaa });
const shirtMat = new THREE.MeshStandardMaterial({ color: 0x556b2f });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
const bagMat = new THREE.MeshStandardMaterial({ color: 0x3e2723 });
const shoeMat = new THREE.MeshStandardMaterial({ color: 0x212121 });

const beltMat = new THREE.MeshStandardMaterial({ color: 0x3e2723 });
const buckleMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.2 });

const torsoGroup = new THREE.Group();
torsoGroup.position.y = 1.0;
player.add(torsoGroup);

const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.4), shirtMat);
torso.castShadow = true;
torsoGroup.add(torso);

const belt = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.15, 0.42), beltMat);
belt.position.y = -0.45;
const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.45), buckleMat);
buckle.position.y = -0.45;
torsoGroup.add(belt, buckle);

const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skinMat);
head.position.y = 1.75;
head.castShadow = true;
player.add(head);

const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), eyeMat);
leftEye.position.set(-0.1, 0.1, 0.25);
const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), eyeMat);
rightEye.position.set(0.1, 0.1, 0.25);
const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.08), eyeMat);
mouth.position.set(0, -0.12, 0.25);
head.add(leftEye, rightEye, mouth);

const scarMat = new THREE.MeshStandardMaterial({ color: 0x880000 });
const accessoryMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });

const scarGroup = new THREE.Group();
head.add(scarGroup);
const accessoryGroup = new THREE.Group();
player.add(accessoryGroup);
const headAccessoryGroup = new THREE.Group();
head.add(headAccessoryGroup);

const hairMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
const beardMat = new THREE.MeshStandardMaterial({ color: 0x222222 });

const hairGroup = new THREE.Group();
head.add(hairGroup);
const beardGroup = new THREE.Group();
head.add(beardGroup);

function updateEyes(style) {
    leftEye.scale.set(1, 1, 1);
    rightEye.scale.set(1, 1, 1);
    leftEye.rotation.z = 0;
    rightEye.rotation.z = 0;
    eyeMat.emissiveIntensity = 0;
    eyeMat.emissive.set(0x000000);

    if (style === 'narrow') {
        leftEye.scale.y = 0.4;
        rightEye.scale.y = 0.4;
    } else if (style === 'large') {
        leftEye.scale.set(1.4, 1.4, 1);
        rightEye.scale.set(1.4, 1.4, 1);
    } else if (style === 'angry') {
        leftEye.rotation.z = 0.4;
        rightEye.rotation.z = -0.4;
        leftEye.scale.y = 0.6;
        rightEye.scale.y = 0.6;
    } else if (style === 'undead') {
        eyeMat.color.set(0xffffff);
        eyeMat.emissive.set(0x00ffff);
        eyeMat.emissiveIntensity = 1;
        leftEye.scale.set(1.2, 1.2, 1.2);
        rightEye.scale.set(1.2, 1.2, 1.2);
    } else {
        const c = document.getElementById('color-eyes')?.value || '#000000';
        eyeMat.color.set(c);
    }
}

function updateScars(type) {
    scarGroup.clear();
    if (type === 'none') return;
    if (type === 'eye_left') {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.02), scarMat);
        s.position.set(-0.1, 0.1, 0.26);
        scarGroup.add(s);
    } else if (type === 'eye_right') {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.02), scarMat);
        s.position.set(0.1, 0.1, 0.26);
        scarGroup.add(s);
    } else if (type === 'cross_cheek') {
        const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.02), scarMat);
        const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.02), scarMat);
        s1.rotation.z = 0.7; s2.rotation.z = -0.7;
        s1.position.set(0.18, -0.1, 0.26); s2.position.set(0.18, -0.1, 0.26);
        scarGroup.add(s1, s2);
    } else if (type === 'bridge') {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.02), scarMat);
        s.position.set(0, 0, 0.26);
        scarGroup.add(s);
    }
}

function updateAccessory(type) {
    accessoryGroup.clear();
    headAccessoryGroup.clear();
    if (type === 'none') return;
    
    const goldTrimMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.2 });

    if (type === 'cape') {
        const capeGroup = new THREE.Group();
        
        // 1. Shoulder/Collar Piece (Attached to body)
        const collar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.15, 0.45), accessoryMat);
        collar.position.set(0, 1.48, -0.1);
        
        // 2. The "Drape" (Connects shoulders to the back flow)
        const drape = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.4, 0.1), accessoryMat);
        drape.position.set(0, 1.35, -0.28);
        drape.rotation.x = 0.6;
        
        // 3. Main flowing strips
        const flowGrp = new THREE.Group();
        flowGrp.position.set(0, 0.6, -0.5);
        flowGrp.rotation.x = 0.1;

        const strips = [
            { x: -0.22, h: 1.3, rz: 0.08, z: 0.02 },
            { x: 0, h: 1.5, rz: 0, z: 0 },
            { x: 0.22, h: 1.3, rz: -0.08, z: 0.02 }
        ];

        strips.forEach(s => {
            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.35, s.h, 0.04), accessoryMat);
            strip.position.set(s.x, -0.2, s.z);
            strip.rotation.z = s.rz;
            strip.castShadow = true;
            
            const trim = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.1, 0.06), goldTrimMat);
            trim.position.set(0, -s.h/2 + 0.05, 0);
            strip.add(trim);
            flowGrp.add(strip);
        });
        
        capeGroup.add(collar, drape, flowGrp);
        accessoryGroup.add(capeGroup);
    } else if (type === 'headband') {
        const hbGroup = new THREE.Group();
        const hb = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.55), accessoryMat);
        hb.position.y = 0.15;
        const knot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), accessoryMat);
        knot.position.set(0, 0.15, -0.3);
        knot.rotation.z = 0.5;
        hbGroup.add(hb, knot);
        headAccessoryGroup.add(hbGroup);
    } else if (type === 'bandana') {
        const bGroup = new THREE.Group();
        // Sleek face mask
        const mask = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.22, 0.15), accessoryMat);
        mask.position.set(0, -0.15, 0.2); // Sits over nose/mouth
        
        // Side wraps
        const leftWrap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.52), accessoryMat);
        leftWrap.position.set(-0.26, -0.15, 0);
        const rightWrap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.52), accessoryMat);
        rightWrap.position.set(0.26, -0.15, 0);
        
        bGroup.add(mask, leftWrap, rightWrap);
        headAccessoryGroup.add(bGroup);
    }
}

function createDetailedHair(style, color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: color });
    
    if (style === 'short') {
        const main = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.15, 0.55), mat);
        main.position.y = 0.25;
        g.add(main);
    } else if (style === 'spiky') {
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.52), mat);
        base.position.y = 0.25;
        g.add(base);
        const positions = [
            [0.15, 0.3, 0.15], [-0.15, 0.3, 0.15],
            [0.15, 0.3, -0.15], [-0.15, 0.3, -0.15],
            [0, 0.35, 0], [0.2, 0.28, 0], [-0.2, 0.28, 0]
        ];
        positions.forEach(p => {
            const spike = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.25, 0.18), mat);
            spike.position.set(p[0], p[1], p[2]);
            spike.rotation.set(Math.random() * 0.4, Math.random() * 0.4, Math.random() * 0.4);
            g.add(spike);
        });
    } else if (style === 'curly') {
        for (let i = 0; i < 18; i++) {
            const curl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), mat);
            curl.position.set((Math.random() - 0.5) * 0.45, 0.25 + Math.random() * 0.15, (Math.random() - 0.5) * 0.45);
            g.add(curl);
        }
    } else if (style === 'long') {
        const main = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.55), mat);
        main.position.y = 0.25;
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.15), mat);
        back.position.set(0, -0.1, -0.25);
        g.add(main, back);
    } else if (style === 'ponytail') {
        const main = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.15, 0.55), mat);
        main.position.y = 0.25;
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.15), mat);
        tail.position.set(0, 0.1, -0.35);
        tail.rotation.x = -0.3;
        g.add(main, tail);
    }
    return g;
}

function updateHair(style) {
    hairGroup.clear();
    const hair = createDetailedHair(style, hairMat.color);
    hairGroup.add(hair);
}

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


function updateBeard(style) {
    beardGroup.clear();
    if (beardStyles[style]) beardGroup.add(beardStyles[style]);
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

function createArm(isRight) {
    const group = new THREE.Group();
    // Sleeve
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.4, 0.28), shirtMat);
    sleeve.position.y = -0.15 + 0.1;
    sleeve.castShadow = true;
    // Bare arm
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.25), skinMat);
    arm.position.y = -0.45 + 0.1;
    arm.castShadow = true;
    
    group.add(sleeve, arm);
    group.position.set(isRight ? 0.5 : -0.5, 1.45, 0);
    return group;
}

const leftArm = createArm(false);
player.add(leftArm);

const rightArm = createArm(true);
player.add(rightArm);

// Tool Attachment Point in hand
const handGroup = new THREE.Group();
handGroup.position.set(0, -0.9, 0.25); // Tip of arm, slightly forward
rightArm.add(handGroup);
player.userData.handGroup = handGroup;

function createLeg(isRight) {
    const group = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), pantsMat);
    leg.position.y = -0.45;
    leg.castShadow = true;
    
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.44), shoeMat);
    shoe.position.set(0, -0.81, 0.06);
    shoe.castShadow = true;
    
    group.add(leg, shoe);
    group.position.set(isRight ? 0.2 : -0.2, 0.9, 0);
    return group;
}

const leftLeg = createLeg(false);
player.add(leftLeg);

const rightLeg = createLeg(true);
player.add(rightLeg);

player.userData.limbs = { leftArm, rightArm, leftLeg, rightLeg };

const backpack = new THREE.Group();

// Main body
const mainBag = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.3), bagMat);
mainBag.position.set(0, 0, 0);
mainBag.castShadow = true;
backpack.add(mainBag);

// Top flap
const flapMat = new THREE.MeshStandardMaterial({ color: 0x2d1b15 });
const flap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.32), flapMat);
flap.position.set(0, 0.25, 0.02);
flap.rotation.x = 0.1;
flap.castShadow = true;
backpack.add(flap);

// Side pouches
const pouchGeo = new THREE.BoxGeometry(0.15, 0.3, 0.2);
const leftPouch = new THREE.Mesh(pouchGeo, bagMat);
leftPouch.position.set(-0.35, -0.1, 0);
leftPouch.castShadow = true;
backpack.add(leftPouch);

const rightPouch = new THREE.Mesh(pouchGeo, bagMat);
rightPouch.position.set(0.35, -0.1, 0);
rightPouch.castShadow = true;
backpack.add(rightPouch);

// Bedroll attached to bottom
const bedrollMat = new THREE.MeshStandardMaterial({ color: 0x4a5d23 }); // olive green
const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.7, 8), bedrollMat);
bedroll.rotation.z = Math.PI / 2;
bedroll.position.set(0, -0.45, 0.05);
bedroll.castShadow = true;
backpack.add(bedroll);

// Straps
const strapMat = new THREE.MeshStandardMaterial({ color: 0x1a1008 });
const strapGeo = new THREE.BoxGeometry(0.1, 0.8, 0.05);
const leftStrap = new THREE.Mesh(strapGeo, strapMat);
leftStrap.position.set(-0.2, 0, 0.16);
backpack.add(leftStrap);

const rightStrap = new THREE.Mesh(strapGeo, strapMat);
rightStrap.position.set(0.2, 0, 0.16);
backpack.add(rightStrap);

backpack.position.set(0, 1.1, -0.35); // Back of character (-Z side)
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
    isDead: false,
    health: 100,
    hunger: 100,
    oxygen: 100,
    xp: 0,
    level: 1,
    mounted: null,
    inventory: {
        wood: 0,
        stone: 0,
        stick: 0,
        berry: 0,
        carrot: 0,
        meat: 0,
        hide: 0,
        bone: 0,
        dark_essence: 0,
        coal: 0,
        wooden_pickaxe: 0,
        stone_pickaxe: 0,
        wooden_sword: 0,
        stone_sword: 0
    },
    equips: {
        weapon: null
    },
    instanceHealth: new Map(), // key: meshID_instanceID -> hp
    settings: {
        musicEnabled: true,
        invertY: localStorage.getItem('eldoria_invert_y') === 'true'
    },
    quests: {
        activeId: null,
        completed: []
    },
    lastSpawnBucket: 0
};

// --- QUESTS SYSTEM ---
const QUESTS = {
    'gather_wood': {
        title: "The Woodcutter's Plea",
        text_offer: "The village walls are rotting. Can you bring us 20 Wood? We'll reward you handsomely.",
        text_progress: "Do you have the 20 Wood yet? We really need it.",
        text_complete: "Thank you! This will keep the village safe. Take these carrots and stone for your trouble.",
        req: { wood: 20 },
        reward: { xp: 50, carrot: 5, stone: 5 },
        nextId: 'shadow_threat'
    },
    'shadow_threat': {
        title: "The Shadow Threat",
        text_offer: "The Shadow Wolves in the Magic Forest are getting bolder. They drop Dark Essence. Bring me 2 Dark Essence as proof of their defeat.",
        text_progress: "Slaying the wolves is dangerous... Do you have 2 Dark Essence yet?",
        text_complete: "You are a true hero! Here, take this stone sword. It will serve you better.",
        req: { dark_essence: 2 },
        reward: { xp: 150, stone_sword: 1 },
        nextId: null // End of current questline
    }
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
controlsBtn?.addEventListener('click', () => { pendingBinds = {...currentBinds}; renderControls(); });

const mainMenu = document.getElementById('main-menu');
const hud = document.getElementById('hud');

const controlsModal = document.getElementById('controls-modal');
const loreModal = document.getElementById('lore-modal');
const customizerModal = document.getElementById('customizer-modal');

document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        if (controlsModal) controlsModal.classList.add('hidden');
        if (loreModal) loreModal.classList.add('hidden');
        if (customizerModal && !customizerModal.classList.contains('hidden')) {
            // Only restore main menu when the customizer itself was open
            customizerModal.classList.add('hidden');
            mainMenu.classList.remove('hidden');
        }
        isCustomizing = false;

        // If the game is running and paused (e.g. Controls/Options opened from pause menu),
        // make sure we return to the pause menu so the player can Resume normally.
        if (gameStarted && isPaused) {
            if (optionsModal) optionsModal.classList.add('hidden');
            if (ingamePauseModal) ingamePauseModal.classList.remove('hidden');
        }
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
    state.pos.set(0, 20, 80);
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
            level: state.level,
            inventory: state.inventory,
            equips: state.equips,
            quests: state.quests
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
            shoes: document.getElementById('color-shoe').value,
            hairStyle: document.getElementById('select-hair').value,
            beardStyle: document.getElementById('select-beard').value,
            eyeStyle: document.getElementById('select-eyes').value,
            scarType: document.getElementById('select-scar').value,
            accessoryType: document.getElementById('select-accessory').value,
            accessoryColor: document.getElementById('color-accessory').value
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
    
    // Default fallback for older saves
    if (data.state.inventory) state.inventory = data.state.inventory;
    if (data.state.equips) state.equips = data.state.equips;
    if (data.state.quests) state.quests = data.state.quests;

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
    if (data.appearance.shoes) {
        document.getElementById('color-shoe').value = data.appearance.shoes;
        shoeMat.color.set(data.appearance.shoes);
    }

    document.getElementById('select-beard').value = data.appearance.beardStyle;
    updateBeard(data.appearance.beardStyle);

    if (data.appearance.eyeStyle) {
        document.getElementById('select-eyes').value = data.appearance.eyeStyle;
        updateEyes(data.appearance.eyeStyle);
    }
    if (data.appearance.scarType) {
        document.getElementById('select-scar').value = data.appearance.scarType;
        updateScars(data.appearance.scarType);
    }
    if (data.appearance.accessoryType) {
        document.getElementById('select-accessory').value = data.appearance.accessoryType;
        updateAccessory(data.appearance.accessoryType);
    }
    if (data.appearance.accessoryColor) {
        document.getElementById('color-accessory').value = data.appearance.accessoryColor;
        accessoryMat.color.set(data.appearance.accessoryColor);
    }

    updateHeldItem();
}

if (playBtn) {
    playBtn.addEventListener('click', () => {
        initAudio();
        updateSaveSlotsUI();
        mainMenu.classList.add('hidden');
        saveSlotsModal.classList.remove('hidden');
    });
}

if (customizeBtn) {
    customizeBtn.addEventListener('click', () => {
        initAudio();
        mainMenu.classList.add('hidden');
        customizerModal.classList.remove('hidden');
        isCustomizing = true;
    });
}

// Ensure music starts on ANY click in the menu
if (mainMenu) {
    mainMenu.addEventListener('click', () => initAudio(), { once: true });
}

document.querySelectorAll('.save-slot').forEach(slot => {
    slot.addEventListener('click', (e) => {
        if (e.target.classList.contains('slot-delete')) return;

        currentSaveSlot = parseInt(slot.dataset.slot);
        const data = getSaveData(currentSaveSlot);
        const isNewGame = !data;

        // Hide save slot modal immediately
        saveSlotsModal.classList.add('hidden');

        initAudio(); // Initialize audio on first click

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

            // FADE AUDIO STATES
            if (audioCtx) {
                if (menuMusic) menuMusic.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.5);
                if (musicPad) musicPad.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 3);
                if (ambientWind) ambientWind.gain.gain.linearRampToValueAtTime(0.02, audioCtx.currentTime + 3);
            }

            // After cinematic/intro, switch from Pad to Adventure music
            setTimeout(() => {
                if (audioCtx) {
                    if (musicPad) musicPad.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 2);
                    if (adventureMusic) adventureMusic.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 4);
                }
            }, 6000);

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

const deadParts = [];
const activeDebris = [];

function spawnDebris(pos, color, count = 5) {
    const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const mat = new THREE.MeshStandardMaterial({ color });
    for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        mesh.position.x += (Math.random() - 0.5) * 0.5;
        mesh.position.y += (Math.random() - 0.5) * 0.5;
        mesh.position.z += (Math.random() - 0.5) * 0.5;
        scene.add(mesh);

        activeDebris.push({
            mesh,
            vel: new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 15, (Math.random() - 0.5) * 10),
            rot: new THREE.Vector3(Math.random() * 0.2, Math.random() * 0.2, Math.random() * 0.2),
            life: 3.0
        });
    }
}

function die() {
    if (state.isDead) return;
    state.isDead = true;
    state.health = 0;
    playSound('death');

    // Unlock mouse
    document.exitPointerLock();

    // Show Death Screen
    const deathScreen = document.getElementById('death-screen');
    deathScreen.classList.add('visible');

    // Fall apart logic: Detach limbs from player and add to world with physics
    const limbs = [
        player.userData.limbs.leftArm,
        player.userData.limbs.rightArm,
        player.userData.limbs.leftLeg,
        player.userData.limbs.rightLeg,
        head,
        torso,
        backpack
    ];

    limbs.forEach(limb => {
        if (!limb) return;

        // Get world position before detaching
        const worldPos = new THREE.Vector3();
        limb.getWorldPosition(worldPos);
        const worldQuat = new THREE.Quaternion();
        limb.getWorldQuaternion(worldQuat);

        // Detach
        scene.attach(limb);

        // Add to tracking for gravity
        deadParts.push({
            mesh: limb,
            vel: new THREE.Vector3(
                (Math.random() - 0.5) * 5,
                5 + Math.random() * 5,
                (Math.random() - 0.5) * 5
            ),
            rotVel: new THREE.Vector3(
                Math.random() * 0.2,
                Math.random() * 0.2,
                Math.random() * 0.2
            )
        });
    });

    // Respawn Countdown
    let countdown = 5;
    const timerEl = document.getElementById('respawn-timer');
    const interval = setInterval(() => {
        countdown--;
        if (timerEl) timerEl.textContent = `Respawning in ${countdown}s`;
        if (countdown <= 0) {
            clearInterval(interval);
            respawn();
        }
    }, 1000);
}

function respawn() {
    // Reset stats
    state.health = 100;
    state.hunger = 100;
    state.oxygen = 100;
    state.isDead = false;
    state.velY = 0;

    // Teleport to middle (safe terrain height)
    const safeH = getMeshHeight(0, 80) + 2;
    state.pos.set(0, safeH, 80);
    player.position.copy(state.pos);

    // Clear dead parts tracking so they stop moving
    deadParts.length = 0;

    // Reattach parts & Reset visibility
    const limbs = player.userData.limbs;
    const parts = [
        { m: limbs.leftArm, p: [-0.5, 1.45, 0] },
        { m: limbs.rightArm, p: [0.5, 1.45, 0] },
        { m: limbs.leftLeg, p: [-0.2, 0.9, 0] },
        { m: limbs.rightLeg, p: [0.2, 0.9, 0] },
        { m: head, p: [0, 1.75, 0] },
        { m: torso, p: [0, 1.0, 0] },
        { m: backpack, p: [0, 1.1, -0.35] }
    ];

    parts.forEach(d => {
        if (d.m) {
            player.add(d.m);
            d.m.position.set(...d.p);
            d.m.rotation.set(0, 0, 0);
            d.m.visible = true;
        }
    });

    // Reset held item
    updateHeldItem();

    // Hide screen
    const deathScreen = document.getElementById('death-screen');
    if (deathScreen) deathScreen.classList.remove('visible');
    const timerEl = document.getElementById('respawn-timer');
    if (timerEl) timerEl.textContent = `Respawning in 5s`;

    // Re-lock mouse
    setTimeout(() => {
        if (gameStarted && !isPaused) renderer.domElement.requestPointerLock();
    }, 500);
}

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

    // Return to Menu Music — cancel any pending scheduled audio events first,
    // then ramp everything to the correct target values.
    if (audioCtx) {
        const now = audioCtx.currentTime;

        // Silence ambient wind immediately (cancel queued setTargetAtTime events)
        if (ambientWind) {
            ambientWind.gain.gain.cancelScheduledValues(now);
            ambientWind.gain.gain.setValueAtTime(ambientWind.gain.gain.value, now);
            ambientWind.gain.gain.linearRampToValueAtTime(0, now + 0.3);
        }

        // Fade out in-game music
        if (musicPad) { musicPad.gain.cancelScheduledValues(now); musicPad.gain.setValueAtTime(musicPad.gain.value, now); musicPad.gain.linearRampToValueAtTime(0, now + 1); }
        if (adventureMusic) { adventureMusic.gain.cancelScheduledValues(now); adventureMusic.gain.setValueAtTime(adventureMusic.gain.value, now); adventureMusic.gain.linearRampToValueAtTime(0, now + 1); }

        // Fade menu music back in
        if (menuMusic) { menuMusic.gain.cancelScheduledValues(now); menuMusic.gain.setValueAtTime(menuMusic.gain.value, now); menuMusic.gain.linearRampToValueAtTime(0.2, now + 1.5); }
    }
});

document.getElementById('resume-button')?.addEventListener('click', () => {
    isPaused = false;
    ingamePauseModal.classList.add('hidden');
    renderer.domElement.requestPointerLock();
});

// --- OPTIONS MENU LOGIC ---
const optionsBtn = document.getElementById('options-button');
const optionsModal = document.getElementById('options-modal');
const closeOptionsBtn = document.getElementById('close-options-btn');
const musicToggleBtn = document.getElementById('music-toggle-btn');
const optionsControlsBtn = document.getElementById('options-controls-btn');

optionsBtn?.addEventListener('click', () => {
    ingamePauseModal.classList.add('hidden');
    optionsModal.classList.remove('hidden');
});

closeOptionsBtn?.addEventListener('click', () => {
    optionsModal.classList.add('hidden');
    ingamePauseModal.classList.remove('hidden');
});

optionsControlsBtn?.addEventListener('click', () => { pendingBinds = {...currentBinds}; renderControls();
    optionsModal.classList.add('hidden');
    controlsModal.classList.remove('hidden');
});

musicToggleBtn?.addEventListener('click', () => {
    state.settings.musicEnabled = !state.settings.musicEnabled;
    const on = state.settings.musicEnabled;
    musicToggleBtn.textContent = on ? 'ON' : 'OFF';
    musicToggleBtn.className = 'toggle-btn ' + (on ? 'on' : 'off');

    if (masterMusicGain) {
        masterMusicGain.gain.setTargetAtTime(on ? 1.0 : 0.0, audioCtx.currentTime, 0.2);
    }
});

const invertYBtn = document.getElementById('invert-y-btn');
if (invertYBtn) {
    const updateInvertUI = () => {
        const on = state.settings.invertY;
        invertYBtn.textContent = on ? 'ON' : 'OFF';
        invertYBtn.className = 'toggle-btn ' + (on ? 'on' : 'off');
    };
    updateInvertUI();

    invertYBtn.addEventListener('click', () => {
        state.settings.invertY = !state.settings.invertY;
        localStorage.setItem('eldoria_invert_y', state.settings.invertY);
        updateInvertUI();
    });
}

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
            <div class='hint-box'><strong>📜 Active Quests</strong>Villagers will now offer formal quests — from gathering resources to hunting dangerous creatures. Completing these tasks yields valuable rewards and experience.</div>
            <span class='page-num'>— XII —</span>`,
    },
    {
        left: `<h2>The Capital City</h2>
            <p>At the center of Eldoria stands the magnificent Capital City. Its towering spires and thick walls have withstood the Cataclysm. Within its safety, you will find skilled tradesmen, a holy church, and a grand castle.</p>
            <p>The streets are paved with stone, a testament to the old world's architectural prowess.</p>
            <span class='page-num'>— XIII —</span>`,
        right: `<h2>The City Merchant</h2>
            <p>In the heart of the Capital, a travelling Merchant has set up his stall. He deals in rare and exotic goods.</p>
            <div class='hint-box'><strong>💰 Trade</strong>Bring the Merchant 10 Meat and 5 Hide, and he will trade you a Dark Essence — an invaluable resource that is otherwise only obtained by slaying Shadow Wolves in the Magic Forest.</div>
            <span class='page-num'>— XIV —</span>`,
    }
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
document.getElementById('color-shoe')?.addEventListener('input', (e) => shoeMat.color.set(e.target.value));
document.getElementById('color-eyes')?.addEventListener('input', (e) => {
    if (document.getElementById('select-eyes').value === 'default') {
        eyeMat.color.set(e.target.value);
    }
});
document.getElementById('color-accessory')?.addEventListener('input', (e) => accessoryMat.color.set(e.target.value));
document.getElementById('select-hair')?.addEventListener('change', (e) => updateHair(e.target.value));
document.getElementById('select-beard')?.addEventListener('change', (e) => updateBeard(e.target.value));
document.getElementById('select-eyes')?.addEventListener('change', (e) => updateEyes(e.target.value));
document.getElementById('select-scar')?.addEventListener('change', (e) => updateScars(e.target.value));
document.getElementById('select-accessory')?.addEventListener('change', (e) => updateAccessory(e.target.value));

// Character Creator Tabs
document.querySelectorAll('.custom-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.custom-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.getAttribute('data-tab');
        document.querySelectorAll('.custom-tab-content').forEach(content => {
            if (content.id === target) content.classList.remove('hidden');
            else content.classList.add('hidden');
        });
    });
});

// --- CONTROLS ---

// --- DYNAMIC CONTROLS ---
const defaultBinds = {
    forward: 'KeyW',
    backward: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    sprint: 'ShiftLeft',
    jump: 'Space',
    inventory: 'KeyB',
    interact: 'KeyE'
};

const bindsDescriptions = {
    forward: 'Move Forward',
    backward: 'Move Backward',
    left: 'Strafe Left',
    right: 'Strafe Right',
    sprint: 'Sprint / Dismount Horse',
    jump: 'Jump',
    inventory: 'Open/Close Backpack',
    interact: 'Talk / Doors / Chests / Mount'
};

let currentBinds = JSON.parse(localStorage.getItem('eldoria_binds')) || {...defaultBinds};
let pendingBinds = {...currentBinds};
let listeningKey = null;

function renderControls() {
    const list = document.getElementById('controls-list');
    if (!list) return;
    list.innerHTML = '';
    for (const action in bindsDescriptions) {
        const row = document.createElement('div');
        row.className = 'control-row';
        
        const desc = document.createElement('span');
        desc.className = 'control-desc';
        desc.textContent = bindsDescriptions[action];
        
        const btn = document.createElement('button');
        btn.className = 'control-btn';
        let keyName = pendingBinds[action].replace('Key', '').replace('Left', ' Left').replace('Right', ' Right');
        btn.textContent = keyName;
        
        btn.onclick = () => {
            if (listeningKey) return;
            listeningKey = action;
            btn.classList.add('listening');
            btn.textContent = 'PRESS ANY KEY...';
        };
        
        row.appendChild(desc);
        row.appendChild(btn);
        list.appendChild(row);
    }
}

document.getElementById('reset-controls-btn')?.addEventListener('click', () => {
    pendingBinds = {...defaultBinds};
    renderControls();
});

document.getElementById('save-controls-btn')?.addEventListener('click', () => {
    currentBinds = {...pendingBinds};
    localStorage.setItem('eldoria_binds', JSON.stringify(currentBinds));
    document.getElementById('controls-modal').classList.add('hidden');
    if (typeof gameStarted !== 'undefined' && gameStarted) {
        document.getElementById('options-modal').classList.remove('hidden');
    } else {
        document.getElementById('main-menu').classList.remove('hidden');
    }
    listeningKey = null;
});

const keys = {};
window.addEventListener('keydown', e => {
    if (listeningKey) {
        if (e.code !== 'Escape') {
            pendingBinds[listeningKey] = e.code;
        }
        listeningKey = null;
        renderControls();
        e.preventDefault();
        return;
    }
    keys[e.code] = true;
});
window.addEventListener('keyup', e => keys[e.code] = false);


let yaw = 0;
let pitch = 0;
let mouseX = 0;
let mouseY = 0;
let isDraggingCustomizer = false;

document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    if (document.pointerLockElement === renderer.domElement) {
        yaw -= e.movementX * 0.003;
        const inv = state.settings.invertY ? 1 : -1;
        pitch = THREE.MathUtils.clamp(pitch + e.movementY * inv * 0.003, -1.5, 1.5);
    } else if (isCustomizing && isDraggingCustomizer) {
        // Rotate player when dragging in customization screen
        player.rotation.y += e.movementX * 0.01;
    }
});

document.addEventListener('mousedown', (e) => {
    // Only drag if left click and not clicking on the UI panel
    if (isCustomizing && e.button === 0 && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && !e.target.closest('.customizer-panel')) {
        isDraggingCustomizer = true;
    }
});

document.addEventListener('mouseup', () => {
    isDraggingCustomizer = false;
});

// --- INVENTORY TABS ---
document.querySelectorAll('.inv-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent locking pointer
        document.querySelectorAll('.inv-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const target = tab.getAttribute('data-tab');
        document.querySelectorAll('.tab-content').forEach(content => {
            if (content.id === target) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });
    });
});

// Click canvas to re-acquire pointer lock while in game
document.addEventListener('click', (e) => {
    // Only lock if we aren't clicking an inventory UI element
    if (gameStarted && !isPaused && !isInventoryOpen && document.pointerLockElement !== renderer.domElement && !e.target.closest('.equip-slot') && !e.target.closest('.tab-content') && !e.target.closest('.inv-tab')) {
        renderer.domElement.requestPointerLock();
    }
});

// ESC and B keys
window.addEventListener('keydown', (e) => {
    if (e.code === currentBinds.inventory && gameStarted && !isPaused) {
        isInventoryOpen = !isInventoryOpen;
        const inventoryEl = document.getElementById('inventory');
        if (isInventoryOpen) {
            inventoryEl.classList.remove('hidden');
            document.exitPointerLock();

            updateInventoryUI();
            updateCraftingUI();

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

    // E key — interact with NPC or mount horse
    if (e.code === currentBinds.interact && gameStarted && !isPaused && !isInventoryOpen) {
        if (dialogOpen) {
            // Close dialog
            dialogOpen = false;
            dialogBox.classList.add('hidden');
            renderer.domElement.requestPointerLock();
        } else if (state.mounted) {
            // Dismount horse with E as well
            const horseEnt = state.mounted;
            state.mounted = null;
            spawnResourcePop(state.pos, '🐴 Dismounted');
            horseEnt.pos.x += Math.sin(yaw + Math.PI / 2) * 3;
            horseEnt.pos.z += Math.cos(yaw + Math.PI / 2) * 3;
            horseEnt.mesh.position.copy(horseEnt.pos);
        } else {
            let hitInteractable = false;
            // First try to raycast for doors/chests
            const dir = new THREE.Vector3(0, 0, -1);
            dir.applyQuaternion(camera.quaternion);
            const interactRay = new THREE.Raycaster(camera.getWorldPosition(new THREE.Vector3()), dir, 0, 15);
            const hits = interactRay.intersectObjects(worldGroup.children, true);
            if (hits.length > 0) {
                let obj = hits[0].object;
                while(obj && !obj.userData.interactable && obj.parent) {
                    if (obj.userData.interactable) break;
                    obj = obj.parent;
                }
                if (obj && obj.userData.interactable) {
                    hitInteractable = true;
                    if (obj.userData.isDoor) {
                        // Rotate door
                        if (!obj.userData.isOpen) {
                            obj.rotation.y += Math.PI / 2;
                            obj.userData.isOpen = true;
                            playSound('hit_wood', 0.5);
                        } else {
                            obj.rotation.y -= Math.PI / 2;
                            obj.userData.isOpen = false;
                            playSound('hit_wood', 0.4);
                        }
                    } else if (obj.userData.isChest) {
                        if (!obj.userData.isOpen) {
                            obj.userData.isOpen = true;
                            obj.userData.lid.rotation.x = -Math.PI / 2.5; // Open lid upwards
                            playSound('hit_wood', 0.8);
                            // Give loot
                            state.inventory.wood = (state.inventory.wood || 0) + 5;
                            state.inventory.stone = (state.inventory.stone || 0) + 2;
                            state.inventory.carrot = (state.inventory.carrot || 0) + 1;
                            spawnResourcePop(state.pos, '💰 Found Loot!');
                            updateInventoryUI();
                        }
                    }
                }
            }

            // If we didn't interact with an object, check for horse/villager
            if (!hitInteractable) {
                // Check for nearby tamed horse to mount
                let nearHorse = null;
                let nearHorseDist = 6;
                for (const ent of activeEntities) {
                    if (ent.type === 'horse' && ent.mesh.userData.isTamed) {
                        const d = ent.pos.distanceTo(state.pos);
                        if (d < nearHorseDist) {
                            nearHorseDist = d;
                            nearHorse = ent;
                        }
                    }
                }
                
                if (nearHorse) {
                    state.mounted = nearHorse;
                    spawnResourcePop(state.pos, '🐴 Mounted! Hold Shift to dismount');
                } else if (nearVillager) {
                    if (nearVillager.mesh.userData.isMerchant) {
                        // Merchant special trade
                        if (state.inventory.meat >= 10 && state.inventory.hide >= 5) {
                            state.inventory.meat -= 10;
                            state.inventory.hide -= 5;
                            state.inventory.dark_essence = (state.inventory.dark_essence || 0) + 1;
                            updateInventoryUI();
                            playSound('click', 1.0);
                            spawnResourcePop(state.pos, '💰 Traded Meat & Hide for 1 Dark Essence!');
                            dialogText.textContent = "A fine trade! This dark essence is rare indeed.";
                        } else {
                            dialogText.textContent = "Bring me 10 Meat and 5 Hide, and I'll give you something special...";
                        }
                    } else {
                        // Quests System Integration
                        let qId = state.quests.activeId;
                        
                        // If no active quest and the first quest isn't completed, offer it
                        if (!qId && !state.quests.completed.includes('gather_wood')) {
                            qId = 'gather_wood';
                            state.quests.activeId = qId; // Auto-accept for simplicity
                            dialogText.innerHTML = `<strong>[Quest Started]</strong><br>${QUESTS[qId].text_offer}`;
                            spawnResourcePop(state.pos, '📜 New Quest: ' + QUESTS[qId].title);
                        } else if (qId) {
                            const qData = QUESTS[qId];
                            let hasReqs = true;
                            for (const item in qData.req) {
                                if ((state.inventory[item] || 0) < qData.req[item]) {
                                    hasReqs = false;
                                    break;
                                }
                            }

                            if (hasReqs) {
                                // Complete quest
                                for (const item in qData.req) {
                                    state.inventory[item] -= qData.req[item];
                                }
                                // Give rewards
                                if (qData.reward.xp) addXp(qData.reward.xp);
                                for (const item in qData.reward) {
                                    if (item !== 'xp') {
                                        state.inventory[item] = (state.inventory[item] || 0) + qData.reward[item];
                                    }
                                }
                                
                                state.quests.completed.push(qId);
                                state.quests.activeId = qData.nextId; // Immediately queue next if exists, or null
                                
                                dialogText.innerHTML = `<strong>[Quest Completed]</strong><br>${qData.text_complete}`;
                                playSound('magic', 1.0);
                                spawnResourcePop(state.pos, '✅ Quest Complete: ' + qData.title);
                                updateInventoryUI();
                                
                                if (state.quests.activeId) {
                                    setTimeout(() => {
                                        spawnResourcePop(state.pos, '📜 New Quest available!');
                                    }, 2000);
                                }
                            } else {
                                // Progress text
                                dialogText.innerHTML = `<strong>[Quest: ${qData.title}]</strong><br>${qData.text_progress}`;
                            }
                        } else {
                            // Standard dialogue if all quests done
                            const line = VILLAGER_LINES[Math.floor(Math.random() * VILLAGER_LINES.length)];
                            dialogText.textContent = line;
                        }
                    }
                    dialogOpen = true;
                    dialogBox.classList.remove('hidden');
                    document.exitPointerLock();
                }
            }
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



const SHARED_MATS = {
    pineTrunk: new THREE.MeshStandardMaterial({ color: 0x3e2723 }),
    pineLeaves: new THREE.MeshStandardMaterial({ color: 0x1b5e20, flatShading: true }),
    fantasyTrunk: new THREE.MeshStandardMaterial({ color: 0x1a237e }),
    fantasyPink: new THREE.MeshStandardMaterial({ color: 0xff4081, emissive: 0xff4081, emissiveIntensity: 0.4, flatShading: true }),
    fantasyCyan: new THREE.MeshStandardMaterial({ color: 0x18ffff, emissive: 0x18ffff, emissiveIntensity: 0.4, flatShading: true }),
    goldenTrunk: new THREE.MeshStandardMaterial({ color: 0x4e342e }),
    goldenLeaves: new THREE.MeshStandardMaterial({ color: 0xffa000, flatShading: true }),
    oakTrunk: new THREE.MeshStandardMaterial({ color: 0x3e2723 }),
    oakLeaves: new THREE.MeshStandardMaterial({ color: 0x2e7d32, flatShading: true }),
    birchTrunk: new THREE.MeshStandardMaterial({ color: 0xe0e0e0 }),
    birchLeaves: new THREE.MeshStandardMaterial({ color: 0x558b2f, flatShading: true }),
    grassLush: new THREE.MeshStandardMaterial({ color: 0x4caf50, side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 }),
    grassMagic: new THREE.MeshStandardMaterial({ color: 0x9c27b0, side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 }),
    grassGolden: new THREE.MeshStandardMaterial({ color: 0xffd54f, side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 })
};

const SHARED_GEOS = {
    pineTrunk: new THREE.CylinderGeometry(0.2, 0.4, 3, 5),
    pineCone0: new THREE.ConeGeometry(1.5, 2.5, 5),
    pineCone1: new THREE.ConeGeometry(1.2, 2.5, 5),
    pineCone2: new THREE.ConeGeometry(0.9, 2.5, 5),
    fantasyTrunk: new THREE.CylinderGeometry(0.15, 0.3, 4, 5),
    fantasyLeaves: new THREE.IcosahedronGeometry(2.2, 1),
    goldenTrunk: new THREE.CylinderGeometry(0.2, 0.4, 2.5, 5),
    goldenLeaves: new THREE.SphereGeometry(1.6, 7, 7),
    oakTrunk: new THREE.CylinderGeometry(0.3, 0.6, 2.5, 6),
    oakLeaves: new THREE.IcosahedronGeometry(2.0, 1),
    birchTrunk: new THREE.CylinderGeometry(0.15, 0.25, 3.5, 5),
    birchLeaves: new THREE.IcosahedronGeometry(1.2, 0),
    grassBlade: new THREE.PlaneGeometry(0.2, 0.8)
};

function createPineTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(SHARED_GEOS.pineTrunk, SHARED_MATS.pineTrunk);
    trunk.position.y = 1.5;
    trunk.castShadow = true;
    for (let i = 0; i < 3; i++) {
        const geo = i === 0 ? SHARED_GEOS.pineCone0 : (i === 1 ? SHARED_GEOS.pineCone1 : SHARED_GEOS.pineCone2);
        const leaves = new THREE.Mesh(geo, SHARED_MATS.pineLeaves);
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
    const trunk = new THREE.Mesh(SHARED_GEOS.fantasyTrunk, SHARED_MATS.fantasyTrunk);
    trunk.position.y = 2;
    trunk.rotation.z = Math.random() * 0.4 - 0.2;
    trunk.castShadow = true;

    const isPink = Math.random() > 0.5;
    const mat = isPink ? SHARED_MATS.fantasyPink : SHARED_MATS.fantasyCyan;

    const leaves = new THREE.Mesh(SHARED_GEOS.fantasyLeaves, mat);
    leaves.position.set(0, 4, 0);
    
    g.add(trunk, leaves);
    g.scale.set(4, 4, 4);
    return g;
}

function createGoldenTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(SHARED_GEOS.goldenTrunk, SHARED_MATS.goldenTrunk);
    trunk.position.y = 1.25;
    trunk.castShadow = true;
    const leaves = new THREE.Mesh(SHARED_GEOS.goldenLeaves, SHARED_MATS.goldenLeaves);
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
    rock.scale.set(1, 0.6 + Math.random() * 0.4, 1);
    rock.castShadow = true;
    return rock;
}

function createCarrotPatch() {
    const g = new THREE.Group();
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x5d3a1a, roughness: 1.0 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.9 });
    const carrotMat = new THREE.MeshStandardMaterial({ color: 0xff7043, roughness: 0.8 });
    // Tilled dirt mound
    const patch = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 1.5), dirtMat);
    patch.position.y = 0.1;
    g.add(patch);
    // Add 4 individual carrot plants
    const offsets = [[-0.8, -0.4], [-0.25, 0.3], [0.3, -0.35], [0.85, 0.35]];
    offsets.forEach(([ox, oz]) => {
        const stem = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), carrotMat);
        stem.position.set(ox, 0.35, oz);
        g.add(stem);
        const leaf1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.06), leafMat);
        leaf1.position.set(ox + 0.07, 0.58, oz);
        leaf1.rotation.z = 0.5;
        g.add(leaf1);
        const leaf2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.06), leafMat);
        leaf2.position.set(ox - 0.07, 0.58, oz);
        leaf2.rotation.z = -0.5;
        g.add(leaf2);
        const leaf3 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.06), leafMat);
        leaf3.position.set(ox, 0.62, oz + 0.06);
        leaf3.rotation.x = -0.4;
        g.add(leaf3);
    });
    g.userData.harvestType = 'carrot';
    g.userData.hp = 1;
    return g;
}

function createHorse(color = 0x8b6914) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 1.0 });
    const hoofMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 2.0), bodyMat);
    body.position.set(0, 1.8, 0);
    body.castShadow = true;
    g.add(body);

    // Neck
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 0.45), bodyMat);
    neck.position.set(0, 2.2, 0.85);
    neck.rotation.x = -0.4;
    neck.castShadow = true;
    g.add(neck);

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.4, 0.7), bodyMat);
    head.position.set(0, 2.65, 1.35);
    head.castShadow = true;
    g.add(head);

    // Snout
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.35), darkMat);
    snout.position.set(0, 2.5, 1.65);
    g.add(snout);

    // Eyes
    [-0.18, 0.18].forEach(ex => {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.06), eyeMat);
        eye.position.set(ex, 2.72, 1.2);
        g.add(eye);
    });

    // Ears
    const earGeo = new THREE.BoxGeometry(0.1, 0.2, 0.08);
    [-0.14, 0.14].forEach(ex => {
        const ear = new THREE.Mesh(earGeo, bodyMat);
        ear.position.set(ex, 2.9, 1.2);
        g.add(ear);
    });

    // Mane
    const mane = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.5), darkMat);
    mane.position.set(0, 2.45, 0.95);
    g.add(mane);

    // Tail
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.7, 0.12), darkMat);
    tail.position.set(0, 1.7, -1.0);
    tail.name = 'horseTail';
    g.add(tail);

    // Legs
    function makeLeg(xOff, zOff) {
        const grp = new THREE.Group();
        const upper = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.7, 0.28), bodyMat);
        upper.position.y = -0.35;
        upper.castShadow = true;
        grp.add(upper);
        const lower = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), darkMat);
        lower.position.y = -0.95;
        lower.castShadow = true;
        grp.add(lower);
        const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.15, 0.25), hoofMat);
        hoof.position.y = -1.28;
        grp.add(hoof);
        grp.position.set(xOff, 1.3, zOff);
        return grp;
    }
    const flLeg = makeLeg(-0.3, 0.7);
    const frLeg = makeLeg(0.3, 0.7);
    const blLeg = makeLeg(-0.3, -0.7);
    const brLeg = makeLeg(0.3, -0.7);
    g.add(flLeg, frLeg, blLeg, brLeg);
    g.userData.limbs = { fl: flLeg, fr: frLeg, bl: blLeg, br: brLeg };

    g.userData.hp = 80;
    g.userData.maxHp = 80;
    g.userData.isTamed = false;
    g.userData.isHorse = true;
    return g;
}

function createCrystal() {
    const h = 2 + Math.random() * 4;
    const crystal = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.8, h, 6), new THREE.MeshStandardMaterial({
        color: 0x80d8ff, emissive: 0x00b0ff, emissiveIntensity: 0.5, transparent: true, opacity: 0.8, flatShading: true
    }));
    crystal.position.y = h / 2;
    crystal.rotation.set((Math.random() - 0.5) * 0.2, Math.random(), (Math.random() - 0.5) * 0.2);
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
        top.rotation.set((Math.random() - 0.5) * 0.3, Math.random(), (Math.random() - 0.5) * 0.3);
        top.castShadow = true;
        g.add(top);
    }
    g.add(col);
    return g;
}

function createPickaxe(type = 'stone') {
    const g = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
    const headMat = type === 'stone' ?
        new THREE.MeshStandardMaterial({ color: 0x90a4ae, metalness: 0.3, roughness: 0.7 }) :
        new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 });

    // Handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), woodMat);
    handle.position.y = 0.5;
    g.add(handle);

    // Pickaxe Head (Blocky Voxel style)
    const headGroup = new THREE.Group();
    headGroup.position.y = 0.9;

    const center = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), headMat);
    headGroup.add(center);

    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.1), headMat);
    leftArm.position.set(-0.15, 0, 0);
    headGroup.add(leftArm);

    const leftDrop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.1), headMat);
    leftDrop.position.set(-0.25, -0.05, 0);
    headGroup.add(leftDrop);

    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.1), headMat);
    rightArm.position.set(0.15, 0, 0);
    headGroup.add(rightArm);

    const rightDrop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.1), headMat);
    rightDrop.position.set(0.25, -0.05, 0);
    headGroup.add(rightDrop);

    g.add(headGroup);

    // Rotate so handle points forward, and head points vertical
    g.rotation.set(Math.PI / 2 - 0.4, 0, 0); // Point handle forward (-Z) and tilt up
    g.rotateY(-Math.PI / 2); // Roll so the head points up and down

    return g;
}

function createSword(type = 'stone') {
    const g = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3e2723 });
    const bladeMat = type === 'stone' ?
        new THREE.MeshStandardMaterial({ color: 0x90a4ae, metalness: 0.5, roughness: 0.5 }) :
        new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.8 }); // Distinct lighter brown

    // Handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), woodMat);
    handle.position.y = 0.15;
    g.add(handle);

    // Crossguard
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.1), woodMat);
    guard.position.y = 0.3;
    g.add(guard);

    // Blade Base
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.04), bladeMat);
    blade.position.y = 0.65;
    g.add(blade);
    
    // Blade Tip (wedge)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.15, 4), bladeMat);
    tip.position.y = 1.075;
    tip.rotation.y = Math.PI / 4;
    g.add(tip);

    // Rotate so handle points forward, and edge points vertical
    g.rotation.set(Math.PI / 2 - 0.4, 0, 0); // Point handle forward (-Z) and tilt up
    g.rotateY(-Math.PI / 2); // Roll so the edge points up and down

    return g;
}

function createFish() {
    const g = new THREE.Group();
    const bodyColor = new THREE.Color().setHSL(Math.random(), 0.7, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color: bodyColor });

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.6), mat);
    body.rotation.x = Math.PI / 2;
    g.add(body);

    // Tail
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.3), mat);
    tail.position.z = 0.4;
    tail.name = "tail";
    g.add(tail);

    // Fins
    const finGeo = new THREE.BoxGeometry(0.4, 0.05, 0.2);
    const leftFin = new THREE.Mesh(finGeo, mat);
    leftFin.position.set(-0.2, 0, 0);
    g.add(leftFin);
    const rightFin = new THREE.Mesh(finGeo, mat);
    rightFin.position.set(0.2, 0, 0);
    g.add(rightFin);

    return g;
}

function spawnFish(x, z) {
    const mesh = createFish();
    mesh.position.set(x, WATER_LEVEL - 1 - Math.random() * 2, z);
    scene.add(mesh);

    const ent = {
        type: 'fish',
        mesh,
        pos: mesh.position, // Link to mesh position for distance checks
        vel: new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2),
        hp: 1,
        harvestType: 'fish',
        update: function (dt) {
            // Wiggle tail
            const tail = mesh.getObjectByName('tail');
            if (tail) tail.rotation.y = Math.sin(performance.now() * 0.01) * 0.5;

            // Swim
            mesh.position.add(this.vel.clone().multiplyScalar(dt));
            mesh.lookAt(mesh.position.clone().add(this.vel));

            // Stay in water
            if (mesh.position.y > WATER_LEVEL - 0.5) this.vel.y = -1;
            if (mesh.position.y < WATER_LEVEL - 4) this.vel.y = 1;

            // Random turn
            if (Math.random() > 0.98) {
                this.vel.x += (Math.random() - 0.5) * 2;
                this.vel.z += (Math.random() - 0.5) * 2;
                this.vel.normalize().multiplyScalar(2);
            }
        }
    };
    activeEntities.push(ent);
}

// --- SETTLEMENTS & ARCHITECTURE ---
const houseMats = {
    plaster: new THREE.MeshStandardMaterial({ color: 0xd2ccbc, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.8 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x2c1f18, flatShading: true }),
    stone: new THREE.MeshStandardMaterial({ color: 0x6e7881 }), // Lighter stone for houses
    glass: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 }),
    door: new THREE.MeshStandardMaterial({ color: 0x24150d })
};

const castleMats = {
    stone: new THREE.MeshStandardMaterial({ color: 0x363a40, roughness: 0.9 }), // Dark imposing stone
    roof: new THREE.MeshStandardMaterial({ color: 0x1a1c1e, flatShading: true })
};

function createFunctionalDoor(width, height, depth, material) {
    const group = new THREE.Group();
    group.userData.interactable = true;
    group.userData.isDoor = true;
    group.userData.isOpen = false;
    
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(width / 2, height / 2, 0);
    group.add(mesh);
    
    return group;
}

function createChest() {
    const g = new THREE.Group();
    g.userData.interactable = true;
    g.userData.isChest = true;
    g.userData.isOpen = false;
    
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3d2314, roughness: 0.9 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.4 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 1.0, roughness: 0.2 });
    
    // Base wood
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.8), woodMat);
    base.position.y = 0.4;
    base.castShadow = true;
    g.add(base);
    
    // Base iron bands
    const bandGeo = new THREE.BoxGeometry(1.22, 0.1, 0.82);
    const bBand1 = new THREE.Mesh(bandGeo, ironMat);
    bBand1.position.y = 0.1;
    const bBand2 = new THREE.Mesh(bandGeo, ironMat);
    bBand2.position.y = 0.7;
    g.add(bBand1, bBand2);
    
    const vBandGeo = new THREE.BoxGeometry(0.1, 0.8, 0.82);
    const vBand1 = new THREE.Mesh(vBandGeo, ironMat);
    vBand1.position.set(-0.5, 0.4, 0);
    const vBand2 = new THREE.Mesh(vBandGeo, ironMat);
    vBand2.position.set(0.5, 0.4, 0);
    g.add(vBand1, vBand2);

    // Inner gold/loot (hidden until open, but we just place it inside)
    const loot = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.6), goldMat);
    loot.position.y = 0.4;
    g.add(loot);
    
    // Lid Group (Hinged at the back)
    const lidGroup = new THREE.Group();
    lidGroup.position.set(0, 0.8, -0.4); 
    
    // Lid wood (curved)
    const lidWood = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 8, 1, false, 0, Math.PI), woodMat);
    lidWood.rotation.z = Math.PI / 2;
    lidWood.position.set(0, 0, 0.4);
    lidWood.castShadow = true;
    lidGroup.add(lidWood);
    
    // Lid iron bands
    const lidBandGeo = new THREE.CylinderGeometry(0.41, 0.41, 0.1, 8, 1, false, 0, Math.PI);
    const lBand1 = new THREE.Mesh(lidBandGeo, ironMat);
    lBand1.rotation.z = Math.PI / 2;
    lBand1.position.set(-0.5, 0, 0.4);
    const lBand2 = new THREE.Mesh(lidBandGeo, ironMat);
    lBand2.rotation.z = Math.PI / 2;
    lBand2.position.set(0.5, 0, 0.4);
    lidGroup.add(lBand1, lBand2);
    
    // Gold Lock
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.1), goldMat);
    lock.position.set(0, 0, 0.85); // front of the lid
    lidGroup.add(lock);
    
    g.add(lidGroup);
    g.userData.lid = lidGroup;
    
    return g;
}

function createMedievalHouse() {
    const g = new THREE.Group();
    const isLarge = Math.random() > 0.5;
    const w = isLarge ? 8 : 6;
    const d = isLarge ? 8 : 6;
    
    // Foundation (Small Stone Base)
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), houseMats.stone);
    base.position.y = 0.25;
    g.add(base);

    // First floor (Plaster)
    const f1 = new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), houseMats.plaster);
    f1.position.y = 2.5; 
    f1.castShadow = true;
    f1.receiveShadow = true;
    g.add(f1);
    
    // Second floor (Plaster with wooden beams, slightly larger for overhang)
    const f2w = w + 1;
    const f2d = d + 1;
    const f2 = new THREE.Mesh(new THREE.BoxGeometry(f2w, 4, f2d), houseMats.plaster);
    f2.position.y = 6.5; 
    f2.castShadow = true;
    f2.receiveShadow = true;
    g.add(f2);
    
    // Wood Beams
    const beamThickness = 0.4;
    const trimMat = houseMats.wood;
    
    // Between floors trim
    const trim = new THREE.Mesh(new THREE.BoxGeometry(f2w + 0.2, beamThickness, f2d + 0.2), trimMat);
    trim.position.y = 4.5;
    g.add(trim);
    
    // Corner beams for second floor
    for(let dx of [-f2w/2, f2w/2]) {
        for(let dz of [-f2d/2, f2d/2]) {
            let beam = new THREE.Mesh(new THREE.BoxGeometry(beamThickness, 4, beamThickness), trimMat);
            beam.position.set(dx, 6.5, dz);
            g.add(beam);
        }
    }
    // Corner beams for first floor
    for(let dx of [-w/2, w/2]) {
        for(let dz of [-d/2, d/2]) {
            let beam = new THREE.Mesh(new THREE.BoxGeometry(beamThickness, 4, beamThickness), trimMat);
            beam.position.set(dx, 2.5, dz);
            g.add(beam);
        }
    }
    
    // Functional Door
    const door = createFunctionalDoor(1.5, 2.5, 0.2, houseMats.door);
    door.position.set(-0.75, 0.5, d/2 + 0.05);
    g.add(door);
    
    // Glowing Windows
    const winMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 0.8 });
    const winGeo = new THREE.BoxGeometry(1.2, 1.2, 0.2);
    const win1 = new THREE.Mesh(winGeo, winMat);
    win1.position.set(0, 6.5, f2d/2 + 0.05);
    g.add(win1);
    
    // Window borders
    const borderGeoH = new THREE.BoxGeometry(1.4, 0.15, 0.25);
    const borderGeoV = new THREE.BoxGeometry(0.15, 1.4, 0.25);
    const borderTop = new THREE.Mesh(borderGeoH, trimMat); borderTop.position.set(0, 7.15, f2d/2 + 0.05);
    const borderBot = new THREE.Mesh(borderGeoH, trimMat); borderBot.position.set(0, 5.85, f2d/2 + 0.05);
    const borderL = new THREE.Mesh(borderGeoV, trimMat); borderL.position.set(-0.65, 6.5, f2d/2 + 0.05);
    const borderR = new THREE.Mesh(borderGeoV, trimMat); borderR.position.set(0.65, 6.5, f2d/2 + 0.05);
    const crossH = new THREE.Mesh(borderGeoH, trimMat); crossH.position.set(0, 6.5, f2d/2 + 0.05);
    const crossV = new THREE.Mesh(borderGeoV, trimMat); crossV.position.set(0, 6.5, f2d/2 + 0.05);
    g.add(borderTop, borderBot, borderL, borderR, crossH, crossV);
    
    // Roof (Sloped High Pitch)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(f2w/Math.sqrt(2) + 1, 6, 4), houseMats.roof);
    roof.position.y = 8.5 + 3;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);

    // Chimney
    const chim = new THREE.Mesh(new THREE.BoxGeometry(1.5, 8, 1.5), houseMats.stone);
    chim.position.set(-w/2 + 1, 8.5, 0);
    g.add(chim);

    return g;
}

function createWindmill() {
    const g = new THREE.Group();
    const stoneMat = houseMats.stone;
    const woodMat = houseMats.wood;
    const roofMat = houseMats.roof;
    const clothMat = new THREE.MeshStandardMaterial({ color: 0xddddcc, side: THREE.DoubleSide });

    // Stone Base (Hexagonal)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 10, 6), stoneMat);
    base.position.y = 5;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);
    
    // Base detailing (wooden rings)
    const ring1 = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.5, 6), woodMat);
    ring1.position.y = 9.5;
    g.add(ring1);

    // Wooden Upper Body
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.5, 12, 6), woodMat);
    upper.position.y = 16;
    upper.castShadow = true;
    g.add(upper);
    
    // Upper detailing (balcony)
    const balconyGeo = new THREE.CylinderGeometry(6, 6, 0.5, 6);
    const balcony = new THREE.Mesh(balconyGeo, woodMat);
    balcony.position.y = 10;
    g.add(balcony);
    // Balcony fence
    for(let i=0; i<12; i++) {
        const a = (i/12) * Math.PI * 2;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), woodMat);
        post.position.set(Math.cos(a)*5.5, 10.75, Math.sin(a)*5.5);
        g.add(post);
    }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 0.2, 12), woodMat);
    rail.position.y = 11.5;
    g.add(rail);

    // Roof
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5, 8, 6), roofMat);
    roof.position.y = 26;
    g.add(roof);

    // Entrance Porch
    const porch = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 4), woodMat);
    porch.position.set(0, 2.5, 7.5);
    g.add(porch);
    const porchRoof = new THREE.Mesh(new THREE.ConeGeometry(3.5, 3, 4), roofMat);
    porchRoof.position.set(0, 6.5, 7.5);
    porchRoof.rotation.y = Math.PI / 4;
    g.add(porchRoof);

    // Functional Door
    const door = createFunctionalDoor(2.5, 4, 0.2, houseMats.door);
    door.position.set(-1.25, 0, 9.5);
    g.add(door);

    // Grain shed attached to the side
    const shed = new THREE.Mesh(new THREE.BoxGeometry(5, 6, 6), woodMat);
    shed.position.set(6, 3, 0);
    g.add(shed);
    const shedRoof = new THREE.Mesh(new THREE.ConeGeometry(4.5, 4, 4), roofMat);
    shedRoof.position.set(6, 8, 0);
    shedRoof.rotation.y = Math.PI / 4;
    g.add(shedRoof);

    // Sails Hub
    const hubGroup = new THREE.Group();
    hubGroup.position.set(0, 18, -5);
    g.add(hubGroup);

    const hub = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 2.5), woodMat);
    hubGroup.add(hub);

    // 4 Sails with cloth panels
    for (let i = 0; i < 4; i++) {
        const sailGroup = new THREE.Group();
        sailGroup.rotation.z = (Math.PI / 2) * i;
        
        // Main arm
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 16, 0.4), woodMat);
        arm.position.y = 8;
        sailGroup.add(arm);
        
        // Sail Cloth
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(3, 14), clothMat);
        cloth.position.set(1.7, 9, 0);
        sailGroup.add(cloth);
        
        // Crossbeams
        for(let j=0; j<6; j++) {
            const beam = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 0.2), woodMat);
            beam.position.set(1.6, 4 + j*2, 0.1);
            sailGroup.add(beam);
        }

        hubGroup.add(sailGroup);
    }
    
    // Light
    const light = new THREE.PointLight(0xffaa00, 1, 15);
    light.position.set(0, 5, 10);
    g.add(light);
    
    g.userData.isWindmill = true;
    g.userData.sail = hubGroup;
    
    return g;
}



function createRandomBuilding() {
    const r = Math.random();
    if (r < 0.20) return createBarn();
    if (r < 0.40) return createTavern();
    if (r < 0.60) return createWindmill();
    if (r < 0.80) return createBlacksmith();
    return createMedievalHouse();
}

function createBarn() {
    const g = new THREE.Group();
    const w = 10, d = 10;
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a2a18 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, 6, d), woodMat);
    base.position.y = 3;
    g.add(base);
    const roof = new THREE.Mesh(new THREE.ConeGeometry((w+1)/1.414, 5, 4), houseMats.roof);
    roof.position.y = 8.5;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    const doors = createFunctionalDoor(4, 4, 0.2, new THREE.MeshStandardMaterial({ color: 0x2e1a0f }));
    doors.position.set(-2, 0, d/2 + 0.05);
    g.add(doors);
    return g;
}

function createTavern() {
    const g = new THREE.Group();
    const w = 10, d = 10;
    const f1 = new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), houseMats.stone);
    f1.position.y = 2;
    g.add(f1);
    const f2 = new THREE.Mesh(new THREE.BoxGeometry(w+1, 4, d+1), houseMats.plaster);
    f2.position.y = 6;
    g.add(f2);
    const roof = new THREE.Mesh(new THREE.ConeGeometry((w+1)/1.414, 5, 4), houseMats.roof);
    roof.position.y = 10.5;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    
    // Sign
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 2), houseMats.wood);
    sign.position.set(w/2 + 0.5, 5, 0);
    g.add(sign);
    
    // Functional Door
    const door = createFunctionalDoor(2, 3, 0.2, houseMats.door);
    door.position.set(-1, 0, d/2 + 0.05);
    g.add(door);
    
    // Windows
    const winGeo = new THREE.BoxGeometry(1.2, 1.2, 0.2);
    const winMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 0.8 });
    for(let i = -1; i <= 1; i+=2) {
        let win = new THREE.Mesh(winGeo, winMat);
        win.position.set(i*2.5, 6, d/2 + 0.55);
        g.add(win);
    }
    return g;
}

function createCastleTower() {
    const g = new THREE.Group();
    const r = 3.5;
    const h = 20 + Math.random() * 10;

    // Dark stone tower
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r + 1, h, 8), castleMats.stone);
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
    const w = 4;
    
    if (hasGate) {
        // Create left and right wall segments
        const gap = 16;
        const sideLen = (length - gap) / 2;
        
        const leftWall = new THREE.Mesh(new THREE.BoxGeometry(sideLen, h, w), castleMats.stone);
        leftWall.position.set(-gap/2 - sideLen/2, h/2, 0);
        g.add(leftWall);
        
        const rightWall = new THREE.Mesh(new THREE.BoxGeometry(sideLen, h, w), castleMats.stone);
        rightWall.position.set(gap/2 + sideLen/2, h/2, 0);
        g.add(rightWall);
        
        // Massive Gatehouse Towers
        const towerW = 10, towerH = 25, towerD = 12;
        const leftTower = new THREE.Mesh(new THREE.BoxGeometry(towerW, towerH, towerD), castleMats.stone);
        leftTower.position.set(-gap/2 - 2, towerH/2, 2);
        g.add(leftTower);
        
        const rightTower = new THREE.Mesh(new THREE.BoxGeometry(towerW, towerH, towerD), castleMats.stone);
        rightTower.position.set(gap/2 + 2, towerH/2, 2);
        g.add(rightTower);

        // Gatehouse Roofs
        const roofGeo = new THREE.ConeGeometry(8, 12, 4);
        const leftRoof = new THREE.Mesh(roofGeo, castleMats.roof);
        leftRoof.position.set(-gap/2 - 2, towerH + 6, 2);
        leftRoof.rotation.y = Math.PI / 4;
        g.add(leftRoof);
        const rightRoof = new THREE.Mesh(roofGeo, castleMats.roof);
        rightRoof.position.set(gap/2 + 2, towerH + 6, 2);
        rightRoof.rotation.y = Math.PI / 4;
        g.add(rightRoof);

        // Arch over the gap
        const gateRoof = new THREE.Mesh(new THREE.BoxGeometry(gap + 6, 8, towerD), castleMats.stone);
        gateRoof.position.set(0, h + 2, 2);
        g.add(gateRoof);
        
        // Portcullis (Iron Grate)
        const grateMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, wireframe: true });
        const portcullis = new THREE.Mesh(new THREE.PlaneGeometry(gap, h - 2), grateMat);
        portcullis.position.set(0, h/2 - 1, 1);
        g.add(portcullis);

        // Massive wooden drawbridge (lowered)
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(gap, 0.5, 18), houseMats.wood);
        bridge.position.set(0, 0.25, 10);
        g.add(bridge);
        
        // Chains for drawbridge
        const chainGeo = new THREE.CylinderGeometry(0.1, 0.1, 16, 4);
        const chainMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 });
        const chain1 = new THREE.Mesh(chainGeo, chainMat);
        chain1.position.set(-gap/2 + 1, h/2 + 2, 8);
        chain1.rotation.x = Math.PI / 4;
        g.add(chain1);
        const chain2 = new THREE.Mesh(chainGeo, chainMat);
        chain2.position.set(gap/2 - 1, h/2 + 2, 8);
        chain2.rotation.x = Math.PI / 4;
        g.add(chain2);
        
        // Walkway battlements just for side walls
        const teethMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, flatShading: true });
        const numTeeth = Math.floor(sideLen / 3);
        for (let i = 0; i < numTeeth; i++) {
            // Left wall teeth
            const txl = -length/2 + 1.5 + (i * 3);
            const toothL = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2, 1), teethMat);
            toothL.position.set(txl, h + 1, w / 2 - 0.5);
            g.add(toothL);
            
            // Right wall teeth
            const txr = gap/2 + 1.5 + (i * 3);
            const toothR = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2, 1), teethMat);
            toothR.position.set(txr, h + 1, w / 2 - 0.5);
            g.add(toothR);
        }
        
        // Banners and glowing braziers on the towers
        const bannerGeo = new THREE.PlaneGeometry(3, 8);
        const bannerMat = new THREE.MeshStandardMaterial({ color: 0x8b0000, side: THREE.DoubleSide });
        const bL = new THREE.Mesh(bannerGeo, bannerMat); bL.position.set(-gap/2 - 2, towerH - 5, towerD/2 + 2.1);
        const bR = new THREE.Mesh(bannerGeo, bannerMat); bR.position.set(gap/2 + 2, towerH - 5, towerD/2 + 2.1);
        g.add(bL, bR);
        
        const fireMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff4400, emissiveIntensity: 2.0 });
        const fireL = new THREE.Mesh(new THREE.DodecahedronGeometry(1.5), fireMat); fireL.position.set(-gap/2 - 5, towerH + 1, towerD/2 - 1);
        const fireR = new THREE.Mesh(new THREE.DodecahedronGeometry(1.5), fireMat); fireR.position.set(gap/2 + 5, towerH + 1, towerD/2 - 1);
        g.add(fireL, fireR);

    } else {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(length, h, w), castleMats.stone);
        wall.position.y = h / 2;
        wall.castShadow = true;
        g.add(wall);

        // Walkway battlements
        const teethMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, flatShading: true });
        const numTeeth = Math.floor(length / 3);
        for (let i = 0; i < numTeeth; i++) {
            const tx = -length / 2 + 1.5 + (i * 3);
            const toothOuter = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2, 1), teethMat);
            toothOuter.position.set(tx, h + 1, w / 2 - 0.5);
            g.add(toothOuter);
        }
    }

    g.traverse(child => { if (child.isMesh) child.castShadow = true; });
    return g;
}

function createCastleKeep() {
    const g = new THREE.Group();
    
    // Base Tier
    const base = new THREE.Mesh(new THREE.BoxGeometry(40, 15, 40), castleMats.stone);
    base.position.y = 7.5;
    g.add(base);

    // Middle Tier
    const mid = new THREE.Mesh(new THREE.BoxGeometry(28, 20, 28), castleMats.stone);
    mid.position.y = 15 + 10;
    g.add(mid);
    
    // Top Tier (Tower)
    const top = new THREE.Mesh(new THREE.BoxGeometry(16, 25, 16), castleMats.stone);
    top.position.y = 35 + 12.5;
    g.add(top);

    // Battlements function
    function addBattlements(yPos, size) {
        const teethMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, flatShading: true });
        const num = Math.floor(size / 4);
        for(let i=0; i<num; i++) {
            const offset = -size/2 + 2 + (i*4);
            // front/back
            let t1 = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), teethMat);
            t1.position.set(offset, yPos + 1.5, size/2 - 1);
            let t2 = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), teethMat);
            t2.position.set(offset, yPos + 1.5, -size/2 + 1);
            // left/right
            let t3 = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), teethMat);
            t3.position.set(size/2 - 1, yPos + 1.5, offset);
            let t4 = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), teethMat);
            t4.position.set(-size/2 + 1, yPos + 1.5, offset);
            g.add(t1, t2, t3, t4);
        }
    }
    
    addBattlements(15, 40);
    addBattlements(35, 28);
    addBattlements(60, 16);
    
    // Grand Entrance Arch
    const arch = new THREE.Mesh(new THREE.BoxGeometry(8, 12, 4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    arch.position.set(0, 6, 20);
    g.add(arch);
    
    collisionGroup.add(g.clone()); // Add a copy to collision group for camera/interaction
    
    // Corner Turrets for Base Tier
    const tGeo = new THREE.CylinderGeometry(4, 4, 25, 8);
    const rGeo = new THREE.ConeGeometry(5, 8, 8);
    const offsets = [[-20, -20], [20, -20], [-20, 20], [20, 20]];
    offsets.forEach(p => {
        let t = new THREE.Mesh(tGeo, castleMats.stone);
        t.position.set(p[0], 12.5, p[1]);
        let r = new THREE.Mesh(rGeo, castleMats.roof);
        r.position.set(p[0], 25 + 4, p[1]);
        g.add(t, r);
        
        // Add flags to turrets
        if (Math.random() > 0.3) {
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 8, 4), new THREE.MeshStandardMaterial({ color: 0x3d2817 }));
            pole.position.set(p[0], 29 + 4, p[1]);
            g.add(pole);
            const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.5), new THREE.MeshStandardMaterial({ color: 0x8b0000, side: THREE.DoubleSide }));
            flag.position.set(p[0] + 2, 29 + 5, p[1]);
            g.add(flag);
        }
    });

    // Main flag on top
    const mainPole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 18, 4), new THREE.MeshStandardMaterial({ color: 0x3d2817 }));
    mainPole.position.set(0, 60 + 9, 0);
    g.add(mainPole);
    const mainFlag = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), new THREE.MeshStandardMaterial({ color: 0x8b0000, side: THREE.DoubleSide }));
    mainFlag.position.set(4, 60 + 13, 0);
    g.add(mainFlag);

    // Some decorative banners on the front
    const bannerGeo = new THREE.PlaneGeometry(3, 10);
    const bannerMat = new THREE.MeshStandardMaterial({ color: 0x8b0000, side: THREE.DoubleSide });
    for(let i = -1; i <= 1; i += 2) {
        const banner = new THREE.Mesh(bannerGeo, bannerMat);
        banner.position.set(i * 8, 14, 20 + 0.1);
        g.add(banner);
    }

    // Glowing windows on the middle tier
    const winGeo = new THREE.BoxGeometry(1.5, 3, 0.2);
    const winMat = new THREE.MeshStandardMaterial({ color: 0xffdd44, emissive: 0xffaa00, emissiveIntensity: 1.0 });
    for(let i = -1; i <= 1; i += 2) {
        const w1 = new THREE.Mesh(winGeo, winMat);
        w1.position.set(i * 8, 20, 14 + 0.1);
        const w2 = new THREE.Mesh(winGeo, winMat);
        w2.position.set(i * 8, 20, -14 - 0.1);
        const w3 = new THREE.Mesh(winGeo, winMat);
        w3.position.set(14 + 0.1, 20, i * 8);
        w3.rotation.y = Math.PI / 2;
        const w4 = new THREE.Mesh(winGeo, winMat);
        w4.position.set(-14 - 0.1, 20, i * 8);
        w4.rotation.y = Math.PI / 2;
        g.add(w1, w2, w3, w4);
    }

    g.traverse(child => { if (child.isMesh) child.castShadow = true; });
    return g;
}

// --- ENTITY AI SYSTEM ---
const activeEntities = [];
const activeCracks = [];
const activeDamageNumbers = [];
const activeCampfires = []; // Tracks placed campfire positions for Wendigo fear-of-light AI

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
        this.speed = type === 'villager' ? 4 : type === 'bear' ? 5 : type === 'golem' ? 3 : type === 'fox' ? 12 : type === 'rabbit' ? 10 : type === 'boar' ? 6 : 8;
        this.aggroRange = type === 'bear' ? 20 : type === 'wolf' ? 60 : type === 'boar' ? 30 : 0; // 0 = passive
        this.isAggro = false;
        this.showHealthTimer = 0;
        this.hpBarEl = null;

        this.pos.y = getTerrainHeight(this.pos.x, this.pos.z);
        this.mesh.position.copy(this.pos);
        worldGroup.add(this.mesh);
    }

    update(dt, playerPos, isLowFreq) {
        const dist = this.pos.distanceTo(playerPos);
        
        // Skip logic if this is a low-frequency update and we are far
        if (isLowFreq && dist > 100 && this.type !== 'dragon') return;

        this.timer -= dt;

        // --- WENDIGO TRANSFORMATION ---
        const isNight = dayTime > 0.6 && dayTime < 0.9;
        if (this.type === 'stag' && isNight) {
            if (!this.userData) this.userData = {};
            if (!this.userData.transforming) {
                this.userData.transforming = true;
                this.userData.transformTimer = 0;
                this.state = 'idle';
                playSound('wendigo_whistle', 0.8 + Math.random()*0.2, 1.0);
            }
        }
        
        if (this.userData?.transforming && this.type === 'stag') {
            this.userData.transformTimer += dt;
            const t = this.userData.transformTimer;
            
            this.mesh.rotation.z = Math.sin(t * 50) * 0.2;
            this.mesh.rotation.x = Math.cos(t * 40) * 0.2;
            this.mesh.position.y += Math.sin(t * 20) * 0.05;

            if (t > 1.5) {
                this.mesh.traverse(c => {
                    if (c.isMesh) {
                        c.material.color.setHex(0x111111);
                        if(c.material.emissive) {
                            c.material.emissive.setHex(0x330000);
                            c.material.emissiveIntensity = 1.0;
                        }
                    }
                });
                this.mesh.scale.set(1.4 + t*0.2, 1.4 + t*0.5, 1.4 + t*0.2);
            }
            
            if (t > 3.0) {
                worldGroup.remove(this.mesh);
                this.type = 'wendigo';
                this.speed = 13;
                this.aggroRange = 100;
                this.state = 'stalk';
                this.timer = 0;
                this.mesh = createWendigo();
                this.mesh.position.copy(this.pos);
                worldGroup.add(this.mesh);
                this.userData.transforming = false;
                spawnDamageNumber(this.pos.x, this.pos.y + 4, this.pos.z, "WENDIGO", false);
            }
            return;
        }

        // --- WENDIGO AI ---
        if (this.type === 'wendigo') {
            if (!isNight) {
                // Burn at dawn
                spawnDamageNumber(this.pos.x, this.pos.y + 2, this.pos.z, 999, false);
                worldGroup.remove(this.mesh);
                if (this.hpBarEl) this.hpBarEl.remove();
                activeEntities.splice(activeEntities.indexOf(this), 1);
                return;
            }
            
        // --- FEAR OF LIGHT: Flee from nearby campfires ---
        let nearestFireDist = Infinity;
        let nearestFirePos = null;
        for (const cf of activeCampfires) {
            const fd = this.pos.distanceTo(new THREE.Vector3(cf.x, this.pos.y, cf.z));
            if (fd < nearestFireDist) { nearestFireDist = fd; nearestFirePos = cf; }
        }
        if (nearestFirePos && nearestFireDist < 25) {
            // Flee away from the campfire
            const fleeDir = new THREE.Vector3().subVectors(this.pos, new THREE.Vector3(nearestFirePos.x, this.pos.y, nearestFirePos.z)).normalize();
            this.target.copy(this.pos).addScaledVector(fleeDir, 30);
            this.state = 'walking';
            this.speed = 16;
            if (Math.random() < 0.01) playSound('wendigo_whistle', 0.6, 1.2);
            this.animateLimbs();
            this._moveToTarget(dt);
            return;
        }

        this.target.copy(playerPos);
        // Stalking behavior
        if (dist > 40 && dist < 120) {
            this.state = 'walking';
            this.speed = 4; // stalk slowly
            if (Math.random() < 0.005) playSound('wendigo_whistle', 0.8 + Math.random()*0.4, 0.8);
        } else if (dist <= 40) {
            // Aggressive charge
            this.state = 'walking';
            this.speed = 14; // extremely fast
            if (Math.random() < 0.02) playSound('bear', 0.5, 1.0); // terrifying roar
            
            if (dist < 5) {
                if (this.timer <= 0) {
                    state.health = Math.max(0, state.health - 30);
                    spawnDamageNumber(playerPos.x, playerPos.y + 1.5, playerPos.z, 30, false);
                    this.timer = 1.5;
                    playSound('wolf', 0.6, 1.0);
                }
            }
        }
        this.animateLimbs();
        this._moveToTarget(dt);
        return;
    }

        // --- HORSE AI ---
        if (this.type === 'horse') {
            // If mounted, skip AI entirely — player controls it
            if (state.mounted === this) return;

            // If tamed, just stand near player (follow loosely)
            if (this.mesh.userData.isTamed) {
                const distToPlayer = this.pos.distanceTo(playerPos);
                if (distToPlayer > 15) {
                    this.target.copy(playerPos);
                    this.state = 'walking';
                    this.speed = 8;
                    this.animateLimbs();
                    this._moveToTarget(dt);
                } else {
                    this.state = 'idle';
                    this.animateLimbs();
                }
                return;
            }

            // Wild horse: flee if player is close
            const distToPlayer = this.pos.distanceTo(playerPos);
            if (distToPlayer < 20) {
                // Flee direction: away from player
                const fleeDir = new THREE.Vector3().subVectors(this.pos, playerPos).normalize();
                this.target.copy(this.pos).addScaledVector(fleeDir, 40);
                this.state = 'walking';
                this.speed = 14;
                this.animateLimbs();
                this._moveToTarget(dt);
                return;
            }
        }

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
                        playSound('wolf', 1.0, 1.0);
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
                        playSound('bear', 1.0, 1.2);
                    }
                }
                if (distToPlayer > 50) this.isAggro = false; // give up chase
                this.animateLimbs();
                this._moveToTarget(dt);
                return;
            }
        }

        // --- KNIGHT PROTECTOR AI ---
        if (this.type === 'knight' && this.mesh.userData.hp > 0) {
            let nearestHostile = null;
            let minDist = 120; // Aggro range for knights to protect castle

            for (const ent of activeEntities) {
                if (ent.mesh.userData && ent.mesh.userData.hp <= 0) continue;
                if (ent.type === 'wolf' || ent.type === 'bear' || (ent.type === 'stag' && ent.userData?.transforming)) {
                    const d = this.pos.distanceTo(ent.pos);
                    if (d < minDist) {
                        minDist = d;
                        nearestHostile = ent;
                    }
                }
            }

            if (nearestHostile) {
                this.target.copy(nearestHostile.pos);
                this.state = 'walking';
                this.speed = 12; // Knights run fast to protect
                
                if (minDist < 6) { // Attack range
                    if (this.timer <= 0) {
                        nearestHostile.mesh.userData.hp -= 35; // Knights deal 35 dmg
                        spawnDamageNumber(nearestHostile.pos.x, nearestHostile.pos.y + 2, nearestHostile.pos.z, 35, false);
                        playSound('hit_wood', 0.5, 2.0); // "Thwack" sound for sword/axe hit
                        if (nearestHostile.mesh.userData.hp <= 0) {
                            spawnResourcePop(nearestHostile.pos, "Enemy Slain by Knight!");
                        }
                        this.timer = 1.0; // attack cooldown
                    }
                }
                this.animateLimbs();
                this._moveToTarget(dt);
                return;
            }
        }

        // --- GOLEM RETALIATION AI (only attacks if attacked) ---
        if (this.type === 'golem' && this.mesh.userData.hp > 0) {
            if (this.isAggro) {
                const distToPlayer = this.pos.distanceTo(playerPos);
                
                // If currently attacking, run the attack animation
                if (this.attackTimer > 0) {
                    this.attackTimer -= dt;
                    const limbs = this.mesh.userData.limbs;
                    if (this.attackTimer > 0.5) {
                        // Phase 1: Raise arms
                        if (limbs) {
                            limbs.la.rotation.x = Math.max(limbs.la.rotation.x - dt * 4, -Math.PI + 0.5);
                            limbs.ra.rotation.x = Math.max(limbs.ra.rotation.x - dt * 4, -Math.PI + 0.5);
                        }
                    } else if (this.attackTimer > 0) {
                        // Phase 2: Smash down (instant jump to ground)
                        if (limbs) {
                            limbs.la.rotation.x = Math.PI / 4;
                            limbs.ra.rotation.x = Math.PI / 4;
                        }
                        if (!this.hasSmashed) {
                            this.hasSmashed = true;
                            // Spawn crack
                            spawnGroundCrack(this.pos.x, this.pos.y, this.pos.z, this.mesh.rotation.y);
                            playSound('hit_wood', 0.6); // ground impact placeholder sound
                            
                            // Deal massive AoE damage to player
                            if (distToPlayer < 8) {
                                state.health = Math.max(0, state.health - 40); // 40 dmg!
                                spawnDamageNumber(playerPos.x, playerPos.y + 2, playerPos.z, 40, false);
                                playSound('hit_wood', 1.0); // hit player
                                showHitFlash();
                            }
                        }
                    }
                    return;
                }

                // Normal chase
                this.target.copy(playerPos);
                this.state = 'walking';
                this.speed = 3;
                if (distToPlayer < 6 && this.timer <= 0) {
                    // Start attack sequence
                    this.timer = 4; // 4 seconds cooldown between smashes
                    this.attackTimer = 1.0;
                    this.hasSmashed = false;
                } else {
                    this.animateLimbs();
                    this._moveToTarget(dt);
                }
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
            const baseFlyHeight = 90 + Math.sin(this.walkCycle) * 15;
            const terrainH = getTerrainHeight(this.pos.x, this.pos.z);
            this.pos.y = Math.max(baseFlyHeight, terrainH + 40);
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

                    // Periodic idle noises
                    if (Math.random() > 0.7) {
                        if (this.type === 'stag') playSound('stag', 0.8 + Math.random() * 0.4, 0.4);
                        if (this.type === 'wolf') playSound('wolf', 0.5 + Math.random() * 0.3, 0.3);
                        if (this.type === 'bear') playSound('bear', 0.6 + Math.random() * 0.2, 0.4);
                    }
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
                
                // Fast O(1) Animal Collision Detection using the 2D terrain grid
                const checkX = this.pos.x + moveVec.x * 3;
                const checkZ = this.pos.z + moveVec.z * 3;
                
                if (checkCollision(checkX, checkZ, 1.0)) {
                    this.state = 'idle'; // Blocked by object (tree/rock/etc), stop walking
                    this.timer = 1.0;    // Wait 1 second before picking a new path
                } else {
                    this.pos.add(moveVec);
                }

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
        
        // Fast O(1) Animal Collision Detection
        const checkX = this.pos.x + moveVec.x * 2;
        const checkZ = this.pos.z + moveVec.z * 2;
        
        if (!checkCollision(checkX, checkZ, 1.0)) {
            this.pos.add(moveVec);
        }
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

    const skinMat = new THREE.MeshStandardMaterial({ color: skinColors[Math.floor(Math.random() * skinColors.length)] });
    const shirtMat = new THREE.MeshStandardMaterial({ color: clothesColors[Math.floor(Math.random() * clothesColors.length)] });
    const pantsMat = new THREE.MeshStandardMaterial({ color: clothesColors[Math.floor(Math.random() * clothesColors.length)] });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x212121 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.4), shirtMat);
    torso.position.y = 1.0;
    torso.castShadow = true;
    g.add(torso);
    
    // Belt
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.15, 0.45), new THREE.MeshStandardMaterial({ color: 0x221100 }));
    belt.position.y = 0.55;
    g.add(belt);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skinMat);
    head.position.y = 1.75;
    head.castShadow = true;
    g.add(head);
    
    // Eyes
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), eyeMat);
    eyeL.position.set(-0.1, 1.8, 0.26);
    g.add(eyeL);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), eyeMat);
    eyeR.position.set(0.1, 1.8, 0.26);
    g.add(eyeR);

    // Nose
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.1), skinMat);
    nose.position.set(0, 1.75, 0.28);
    g.add(nose);
    
    // Detailed Hair
    const hairColor = [0x111111, 0x4a3b2c, 0xc68642, 0xaaaaaa][Math.floor(Math.random()*4)];
    const styles = ['short', 'spiky', 'curly', 'long', 'ponytail'];
    const style = styles[Math.floor(Math.random() * styles.length)];
    const hair = createDetailedHair(style, hairColor);
    hair.position.y = 1.75;
    g.add(hair);

    // Hat
    if (Math.random() > 0.4) {
        const hatMat = new THREE.MeshStandardMaterial({ color: 0x8d6e63 }); // brown peasant hat
        const hatBase = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 12), hatMat);
        hatBase.position.y = 2.0;
        g.add(hatBase);
        const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.3, 12), hatMat);
        hatTop.position.y = 2.15;
        g.add(hatTop);
    }

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
    
    if (Math.random() > 0.5) {
        // Hold a tool
        const toolMat = new THREE.MeshStandardMaterial({ color: 0x3d2817 });
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5), toolMat);
        stick.position.set(0, -0.4, 0.2);
        stick.rotation.x = Math.PI / 4;
        ra.add(stick);
    }

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

function createWendigo() {
    const g = new THREE.Group();
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 1.0 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0 });

    // Gaunt body
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.6), darkMat);
    chest.position.set(0, 3.5, 0);
    g.add(chest);

    // Skull head (Deer skull)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 1.0), boneMat);
    head.position.set(0, 4.6, 0.4);
    g.add(head);

    // Glowing eyes
    const eyeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const eyeL = new THREE.Mesh(eyeGeo, glowMat); eyeL.position.set(-0.2, 4.7, 0.9);
    const eyeR = new THREE.Mesh(eyeGeo, glowMat); eyeR.position.set(0.2, 4.7, 0.9);
    g.add(eyeL, eyeR);

    // Antlers (jagged)
    const antL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 1.2), boneMat);
    antL.position.set(-0.4, 5.2, 0.2); antL.rotation.z = -0.3; antL.rotation.x = -0.2;
    const antR = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 1.2), boneMat);
    antR.position.set(0.4, 5.2, 0.2); antR.rotation.z = 0.3; antR.rotation.x = -0.2;
    g.add(antL, antR);

    // Long arms
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.5, 0.2), darkMat); fl.position.set(-0.6, 2.5, 0.2);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.5, 0.2), darkMat); fr.position.set(0.6, 2.5, 0.2);
    // Long legs (digitigrade)
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.5, 0.3), darkMat); bl.position.set(-0.3, 1.25, 0);
    const br = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.5, 0.3), darkMat); br.position.set(0.3, 1.25, 0);
    g.add(fl, fr, bl, br);
    
    g.userData.limbs = { fl, fr, bl, br };
    g.userData.hp = 300;
    g.userData.maxHp = 300;
    g.traverse(c => { if(c.isMesh) c.castShadow = true; });
    return g;
}

function createRabbit() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xeaeaea, roughness: 1.0 }); 
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 1.0), mat);
    body.position.y = 0.3;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat);
    head.position.set(0, 0.6, 0.6);
    const ear1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.2), mat);
    ear1.position.set(-0.2, 0.9, 0.5);
    const ear2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.2), mat);
    ear2.position.set(0.2, 0.9, 0.5);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    tail.position.set(0, 0.4, -0.6);
    g.add(body, head, ear1, ear2, tail);
    
    // Animate jump logic
    const fl = new THREE.Mesh(); const fr = new THREE.Mesh(); const bl = new THREE.Mesh(); const br = new THREE.Mesh();
    g.userData.limbs = { fl, fr, bl, br }; // dummy limbs so it doesn't crash
    g.userData.hp = 5;
    g.userData.maxHp = 5;
    g.traverse(c => { if(c.isMesh) c.castShadow = true; });
    return g;
}

function createFox() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xd95a2b, roughness: 0.9 }); 
    const wMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0 }); 
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 2.2), mat);
    body.position.y = 1.0;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mat);
    head.position.set(0, 1.4, 1.3);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.6), wMat);
    snout.position.set(0, 1.2, 1.8);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 1.5), mat);
    tail.position.set(0, 1.0, -1.5);
    tail.rotation.x = Math.PI / 6;
    
    const legGeo = new THREE.BoxGeometry(0.3, 0.8, 0.3);
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const fl = new THREE.Mesh(legGeo, blackMat); fl.position.set(-0.3, 0.4, 1);
    const fr = new THREE.Mesh(legGeo, blackMat); fr.position.set(0.3, 0.4, 1);
    const bl = new THREE.Mesh(legGeo, blackMat); bl.position.set(-0.3, 0.4, -0.8);
    const br = new THREE.Mesh(legGeo, blackMat); br.position.set(0.3, 0.4, -0.8);
    g.add(body, head, snout, tail, fl, fr, bl, br);
    
    const earL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.2), mat); earL.position.set(-0.3, 1.9, 1.1);
    const earR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.2), mat); earR.position.set(0.3, 1.9, 1.1);
    g.add(earL, earR);
    
    g.userData.limbs = { fl, fr, bl, br };
    g.userData.hp = 20;
    g.userData.maxHp = 20;
    g.traverse(c => { if(c.isMesh) c.castShadow = true; });
    return g;
}

function createBoar() {
    const g = new THREE.Group();
    const furMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.9, flatShading: true }); // Darker brown
    const lightFur = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9, flatShading: true }); // Lighter brown
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
    const tuskMat = new THREE.MeshStandardMaterial({ color: 0xeaeaea, flatShading: true });

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 2.8), furMat);
    body.position.set(0, 1.4, 0);

    // Mane/Ridge on back
    const mane = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 2.4), lightFur);
    mane.position.set(0, 2.2, 0);

    // Head
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.6, 1.5);
    
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 1.2), furMat);
    headGroup.add(head);

    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), lightFur);
    snout.position.set(0, -0.1, 1.0);
    headGroup.add(snout);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.2), eyeMat); // Black nose
    nose.position.set(0, 0.1, 1.45);
    headGroup.add(nose);

    // Eyes
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), eyeMat);
    eyeL.position.set(-0.4, 0.3, 0.61);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), eyeMat);
    eyeR.position.set(0.4, 0.3, 0.61);
    headGroup.add(eyeL, eyeR);

    // Tusks
    const tuskGeo = new THREE.ConeGeometry(0.12, 0.8, 4);
    const tusk1 = new THREE.Mesh(tuskGeo, tuskMat);
    tusk1.position.set(-0.5, -0.2, 1.5); tusk1.rotation.x = Math.PI / 2.5;
    const tusk2 = new THREE.Mesh(tuskGeo, tuskMat);
    tusk2.position.set(0.5, -0.2, 1.5); tusk2.rotation.x = Math.PI / 2.5;
    headGroup.add(tusk1, tusk2);

    // Ears
    const earL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.1), furMat);
    earL.position.set(-0.6, 0.6, 0.2); earL.rotation.z = Math.PI / 6;
    const earR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.1), furMat);
    earR.position.set(0.6, 0.6, 0.2); earR.rotation.z = -Math.PI / 6;
    headGroup.add(earL, earR);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.5, 0.8, 0.5);
    const fl = new THREE.Mesh(legGeo, furMat); fl.position.set(-0.5, 0.4, 1.0);
    const fr = new THREE.Mesh(legGeo, furMat); fr.position.set(0.5, 0.4, 1.0);
    const bl = new THREE.Mesh(legGeo, furMat); bl.position.set(-0.5, 0.4, -1.0);
    const br = new THREE.Mesh(legGeo, furMat); br.position.set(0.5, 0.4, -1.0);
    
    // Tail
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.1), furMat);
    tail.position.set(0, 1.8, -1.5); tail.rotation.x = Math.PI / 6;

    g.add(body, mane, headGroup, fl, fr, bl, br, tail);
    
    g.userData.limbs = { fl, fr, bl, br };
    g.userData.hp = 100;
    g.userData.maxHp = 100;
    g.traverse(c => { if(c.isMesh) c.castShadow = true; });
    return g;
}

function createCrystalCave() {
    const g = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9, flatShading: true });
    
    // Arch structure using massive boulders
    for (let i = 0; i < 15; i++) {
        const boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(10 + Math.random() * 8, 1), stoneMat);
        const angle = (i / 14) * Math.PI; // 0 to PI
        const r = 20;
        boulder.position.set(Math.cos(angle) * r, Math.sin(angle) * r - 5, (Math.random() - 0.5) * 15);
        boulder.rotation.set(Math.random(), Math.random(), Math.random());
        g.add(boulder);
    }
    // Add back wall
    const backWall = new THREE.Mesh(new THREE.DodecahedronGeometry(22, 1), stoneMat);
    backWall.position.set(0, 5, -15);
    g.add(backWall);

    // Decorate the inside with glowing crystals
    const crystalColors = [0x00ffff, 0xff00ff, 0x00ff00, 0x5555ff];
    for (let i = 0; i < 10; i++) {
        const cColor = crystalColors[Math.floor(Math.random() * crystalColors.length)];
        const cMat = new THREE.MeshStandardMaterial({ 
            color: cColor, emissive: cColor, emissiveIntensity: 0.8,
            transparent: true, opacity: 0.9, roughness: 0.1
        });
        const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.8 + Math.random(), 4 + Math.random() * 6, 5), cMat);
        
        const rPos = (Math.random() - 0.5) * 20;
        const yPos = (Math.random() > 0.6) ? 5 + Math.random() * 10 : 0; 
        crystal.position.set(rPos, yPos, -10 + Math.random() * 15);
        crystal.rotation.set(Math.random()*0.5, Math.random(), Math.random()*0.5);
        
        // Point light on just the first crystal
        if (i === 0) {
            const light = new THREE.PointLight(cColor, 2, 40);
            crystal.add(light);
        }
        g.add(crystal);
    }
    g.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    return g;
}

function createRuinedTower() {
    const g = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.9, flatShading: true });
    
    for (let y = 0; y < 15; y += 2.5) {
        if (Math.random() > 0.8 && y > 5) continue; 
        const layer = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 2.5, 8), stoneMat);
        layer.position.y = y + 1.25;
        layer.rotation.y = Math.random() * 0.2;
        layer.rotation.z = (Math.random() - 0.5) * 0.1;
        g.add(layer);
    }
    for(let i=0; i<10; i++) {
        const rubble = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + Math.random(), 0), stoneMat);
        rubble.position.set((Math.random()-0.5)*15, 1, (Math.random()-0.5)*15);
        rubble.rotation.set(Math.random(), Math.random(), Math.random());
        g.add(rubble);
    }
    g.traverse(c => { if(c.isMesh) c.castShadow = true; });
    return g;
}

function createLootChest(tier = 'common') {
    const g = new THREE.Group();
    const woodCol = tier === 'rare' ? 0x4a2f00 : 0x5a3a1a;
    const metalCol = tier === 'rare' ? 0xffd700 : 0x888888;
    const woodMat = new THREE.MeshStandardMaterial({ color: woodCol, roughness: 0.9 });
    const metalMat = new THREE.MeshStandardMaterial({ color: metalCol, metalness: 0.8, roughness: 0.3 });
    const glowMat = new THREE.MeshStandardMaterial({ color: tier === 'rare' ? 0xffd700 : 0x44aaff, emissive: tier === 'rare' ? 0xffd700 : 0x44aaff, emissiveIntensity: 0.5 });

    // Chest body
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 1.2), woodMat);
    body.position.y = 0.6;
    g.add(body);
    // Lid
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 1.2), woodMat);
    lid.position.y = 1.45;
    g.add(lid);
    // Lid curve cap
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.18, 8), woodMat);
    cap.rotation.z = Math.PI / 2;
    cap.position.y = 1.45;
    g.add(cap);
    // Metal bands
    for (let bx of [-0.7, 0, 0.7]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.8, 1.25), metalMat);
        band.position.set(bx, 0.8, 0);
        g.add(band);
    }
    // Lock
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.15), metalMat);
    lock.position.set(0, 1.1, 0.68);
    g.add(lock);
    // Glow keyhole
    const keyhole = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), glowMat);
    keyhole.position.set(0, 1.1, 0.74);
    g.add(keyhole);
    // Optional point light for rare
    if (tier === 'rare') {
        const light = new THREE.PointLight(0xffd700, 1.5, 8);
        light.position.y = 2;
        g.add(light);
    }
    g.traverse(c => { if (c.isMesh) c.castShadow = true; });
    g.userData.harvestType = 'chest';
    g.userData.chestTier = tier;
    g.userData.hp = 1; // One click to open
    return g;
}

function createWall() {
    const g = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 1.0 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.4), woodMat);
    wall.position.y = 1.5;
    g.add(wall);
    // Vertical supports
    const supportMat = new THREE.MeshStandardMaterial({ color: 0x3e2723 });
    for (let x of [-1.8, 1.8]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.2, 0.5), supportMat);
        s.position.set(x, 1.6, 0);
        g.add(s);
    }
    g.traverse(c => { if(c.isMesh) c.castShadow = true; });
    return g;
}

function createRoof() {
    const g = new THREE.Group();
    const strawMat = new THREE.MeshStandardMaterial({ color: 0xbc9b4a, roughness: 1.0 });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3, 2, 4), strawMat);
    roof.position.y = 1;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    g.traverse(c => { if(c.isMesh) c.castShadow = true; });
    return g;
}

function createTorch() {
    const g = new THREE.Group();
    const stickMat = new THREE.MeshStandardMaterial({ color: 0x3d2817 });
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.5), stickMat);
    stick.position.y = 0.75;
    g.add(stick);
    const fireMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 2 });
    const fire = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), fireMat);
    fire.position.y = 1.5;
    g.add(fire);
    const light = new THREE.PointLight(0xffaa00, 1.5, 10);
    light.position.y = 1.6;
    g.add(light);
    return g;
}

function createMerchant() {
    const g = createVillager();
    // Give him a distinctive hat
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x1a237e }); // Deep blue
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 0.3, 8), hatMat);
    hat.position.y = 1.6;
    g.add(hat);
    g.userData.isMerchant = true;
    return g;
}

function createFallenLog() {
    const g = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 1.0 });
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 6, 6), woodMat);
    log.rotation.x = Math.PI / 2;
    log.rotation.z = Math.random() * Math.PI;
    log.position.y = 0.5;
    g.add(log);
    
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32 });
    for (let i = 0; i < 4; i++) {
        const moss = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5), leafMat);
        moss.position.set((Math.random() - 0.5) * 1.2, 1.0, (Math.random() - 0.5) * 4);
        g.add(moss);
    }
    g.traverse(c => { if(c.isMesh) c.castShadow = true; });
    return g;
}

function createCampfire() {
    const g = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 1.0 });
    for (let i=0; i<8; i++) {
        const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3), stoneMat);
        const a = (i/8) * Math.PI * 2;
        s.position.set(Math.cos(a)*0.6, 0.2, Math.sin(a)*0.6);
        g.add(s);
    }
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3d2817 });
    for (let i=0; i<3; i++) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.2, 5), woodMat);
        l.rotation.z = Math.PI/4;
        l.rotation.y = (i/3) * Math.PI * 2;
        l.position.y = 0.3;
        g.add(l);
    }
    const fireMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 1.5, transparent: true, opacity: 0.8 });
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.2, 4), fireMat);
    fire.position.y = 0.6;
    g.add(fire);
    
    const light = new THREE.PointLight(0xff8800, 2, 20);
    light.position.y = 1.0;
    g.add(light);
    g.traverse(c => { if(c.isMesh) c.castShadow = true; });
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
    for (let i = 0; i < 3; i++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.4, 0.1), glowMat);
        rib.position.set(0, 1.2, -0.3 - (i * 0.3));
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
        emissiveIntensity: 0.9,
        roughness: 0.1,
        transparent: true,
        opacity: 0.9,
        metalness: 0.3
    });
    const darkRockMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9, bumpScale: 0.05 });
    const lightRockMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.8 });

    // Core Torso (Jagged rock assembly)
    const torsoGrp = new THREE.Group();
    
    // Main block
    const torsoCore = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.0, 1.8), darkRockMat);
    torsoCore.castShadow = true;
    torsoGrp.add(torsoCore);

    // Rocky pectoral plates
    const pecL = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 0.5), lightRockMat);
    pecL.position.set(-0.6, 0.5, 0.9);
    pecL.rotation.y = -Math.PI / 8;
    torsoGrp.add(pecL);
    
    const pecR = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 0.5), lightRockMat);
    pecR.position.set(0.6, 0.5, 0.9);
    pecR.rotation.y = Math.PI / 8;
    torsoGrp.add(pecR);

    // Glowing Chest Core inside a rock cage
    const chestCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), crystalMat);
    chestCrystal.position.set(0, 0, 0.6);
    chestCrystal.scale.set(1, 1.5, 0.7);
    torsoGrp.add(chestCrystal);

    // Back Crystal Spines
    for(let i=0; i<3; i++) {
        const spine = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.5, 4), crystalMat);
        spine.position.set(0, 0.5 - i*0.8, -0.9);
        spine.rotation.x = -Math.PI / 3;
        torsoGrp.add(spine);
    }

    torsoGrp.position.y = 3.8;
    g.add(torsoGrp);

    // Head
    const headGrp = new THREE.Group();
    const headCore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85), darkRockMat);
    headCore.castShadow = true;
    headGrp.add(headCore);
    
    // Glowing Crystal Eyes
    const eyeGeo = new THREE.BoxGeometry(0.2, 0.1, 0.1);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x00ffff, emissiveIntensity: 2.0 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.3, 0.1, 0.8);
    eyeL.rotation.y = -Math.PI / 6;
    headGrp.add(eyeL);
    
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.3, 0.1, 0.8);
    eyeR.rotation.y = Math.PI / 6;
    headGrp.add(eyeR);

    // Crystal crown/horn
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.8, 4), crystalMat);
    crown.position.set(0, 0.8, 0);
    headGrp.add(crown);

    headGrp.position.set(0, 5.8, 0.4);
    g.add(headGrp);

    function createArm(isLeft) {
        const grp = new THREE.Group();
        const sign = isLeft ? -1 : 1;

        // Massive Shoulder Pauldron
        const shoulder = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9), darkRockMat);
        shoulder.position.set(0, 0, 0); 
        shoulder.scale.set(1.2, 1, 1);
        shoulder.castShadow = true; 
        grp.add(shoulder);

        // Shoulder crystal spike
        const shoulderSpike = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.2, 4), crystalMat);
        shoulderSpike.position.set(sign * 0.4, 0.8, 0);
        shoulderSpike.rotation.z = sign * -Math.PI / 6;
        grp.add(shoulderSpike);

        // Upper Arm
        const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.9), lightRockMat);
        upperArm.position.set(0, -1.2, 0); 
        upperArm.castShadow = true; 
        grp.add(upperArm);

        // Forearm (larger)
        const forearm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.6, 1.1), darkRockMat);
        forearm.position.set(0, -2.7, 0.1); 
        forearm.castShadow = true; 
        grp.add(forearm);
        
        // Forearm crystal blades
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.4, 0.4), crystalMat);
        blade.position.set(sign * 0.6, -2.7, 0);
        grp.add(blade);

        // Heavy Fist
        const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8), crystalMat);
        fist.position.set(0, -3.8, 0.2); 
        fist.castShadow = true; 
        grp.add(fist);
        
        return grp;
    }
    const la = createArm(true); la.position.set(-2.0, 4.4, 0); g.add(la);
    const ra = createArm(false); ra.position.set(2.0, 4.4, 0); g.add(ra);

    function createLeg(isLeft) {
        const grp = new THREE.Group();
        
        // Thigh
        const thigh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.5, 1.0), lightRockMat);
        thigh.position.set(0, -0.7, 0);
        thigh.castShadow = true; 
        grp.add(thigh);

        // Knee guard
        const knee = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), darkRockMat);
        knee.position.set(0, -1.5, 0.5);
        grp.add(knee);

        // Calf
        const calf = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 1.1), darkRockMat);
        calf.position.set(0, -2.2, 0);
        calf.castShadow = true; 
        grp.add(calf);

        // Massive Foot
        const foot = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 1.8), crystalMat);
        foot.position.set(0, -3.2, 0.2); 
        foot.castShadow = true; 
        grp.add(foot);
        
        return grp;
    }
    const fl = createLeg(true); fl.position.set(-0.8, 2.5, 0); g.add(fl);
    const fr = createLeg(false); fr.position.set(0.8, 2.5, 0); g.add(fr);

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
        { y: 0.8, z: 1.0, rotX: 0.2, s: 1.0 },
        { y: 1.8, z: 1.8, rotX: 0.4, s: 0.9 },
        { y: 2.8, z: 2.3, rotX: 0.5, s: 0.8 },
        { y: 3.8, z: 2.6, rotX: 0.6, s: 0.7 }
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

    for (let i = 0; i < 8; i++) {
        const s = 1.0 - (i * 0.1);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(1.8 * s, 1.8 * s, 2.0), scaleMat);
        seg.position.set(0, -i * 0.2, -i * 1.8);

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

        const thigh = new THREE.Mesh(new THREE.BoxGeometry(1.0 * s, 2.5 * s, 1.2 * s), scaleMat);
        thigh.position.set(dirX * 1.5 * s, -1.0 * s, 0);
        thigh.rotation.z = dirX * 0.3;

        const calf = new THREE.Mesh(new THREE.BoxGeometry(0.8 * s, 2.0 * s, 0.8 * s), scaleMat);
        calf.position.set(dirX * 1.8 * s, -3.0 * s, -0.5 * s);
        calf.rotation.x = -0.4;

        const foot = new THREE.Mesh(new THREE.BoxGeometry(1.2 * s, 0.6 * s, 1.8 * s), scaleMat);
        foot.position.set(dirX * 1.8 * s, -4.0 * s, 0.2 * s);

        // Claws
        for (let i = -1; i <= 1; i++) {
            const claw = new THREE.Mesh(new THREE.ConeGeometry(0.1 * s, 0.8 * s, 4), boneMat);
            claw.position.set(dirX * 1.8 * s + (i * 0.4 * s), -4.0 * s, 1.2 * s);
            claw.rotation.x = Math.PI / 2;
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

function createChurch() {
    const g = new THREE.Group();
    const stoneMat = houseMats.stone;
    const roofMat = houseMats.roof;
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x1e2229 }); // darker accent
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8 });
    const woodMat = houseMats.wood;

    // Main Nave (Hall) - increased length for more presence
    const nave = new THREE.Mesh(new THREE.BoxGeometry(16, 22, 32), stoneMat);
    nave.position.y = 11;
    nave.castShadow = true;
    nave.receiveShadow = true;
    g.add(nave);

    // Stone Pillars along the nave
    for(let dz of [-12, -4, 4, 12]) {
        for(let dx of [-8.5, 8.5]) {
            const pillar = new THREE.Mesh(new THREE.BoxGeometry(2, 22, 2), darkStone);
            pillar.position.set(dx, 11, dz);
            g.add(pillar);
            
            // Flying buttresses
            const buttress = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 2), darkStone);
            buttress.position.set(Math.sign(dx) * 11, 18, dz);
            buttress.rotation.z = Math.sign(dx) * Math.PI / 6;
            g.add(buttress);
            
            const buttressBase = new THREE.Mesh(new THREE.BoxGeometry(3, 14, 3), stoneMat);
            buttressBase.position.set(Math.sign(dx) * 13, 7, dz);
            g.add(buttressBase);
        }
    }

    // Transept (Cross section)
    const transept = new THREE.Mesh(new THREE.BoxGeometry(30, 20, 12), stoneMat);
    transept.position.set(0, 10, 2);
    transept.castShadow = true;
    transept.receiveShadow = true;
    g.add(transept);

    // Nave Roof
    const naveRoof = new THREE.Mesh(new THREE.BoxGeometry(17, 12, 34), roofMat);
    naveRoof.position.set(0, 22 + 6, 0);
    naveRoof.rotation.z = Math.PI / 4;
    g.add(naveRoof);
    
    // Transept Roof
    const transRoof = new THREE.Mesh(new THREE.BoxGeometry(32, 10, 13), roofMat);
    transRoof.position.set(0, 20 + 5, 2);
    transRoof.rotation.x = Math.PI / 4;
    g.add(transRoof);

    // Front Bell Tower (Massive and tall)
    const tower = new THREE.Mesh(new THREE.BoxGeometry(14, 40, 14), stoneMat);
    tower.position.set(0, 20, 16); 
    tower.castShadow = true;
    tower.receiveShadow = true;
    g.add(tower);
    
    // Tower Corners
    for(let dx of [-7, 7]) {
        for(let dz of [9, 23]) {
            const tCorner = new THREE.Mesh(new THREE.BoxGeometry(2, 42, 2), darkStone);
            tCorner.position.set(dx, 21, dz);
            g.add(tCorner);
        }
    }

    // Tower Spire (multi-tiered)
    const spireBase = new THREE.Mesh(new THREE.ConeGeometry(10, 10, 4), darkStone);
    spireBase.position.set(0, 45, 16);
    spireBase.rotation.y = Math.PI / 4;
    g.add(spireBase);
    
    const spireTop = new THREE.Mesh(new THREE.ConeGeometry(8, 25, 4), roofMat);
    spireTop.position.set(0, 55, 16);
    spireTop.rotation.y = Math.PI / 4;
    g.add(spireTop);
    
    // Rose Window (Circular Glowing Window)
    const roseGeo = new THREE.CylinderGeometry(4, 4, 0.5, 16);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x0088cc, emissiveIntensity: 1.0 });
    const rose = new THREE.Mesh(roseGeo, glassMat);
    rose.position.set(0, 28, 23.1);
    rose.rotation.x = Math.PI / 2;
    g.add(rose);

    // Stained glass glowing side windows
    const winGeoC = new THREE.BoxGeometry(2, 8, 0.2);
    for(let dz of [-12, -4, 12]) {
        for(let dx of [-8.1, 8.1]) {
            const w = new THREE.Mesh(winGeoC, glassMat);
            w.position.set(dx, 12, dz);
            w.rotation.y = Math.PI / 2;
            g.add(w);
        }
    }

    // Grand Entrance Archway
    const archGeo = new THREE.CylinderGeometry(3, 3, 2, 16, 1, false, 0, Math.PI);
    const arch = new THREE.Mesh(archGeo, darkStone);
    arch.position.set(0, 6, 23.2);
    arch.rotation.x = Math.PI / 2;
    g.add(arch);

    // Functional Grand Doors (Double doors)
    const door1 = createFunctionalDoor(2.8, 6, 0.3, woodMat);
    door1.position.set(-2.8, 0, 23.1);
    g.add(door1);
    
    const door2 = createFunctionalDoor(2.8, 6, 0.3, woodMat);
    door2.position.set(2.8, 0, 23.1);
    door2.rotation.y = Math.PI; // Face opposite way so it hinges correctly
    g.add(door2);

    // Cross on top
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), goldMat);
    crossV.position.set(0, 70, 16);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 0.4), goldMat);
    crossH.position.set(0, 71, 16);
    g.add(crossV, crossH);

    return g;
}

function createBlacksmith() {
    const g = new THREE.Group();
    
    // Stone foundation
    const foundation = new THREE.Mesh(new THREE.BoxGeometry(14, 1, 14), houseMats.stone);
    foundation.position.y = 0.5;
    g.add(foundation);
    
    // Wooden pillars holding a sloped roof
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x3e2723 });
    const pillarPositions = [[-6, -6], [6, -6], [-6, 6], [6, 6], [-6, 0], [6, 0]];
    pillarPositions.forEach(p => {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), pillarMat);
        pillar.position.set(p[0], 4.5, p[1]);
        pillar.castShadow = true;
        g.add(pillar);
    });
    
    // Sloped awning roof
    const roof = new THREE.Mesh(new THREE.BoxGeometry(15, 0.5, 15), houseMats.roof);
    roof.position.set(0, 9, 0);
    roof.rotation.x = -0.15; // slightly sloped
    roof.castShadow = true;
    g.add(roof);
    
    // The main stone forge/furnace at the back
    const forge = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 4), houseMats.stone);
    forge.position.set(0, 4, -4);
    g.add(forge);
    
    // Chimney extending from forge
    const chim = new THREE.Mesh(new THREE.BoxGeometry(3, 8, 3), houseMats.stone);
    chim.position.set(0, 11, -4);
    g.add(chim);
    
    // Glowing coals inside the forge opening
    const forgeOpening = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 2), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    forgeOpening.position.set(0, 2.5, -2.5);
    g.add(forgeOpening);
    
    const coals = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 1.5), new THREE.MeshStandardMaterial({ color: 0xff4500, emissive: 0xff4500 }));
    coals.position.set(0, 1.5, -2.2);
    g.add(coals);
    
    // Anvil on a tree stump
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 1, 8), pillarMat);
    stump.position.set(0, 1.5, 2);
    g.add(stump);
    
    const anvilMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9, roughness: 0.3 });
    const anvilBody = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.8), anvilMat);
    anvilBody.position.set(0, 2.4, 2);
    g.add(anvilBody);
    
    const anvilHorn = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 4), anvilMat);
    anvilHorn.position.set(1.1, 2.4, 2);
    anvilHorn.rotation.z = -Math.PI/2;
    g.add(anvilHorn);
    
    // Weapon rack on the side
    const rack = new THREE.Group();
    const rBase = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 0.2), pillarMat);
    rBase.position.set(-4, 2, 4);
    const rBase2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 0.2), pillarMat);
    rBase2.position.set(-4, 2, 1);
    const rTop = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 3.5), pillarMat);
    rTop.position.set(-4, 3.2, 2.5);
    rack.add(rBase, rBase2, rTop);
    
    // Add a couple of swords to the rack
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 });
    for(let i=0; i<3; i++) {
        const sword = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 0.3), bladeMat);
        sword.position.set(-3.9, 2, 1.5 + i*0.8);
        rack.add(sword);
    }
    g.add(rack);
    
    // Water trough for quenching
    const trough = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 2), pillarMat);
    trough.position.set(4, 1.5, 3);
    g.add(trough);
    
    const water = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 1.6), new THREE.MeshStandardMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.8 }));
    water.position.set(4, 1.9, 3);
    g.add(water);

    g.traverse(child => { if (child.isMesh) child.castShadow = true; });
    return g;
}

function createKnight() {
    const g = new THREE.Group();
    // Iron armor materials
    const armorMat = new THREE.MeshStandardMaterial({ color: 0xa0a0a0, metalness: 0.8, roughness: 0.4 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xcd7f32, metalness: 0.9, roughness: 0.3 }); // bronze trim
    
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.5), armorMat);
    torso.position.y = 1.0;
    torso.castShadow = true;
    g.add(torso);
    
    // Add some trim to torso
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.15, 0.55), trimMat);
    belt.position.y = 0.6;
    g.add(belt);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.55), armorMat);
    head.position.y = 1.8;
    head.castShadow = true;
    g.add(head);
    // Helmet slit
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x000000 }));
    slit.position.set(0, 1.85, 0.28);
    g.add(slit);
    
    // Plume
    const plume = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x8b0000 }));
    plume.position.set(0, 2.3, 0);
    g.add(plume);
    
    // Cape
    if (Math.random() > 0.3) {
        const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.2), new THREE.MeshStandardMaterial({ color: 0x8b0000, side: THREE.DoubleSide }));
        cape.position.set(0, 0.8, -0.3);
        cape.rotation.x = -Math.PI / 12;
        g.add(cape);
    }

    function createLimb(w, h, d, yOffset) {
        const pivot = new THREE.Group();
        pivot.position.y = yOffset;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), armorMat);
        mesh.position.y = -h / 2;
        mesh.castShadow = true;
        pivot.add(mesh);
        return pivot;
    }

    const la = createLimb(0.3, 0.8, 0.3, 1.5); la.position.x = -0.55; g.add(la);
    const ra = createLimb(0.3, 0.8, 0.3, 1.5); ra.position.x = 0.55; g.add(ra);
    const ll = createLimb(0.35, 1.0, 0.35, 0.5); ll.position.x = -0.2; g.add(ll);
    const rl = createLimb(0.35, 1.0, 0.35, 0.5); rl.position.x = 0.2; g.add(rl);

    // Equip Sword or Axe
    const equip = Math.random();
    if (equip > 0.5) {
        // Sword
        const swordGrp = new THREE.Group();
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.2), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9 }));
        blade.position.y = 0.6;
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), new THREE.MeshStandardMaterial({ color: 0x3e2723 }));
        handle.position.y = -0.15;
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.1), trimMat);
        swordGrp.add(blade, handle, guard);
        swordGrp.position.set(0, -0.6, 0.2);
        swordGrp.rotation.x = Math.PI / 2;
        ra.add(swordGrp);
    } else {
        // Axe
        const axeGrp = new THREE.Group();
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0x5c4033 }));
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.5), new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8 }));
        head.position.set(0, 0.4, 0.15);
        axeGrp.add(handle, head);
        axeGrp.position.set(0, -0.6, 0.2);
        axeGrp.rotation.x = Math.PI / 2;
        ra.add(axeGrp);
    }
    
    // Shield
    const hasShield = Math.random() > 0.3;
    if (hasShield) {
        const shieldGrp = new THREE.Group();
        const shieldBody = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.1), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        const shieldTrim = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.85, 0.05), trimMat);
        shieldGrp.add(shieldBody, shieldTrim);
        shieldGrp.position.set(0, -0.2, 0.2);
        shieldGrp.rotation.y = Math.PI / 2;
        la.add(shieldGrp); // left arm holds shield
    }

    g.userData = { limbs: { la, ra, ll, rl }, walkCycle: Math.random() * Math.PI, hp: 150, maxHp: 150 };
    return g;
}

function createMarketStall() {
    const g = new THREE.Group();
    // wooden table
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 2), tableMat);
    tableTop.position.set(0, 1.2, 0);
    g.add(tableTop);
    // table legs
    const legGeo = new THREE.BoxGeometry(0.2, 1.2, 0.2);
    const pos = [[-1.8, -0.8], [1.8, -0.8], [-1.8, 0.8], [1.8, 0.8]];
    pos.forEach(p => {
        const leg = new THREE.Mesh(legGeo, tableMat);
        leg.position.set(p[0], 0.6, p[1]);
        g.add(leg);
    });
    // awning
    const poleGeo = new THREE.BoxGeometry(0.2, 3, 0.2);
    const p1 = new THREE.Mesh(poleGeo, tableMat); p1.position.set(-1.8, 1.5, -0.8); g.add(p1);
    const p2 = new THREE.Mesh(poleGeo, tableMat); p2.position.set(1.8, 1.5, -0.8); g.add(p2);
    
    // Add props on the table
    for(let i=0; i<3; i++) {
        const itemMat = new THREE.MeshStandardMaterial({color: [0xff0000, 0x00ff00, 0x0000ff, 0xffff00][Math.floor(Math.random()*4)]});
        const item = new THREE.Mesh(new THREE.BoxGeometry(0.3 + Math.random()*0.3, 0.3 + Math.random()*0.3, 0.3 + Math.random()*0.3), itemMat);
        item.position.set(-1 + i*1, 1.4, Math.random()*0.5 - 0.25);
        g.add(item);
    }
    
    // Cloth colors
    const colors = [0xd32f2f, 0x1976d2, 0x388e3c, 0xfbc02d];
    const clothMat = new THREE.MeshStandardMaterial({ color: colors[Math.floor(Math.random()*colors.length)], side: THREE.DoubleSide });
    const awning = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3), clothMat);
    awning.rotation.x = -Math.PI / 4;
    awning.position.set(0, 3, 0);
    g.add(awning);
    
    // Some crates on the table
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x6d4c41 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), crateMat);
    crate.position.set(-1, 1.6, 0);
    g.add(crate);
    
    g.traverse(child => { if (child.isMesh) child.castShadow = true; });
    return g;
}

function spawnCapitalCity() {
    const x = 0;
    const z = 0;
    const h = 3.0; // Flat height we set in getBiomeData

    const cityGroup = new THREE.Group();
    // Anchor exactly to the flat terrain height
    cityGroup.position.set(x, h, z); 
    
    // Courtyard (Octagon shape to match walls exactly)
    const radius = 100;
    const courtyardGeo = new THREE.CylinderGeometry(radius + 5, radius + 5, 0.1, 8);
    const courtyardMat = new THREE.MeshStandardMaterial({ color: 0x5a6066, roughness: 1.0 }); // Cobblestone pavement color
    const courtyard = new THREE.Mesh(courtyardGeo, courtyardMat);
    courtyard.position.y = 0.05; // Very thin plane directly on terrain
    courtyard.rotation.y = Math.PI / 8; // Align flat edges
    cityGroup.add(courtyard);

    // Central Keep aligned with roads
    const keep = createCastleKeep();
    keep.position.set(0, 0.01, 0); // Sit perfectly on top of courtyard
    keep.rotation.y = 0; // Face the road directly
    cityGroup.add(keep);
    registerCollider(0, 0, 22); // Collider for central keep!
    
    // Massive monument / fountain in front of keep
    const monument = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(8, 9, 1, 16), castleMats.stone);
    base.position.y = 0.5;
    monument.add(base);
    const obelisk = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 2), castleMats.stone);
    obelisk.position.y = 5.5;
    monument.add(obelisk);
    monument.position.set(0, 0.01, 45); // In front of keep
    cityGroup.add(monument);

    // Outer Walls (Huge Octagon)
    const angles = [0, Math.PI/4, Math.PI/2, Math.PI*0.75, Math.PI, Math.PI*1.25, Math.PI*1.5, Math.PI*1.75];
    const wallLen = 2 * radius * Math.tan(Math.PI / 8) + 2;
    
    angles.forEach((angle, idx) => {
        // Shift angle by PI/8 so walls face cardinal directions
        const a = angle + Math.PI / 8;
        const tower = createCastleTower();
        tower.position.set(Math.cos(a) * radius, 0.01, Math.sin(a) * radius);
        cityGroup.add(tower);
        registerCollider(Math.cos(a) * radius, Math.sin(a) * radius, 5); // Tower collision

        const hasGate = (idx === 1 || idx === 3 || idx === 5 || idx === 7); // Gates on all 4 cardinal axes now
        const wall = createCastleWall(wallLen, hasGate);
        const nextAngle = a + Math.PI / 4;
        const midX = (Math.cos(a) + Math.cos(nextAngle)) * radius / 2;
        const midZ = (Math.sin(a) + Math.sin(nextAngle)) * radius / 2;
        wall.position.set(midX, 0.01, midZ);
        wall.rotation.y = -a - Math.PI / 8 - Math.PI/2;
        cityGroup.add(wall);
        
        // Generate continuous colliders for the wall section
        const numCols = 8;
        for (let i = 1; i < numCols; i++) {
            const t = i / numCols;
            const cx = Math.cos(a) * radius * (1-t) + Math.cos(nextAngle) * radius * t;
            const cz = Math.sin(a) * radius * (1-t) + Math.sin(nextAngle) * radius * t;
            // Leave a gap for the gatehouse entrance!
            if (hasGate && Math.abs(t - 0.5) < 0.25) continue; 
            registerCollider(cx, cz, 4);
        }
    });

    // --- GRID LAYOUT SPAWNING ---

    // Church exactly on the left
    const church = createChurch();
    church.position.set(-25, 0.01, 10);
    church.rotation.y = Math.PI / 2; // Face right
    cityGroup.add(church);
    registerCollider(-25, 10, 15);

    // Blacksmith exactly on the right
    const smithy = createBlacksmith();
    smithy.position.set(50, 0.01, 30);
    smithy.rotation.y = -Math.PI / 2; // Face left
    cityGroup.add(smithy);
    registerCollider(50, 30, 15);

    // Market square near the monument
    for (let i = -1; i <= 1; i+=2) {
        let stall = createMarketStall();
        stall.position.set(i * 20, 0.01, 60);
        stall.rotation.y = i > 0 ? -Math.PI / 2 : Math.PI / 2;
        cityGroup.add(stall);

        // Add a Merchant at the first stall
        if (i === -1) {
            let merch = createMerchant();
            merch.position.set(-20, h + 0.01, 56);
            worldGroup.add(merch);
            activeEntities.push(new Entity(merch, -20, 56, 'villager'));
        }
    }
    
    // Rows of houses perfectly aligned
    const houseCoords = [
        // Left neighborhood
        [-30, -30, 0], [-50, -30, 0], [-30, -60, 0], [-50, -60, 0],
        // Right neighborhood
        [30, -30, 0], [50, -30, 0], [30, -60, 0], [50, -60, 0],
        // Horizontal road faces
        [-70, 0, Math.PI/2], [70, 0, -Math.PI/2],
        [-70, 30, Math.PI/2], [70, 30, -Math.PI/2],
        [-70, -30, Math.PI/2], [70, -30, -Math.PI/2],
        // Front street
        [-20, 75, 0], [20, 75, 0], [-40, 75, 0], [40, 75, 0]
    ];
    
    for (const [hx, hz, rot] of houseCoords) {
        let hBuilding = Math.random() > 0.8 ? createTavern() : createMedievalHouse();
        hBuilding.position.set(hx, 0.01, hz);
        hBuilding.rotation.y = rot;
        cityGroup.add(hBuilding);
        registerCollider(hx, hz, 6.5);
    }

    // Spawn static NPCs along the road
    for (let z = 20; z <= 80; z += 20) {
        let k1 = createKnight(); k1.position.set(-10, h + 0.01, z); worldGroup.add(k1); activeEntities.push(new Entity(k1, -10, z, 'knight'));
        let k2 = createKnight(); k2.position.set(10, h + 0.01, z); worldGroup.add(k2); activeEntities.push(new Entity(k2, 10, z, 'knight'));
    }

    // Carrot patches near the market stalls
    const patch1 = createCarrotPatch(); patch1.position.set(-30, 0.01, 58); cityGroup.add(patch1);
    const patch2 = createCarrotPatch(); patch2.position.set(30, 0.01, 58); cityGroup.add(patch2);

    // Two pre-tamed horses tied up near the stable area
    const horse1 = createHorse(); horse1.position.set(-35, h + 0.01, 55); worldGroup.add(horse1);
    const eh1 = new Entity(horse1, -35, 55, 'horse'); eh1.isTamed = true; activeEntities.push(eh1);
    const horse2 = createHorse(); horse2.position.set(35, h + 0.01, 55); worldGroup.add(horse2);
    const eh2 = new Entity(horse2, 35, 55, 'horse'); eh2.isTamed = true; activeEntities.push(eh2);
    // Villagers walking around the city
    for (let i = 0; i < 20; i++) {
        let v = createVillager();
        let vx = (Math.random() - 0.5) * 140;
        let vz = (Math.random() - 0.5) * 140;
        if (Math.abs(vx) < 25 && Math.abs(vz) < 25) vx += 30; // Push out of keep
        v.position.set(vx, h + 0.01, vz);
        worldGroup.add(v);
        activeEntities.push(new Entity(v, vx, vz, 'villager'));
    }

    worldGroup.add(cityGroup);
    collisionGroup.add(cityGroup.clone()); // Simplified collision copy

    // Static optimization
    cityGroup.traverse(child => {
        child.matrixAutoUpdate = false;
        child.updateMatrix();
    });
    cityGroup.matrixAutoUpdate = false;
    cityGroup.updateMatrix();
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
            for (let k = 0; k < pAttr.count; k++) {
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
            let hasChurch = false;
            while (housePositions.length < numHouses && attempts < 50) {
                attempts++;
                const angle = Math.random() * Math.PI * 2;
                const dist = plazaSize / 2 + 10 + Math.random() * 20;

                const hx = x + Math.cos(angle) * dist;
                const hz = z + Math.sin(angle) * dist;

                // Fast height check
                const hh = getMeshHeight(hx, hz);

                if (hh > 0 && Math.abs(hh - h) < 5) {
                    // Check collision
                    let collision = false;
                    for (const pos of housePositions) {
                        const dx = pos.x - hx;
                        const dz = pos.z - hz;
                        if (Math.sqrt(dx * dx + dz * dz) < 30) { // 15 units min distance between houses
                            collision = true;
                            break;
                        }
                    }

                    if (!collision) {
                        let house;
                        if (!hasChurch) {
                            house = createChurch();
                            hasChurch = true;
                        } else {
                            house = createRandomBuilding();
                        }
                        house.position.set(hx, hh, hz);
                        // Make house face the plaza
                        house.rotation.y = Math.atan2(x - hx, z - hz);
                        worldGroup.add(house);
                        housePositions.push({ x: hx, y: hh, z: hz });
                        // Register house as a solid collider for the player
                        registerCollider(hx, hz, 5.5);

                        // Path removed to keep terrain natural
                    }
                }
            }

            // Spawn Villagers in plaza
            const numVillagers = 2 + Math.floor(Math.random() * 4);
            for (let v = 0; v < numVillagers; v++) {
                const vx = x + (Math.random() - 0.5) * plazaSize / 2;
                const vz = z + (Math.random() - 0.5) * plazaSize / 2;
                const villagerMesh = createVillager();
                activeEntities.push(new Entity(villagerMesh, vx, vz, 'villager'));
            }

            // Spawn 1-2 carrot patches near the plaza edge
            const numPatches = 1 + Math.floor(Math.random() * 2);
            for (let p = 0; p < numPatches; p++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = plazaSize / 2 + 5 + Math.random() * 8;
                const px = x + Math.cos(angle) * dist;
                const pz = z + Math.sin(angle) * dist;
                const ph = getMeshHeight(px, pz);
                if (ph > 0) {
                    const patch = createCarrotPatch();
                    patch.position.set(px, ph, pz);
                    patch.rotation.y = Math.random() * Math.PI * 2;
                    worldGroup.add(patch);
                    resources.push(patch);
                }
            }
        }
    }

    // Spawn 6 Epic Castles
    for (let i = 0; i < 6; i++) {
        const x = (Math.random() - 0.5) * WORLD_SIZE * 0.8;
        const z = (Math.random() - 0.5) * WORLD_SIZE * 0.8;

        // Fast height check
        const h = getMeshHeight(x, z);

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

            // Massive Central Keep (Using the new proper keep model)
            const keep = createCastleKeep();
            keep.rotation.y = Math.PI / 4; // Add a nice rotation to make it imposing
            castleGroup.add(keep);

            // 4 Corner Towers connected by walls
            const radius = 32;
            const angles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];

            angles.forEach((angle, idx) => {
                const tower = createCastleTower();
                tower.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
                castleGroup.add(tower);

                const wallLen = radius * Math.sqrt(2);
                const hasGate = (idx === 0); // Front wall has gatehouse
                const wall = createCastleWall(wallLen, hasGate);

                const nextAngle = angle + Math.PI / 2;
                const midX = (Math.cos(angle) + Math.cos(nextAngle)) * radius / 2;
                const midZ = (Math.sin(angle) + Math.sin(nextAngle)) * radius / 2;

                wall.position.set(midX, 0, midZ);
                wall.rotation.y = -angle - Math.PI / 4;
                castleGroup.add(wall);
            });

            castleGroup.traverse(child => { 
                child.matrixAutoUpdate = false; 
                child.updateMatrix(); 
                if (child.isMesh) child.castShadow = true;
            });
            castleGroup.matrixAutoUpdate = false;
            castleGroup.updateMatrix();
            worldGroup.add(castleGroup);
            collisionGroup.add(castleGroup.clone());
        }
    }
}

function createOakTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(SHARED_GEOS.oakTrunk, SHARED_MATS.oakTrunk);
    trunk.position.y = 1.25;
    trunk.castShadow = true;

    const leaves = new THREE.Mesh(SHARED_GEOS.oakLeaves, SHARED_MATS.oakLeaves);
    leaves.position.set(0, 3.5, 0);
    leaves.scale.set(1.1, 0.8, 1.1);
    leaves.castShadow = true;

    g.add(trunk, leaves);
    g.scale.set(3.5, 3.5, 3.5);
    return g;
}

function createBirchTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(SHARED_GEOS.birchTrunk, SHARED_MATS.birchTrunk);
    trunk.position.y = 1.75;
    trunk.castShadow = true;

    const leaves = new THREE.Mesh(SHARED_GEOS.birchLeaves, SHARED_MATS.birchLeaves);
    leaves.position.y = 4;
    leaves.castShadow = true;

    g.add(trunk, leaves);
    g.scale.set(3, 4, 3);
    return g;
}

const gridCellSize = 10;
const decorGrid = new Map();
let rockCount = 0;
let bushCount = 0;
const dummyObj = new THREE.Object3D();
const instColor = new THREE.Color();

function canPlace(x, z, radius) {
    if (radius === 0) return true; // grass can overlap
    const cx = Math.floor(x / gridCellSize);
    const cz = Math.floor(z / gridCellSize);
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            const key = `${cx + i},${cz + j}`;
            const cell = decorGrid.get(key);
            if (cell) {
                for (const item of cell) {
                    const dx = item.x - x;
                    const dz = item.z - z;
                    if (Math.sqrt(dx * dx + dz * dz) < (radius + item.r)) {
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
    if (!decorGrid.has(key)) decorGrid.set(key, []);
    decorGrid.get(key).push({ x, z, r: radius });
}

const rockGeo = new THREE.DodecahedronGeometry(1, 0);
const rockMat = new THREE.MeshStandardMaterial({ color: 0x757575, flatShading: true });
const rocksInstanced = new THREE.InstancedMesh(rockGeo, rockMat, 8000);
rocksInstanced.castShadow = true;
rocksInstanced.receiveShadow = true;

const bushGeo = new THREE.IcosahedronGeometry(1, 0);
const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
const bushesInstanced = new THREE.InstancedMesh(bushGeo, bushMat, 8000);
bushesInstanced.castShadow = false;
bushesInstanced.receiveShadow = false;

const DECOR_CHUNK_SIZE = 150;
const decorChunks = {};

function getDecorChunk(x, z) {
    const cx = Math.floor(x / DECOR_CHUNK_SIZE);
    const cz = Math.floor(z / DECOR_CHUNK_SIZE);
    const key = `${cx},${cz}`;
    if (!decorChunks[key]) {
        decorChunks[key] = new THREE.Group();
        decorChunks[key].matrixAutoUpdate = false;
        worldGroup.add(decorChunks[key]);
    }
    return decorChunks[key];
}

function createGrass(biomeType) {
    const g = new THREE.Group();
    
    let mat = SHARED_MATS.grassLush;
    if (biomeType === BIOMES.MAGIC) mat = SHARED_MATS.grassMagic;
    if (biomeType === BIOMES.GOLDEN) mat = SHARED_MATS.grassGolden;

    for(let i=0; i<3; i++) {
        const m = new THREE.Mesh(SHARED_GEOS.grassBlade, mat);
        m.rotation.y = (i/3) * Math.PI;
        m.position.y = 0.4;
        m.castShadow = false; // LAG FIX: No shadows for grass
        m.receiveShadow = false;
        g.add(m);
    }
    g.scale.set(2, 2.5, 2);
    return g;
}

function spawnDecorChunk(start, end) {
    for (let i = start; i < end; i++) {
        const x = (Math.random() - 0.5) * WORLD_SIZE;
        const z = (Math.random() - 0.5) * WORLD_SIZE;

        // Keep Capital City fully clear of wild decor and animals
        if (Math.hypot(x, z) < 125) continue;

        // Fast height check
        const h = getMeshHeight(x, z);
        const biome = getBiomeData(x, z);
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
        let radius = 2;
        const r = Math.random();

        const rChest = Math.random();
        if (rChest < 0.002) {
            if (canPlace(x, z, 2)) {
                const chest = createChest();
                chest.position.set(x, h + 0.1, z);
                chest.rotation.y = Math.random() * Math.PI * 2;
                worldGroup.add(chest);
                register(x, z, 2);
            }
            continue;
        }

        const forestNoise = noise2D(x * 0.006, z * 0.006);
        const isForest = forestNoise > 0.3;

        if (biome.type === BIOMES.LUSH) {
            if (isForest) {
                if (r < 0.15) { obj = createOakTree(); radius = 3.5; }
                else if (r < 0.25) { obj = createBirchTree(); radius = 3; }
                else if (r < 0.35) { obj = createOakTree(); radius = 2.5; }
                else if (r < 0.365) {
                    if (canPlace(x, z, 2)) {
                        const stagMesh = createStag();
                        activeEntities.push(new Entity(stagMesh, x, z, 'stag'));
                        register(x, z, 2);
                    }
                    continue;
                }
                else if (r < 0.370) {
                    if (canPlace(x, z, 2)) {
                        const boarMesh = createBoar();
                        activeEntities.push(new Entity(boarMesh, x, z, 'boar'));
                        register(x, z, 2);
                    }
                    continue;
                }
                else if (r < 0.375) {
                    if (canPlace(x, z, 3)) {
                        const bearMesh = createBear();
                        activeEntities.push(new Entity(bearMesh, x, z, 'bear'));
                        register(x, z, 3);
                    }
                    continue;
                }
                else if (r < 0.380) {
                    if (canPlace(x, z, 1)) {
                        const foxMesh = createFox();
                        activeEntities.push(new Entity(foxMesh, x, z, 'fox'));
                        register(x, z, 1);
                    }
                    continue;
                }
                else if (r < 0.390) {
                    if (canPlace(x, z, 1)) {
                        const rabbitMesh = createRabbit();
                        activeEntities.push(new Entity(rabbitMesh, x, z, 'rabbit'));
                        register(x, z, 1);
                    }
                    continue;
                }
                else if (r < 0.385) {
                    if (canPlace(x, z, 1)) {
                        const beeMesh = createBee();
                        const beeEnt = new Entity(beeMesh, x, z, 'bee');
                        beeEnt.pos.y += 2 + Math.random() * 2;
                        beeMesh.position.y = beeEnt.pos.y;
                        activeEntities.push(beeEnt);
                        register(x, z, 1);
                    }
                    continue;
                }
                else if (r < 0.395) { obj = createFallenLog(); radius = 3; }
                else if (r < 0.42) { isInstancedBush = true; bushBiome = BIOMES.LUSH; radius = 1.5; }
                else if (r < 0.9) { obj = createGrass(BIOMES.LUSH); radius = 0; }
            } else {
                if (r < 0.01) { obj = createOakTree(); radius = 3.5; }
                else if (r < 0.02) { obj = createBirchTree(); radius = 3; }
                else if (r < 0.03) { obj = createOakTree(); radius = 2.5; }
                else if (r < 0.035) {
                    // Spawn wild horse on lush plains
                    if (canPlace(x, z, 3)) {
                        const horseColor = [0x8b6914, 0x6d3a1a, 0x222222, 0xd2b48c, 0x8b0000][Math.floor(Math.random() * 5)];
                        const horseMesh = createHorse(horseColor);
                        activeEntities.push(new Entity(horseMesh, x, z, 'horse'));
                        register(x, z, 3);
                    }
                    continue;
                }
                else if (r < 0.15) { isInstancedBush = true; bushBiome = BIOMES.LUSH; radius = 1.5; }
                else if (r < 0.2) { isInstancedRock = true; radius = 2; }
                else if (r < 0.8) { obj = createGrass(BIOMES.LUSH); radius = 0; }
            }
        } else if (biome.type === BIOMES.MAGIC) {
            if (isForest) {
                if (r < 0.08) { obj = createFantasyTree(); radius = 3.5; }
                else if (r < 0.095) {
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
                else if (r < 0.025) {
                    if (canPlace(x, z, 2)) {
                        const wolfMesh = createShadowWolf();
                        activeEntities.push(new Entity(wolfMesh, x, z, 'wolf'));
                        register(x, z, 2);
                    }
                    continue;
                }
                else if (r < 0.018) {
                    if (canPlace(x, z, 10)) {
                        const tower = createRuinedTower();
                        // Spawn a chest inside the ruin!
                        const chest = createLootChest('common');
                        chest.position.set(x + (Math.random()-0.5)*4, h, z + (Math.random()-0.5)*4);
                        worldGroup.add(chest);
                        obj = tower;
                        radius = 10;
                    }
                }
                else if (r < 0.05) { isInstancedBush = true; bushBiome = BIOMES.MAGIC; radius = 1.5; }
                else if (r < 0.1) { isInstancedRock = true; radius = 2; }
                else if (r < 0.12) { obj = createAncientPillar(); radius = 2.5; }
                else if (r < 0.8) { obj = createGrass(BIOMES.MAGIC); radius = 0; }
            }
        } else if (biome.type === BIOMES.GOLDEN) {
            if (r < 0.04) { obj = createGoldenTree(); radius = 3.5; }
            else if (r < 0.048) {
                if (canPlace(x, z, 10)) {
                    const dragonMesh = createDragon();
                    const dragonEnt = new Entity(dragonMesh, x, z, 'dragon');
                    dragonEnt.pos.y = 80 + Math.random() * 40;
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
                else if (r < 0.085) {
                    if (canPlace(x, z, 15)) {
                        obj = createCrystalCave();
                        radius = 15;
                        // Rare chest deep in the cave!
                        const rareChest = createLootChest('rare');
                        rareChest.position.set(x, h, z - 8);
                        worldGroup.add(rareChest);
                    }
                }
                else if (r < 0.12) {
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
                dummyObj.position.set(x, h + size * 0.5, z);
                dummyObj.rotation.set(Math.random(), Math.random(), Math.random());
                dummyObj.scale.set(size, size * (0.6 + Math.random() * 0.4), size);
                dummyObj.updateMatrix();
                rocksInstanced.setMatrixAt(rockCount, dummyObj.matrix);
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
                dummyObj.position.set(x, h + size * 0.6, z);
                dummyObj.rotation.set(0, 0, 0);
                dummyObj.scale.set(size, size, size);
                dummyObj.updateMatrix();

                bushesInstanced.setMatrixAt(bushCount, dummyObj.matrix);
                bushesInstanced.setColorAt(bushCount, instColor);
                bushCount++;
                register(x, z, radius);
                if (radius >= 1.5) registerCollider(x, z, radius * 0.55);
            }
            continue;
        }

        if (obj && canPlace(x, z, radius)) {
            const sinkOffset = radius > 0 ? 0.4 : 0;
            obj.position.set(x, h - sinkOffset, z);

            // Tag resources for harvesting
            if (obj.userData.harvestType === undefined) {
                if (r < 0.5) {
                    obj.userData.harvestType = 'tree';
                    obj.userData.hp = 5;
                    obj.userData.maxHp = 5;
                } else {
                    obj.userData.harvestType = 'bush';
                    obj.userData.hp = 3;
                    obj.userData.maxHp = 3;
                }
            }

            obj.traverse(child => {
                child.matrixAutoUpdate = false;
                child.updateMatrix();
                child.updateMatrixWorld(true);
            });
            obj.matrixAutoUpdate = false;
            obj.updateMatrix();
            obj.updateMatrixWorld(true);
            getDecorChunk(x, z).add(obj);
            resources.push(obj);
            register(x, z, radius);
            if (radius >= 1.5) registerCollider(x, z, radius * 0.55);
        }
    }

    // Force world matrix update for instanced meshes too
    rocksInstanced.updateMatrixWorld(true);
    bushesInstanced.updateMatrixWorld(true);

    // Also tag instanced meshes (rocks)
    rocksInstanced.userData.harvestType = 'rock';
    bushesInstanced.userData.harvestType = 'bush';

    if (end >= 8000) {
        rocksInstanced.count = rockCount;
        worldGroup.add(rocksInstanced);
        bushesInstanced.count = bushCount;
        worldGroup.add(bushesInstanced);
    }
}

function spawnEpicFloatingIsland() {
    const mainGroup = new THREE.Group();
    // Relocated further back and to the side to avoid obstructing Capital City view
    mainGroup.position.set(550, 240, -750);

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
        new THREE.CylinderGeometry(mainRadius * 0.9, mainRadius, 4, 9),
        new THREE.MeshStandardMaterial({ color: 0x2a004f, flatShading: true })
    );
    mainGroup.add(top);

    for (let i = 0; i < 10; i++) {
        const tree = createFantasyTree();
        tree.scale.set(3, 3, 3);
        tree.position.set((Math.random() - 0.5) * mainRadius, 2, (Math.random() - 0.5) * mainRadius);
        mainGroup.add(tree);
    }
    const ruin = createAncientPillar();
    ruin.scale.set(3, 3, 3);
    ruin.position.set(0, 2, 0);
    mainGroup.add(ruin);

    scene.add(mainGroup);
    worldGroup.add(mainGroup);

    for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const dist = mainRadius + 30 + Math.random() * 20;
        const satGroup = new THREE.Group();
        // Position relative to mainGroup now
        satGroup.position.set(Math.cos(angle) * dist, (Math.random() - 0.5) * 20, Math.sin(angle) * dist);

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
            new THREE.CylinderGeometry(satRad * 0.9, satRad, 2, 7),
            new THREE.MeshStandardMaterial({ color: 0x2a004f, flatShading: true })
        );
        satGroup.add(sTop);

        if (Math.random() > 0.5) {
            const tree = createFantasyTree();
            tree.scale.set(1.5, 1.5, 1.5);
            tree.position.set(0, 1, 0);
            satGroup.add(tree);
        }
        mainGroup.add(satGroup);
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
    const lcBar = document.getElementById('lc-bar');
    const lcPct = document.getElementById('lc-progress-pct');
    const lcStory = document.getElementById('lc-story-text');
    const lrBar = document.getElementById('lr-bar');
    const lrPct = document.getElementById('lr-pct');
    const lrTip = document.getElementById('lr-tip');
    const slides = document.querySelectorAll('.lr-slide');

    function hide(el) { if (el) { el.style.opacity = '0'; setTimeout(() => el.classList.add('hidden'), 1200); } }
    function show(el) { if (el) { el.classList.remove('hidden'); } }

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
            p.style.animationDelay = (Math.random() * 5) + 's';
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
        const TOTAL_ITERS = 15000;
        let iter = 0;

        // We need access to spawnDecor internals — so we refactor the progress
        // into a wrapper that calls spawnDecorChunked()
        const phase1Weight = 0.70; // 70% of bar
        const phase2Weight = 0.15;
        const phase3Weight = 0.15;

        function doPhase1() {
            // Run CHUNK iterations of the decor loop in each slice
            const end = Math.min(iter + CHUNK, TOTAL_ITERS);

            spawnDecorChunk(iter, end);

            iter = end;
            const progress = (iter / TOTAL_ITERS) * phase1Weight * 100;
            setProgress(progress);

            if (iter < TOTAL_ITERS) {
                requestAnimationFrame(doPhase1);
            } else {
                requestAnimationFrame(doPhase2);
            }
        }

        function doPhase2() {
            spawnEpicFloatingIsland();
            setProgress((phase1Weight + phase2Weight) * 100);
            requestAnimationFrame(doPhase3);
        }

        function doPhase3() {
            spawnCapitalCity();
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
        if (lcStory) {
            lcStory.textContent = 'A world long forgotten stirs from its slumber...';
        }

        let storyIdx = 0;
        const storyTimer = setInterval(() => {
            storyIdx = (storyIdx + 1) % STORY_LINES.length;
            if (lcStory) {
                lcStory.textContent = STORY_LINES[storyIdx];
            }
        }, 2800);

        const startTime = Date.now();
        generateWorldAsync(() => {
            const elapsed = Date.now() - startTime;
            const minTime = 4000; // Minimum 4 seconds to read intro text
            const remaining = Math.max(0, minTime - elapsed);

            setTimeout(() => {
                clearInterval(storyTimer);
                if (window.speechSynthesis) window.speechSynthesis.cancel();
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
        img: `${import.meta.env.BASE_URL}cutscene_forest.png`,
        lines: [
            'A lone wanderer steps into the ancient forest of Eldoria...',
            'Trees older than memory tower overhead.',
            'Something stirs in the shadows between the roots.'
        ]
    },
    {
        location: 'THE MOUNTAIN PASS',
        img: `${import.meta.env.BASE_URL}cutscene_golem.png`,
        lines: [
            'From the mountain passes, ancient guardians awaken.',
            'Crystal and stone, bound together by forgotten magic.',
            'They have waited centuries for an intruder to appear.'
        ]
    },
    {
        location: 'THE GOLDEN PLAINS — HIGH ABOVE',
        img: `${import.meta.env.BASE_URL}cutscene_dragon.png`,
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
    skipBtn.onmouseenter = () => { skipBtn.style.color = '#fff'; skipBtn.style.background = 'rgba(255,255,255,0.15)'; skipBtn.style.borderColor = 'rgba(255,255,255,0.6)'; };
    skipBtn.onmouseleave = () => { skipBtn.style.color = 'rgba(255,255,255,0.5)'; skipBtn.style.background = 'rgba(255,255,255,0.05)'; skipBtn.style.borderColor = 'rgba(255,255,255,0.2)'; };

    cs.append(bg, vig, barTop, barBot, locationEl, subBar, titleCard, skipBtn);
    document.body.appendChild(cs);

    let sceneIdx = 0;
    let lineIdx = 0;
    let typeTimer = null;
    let sceneTimer = null;
    let exiting = false;

    function typeText(text, el, onDone) {
        if (exiting) return;
        clearInterval(typeTimer);
        narrate(text); // Start narrating the full line immediately
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
        if (window.speechSynthesis) window.speechSynthesis.cancel();

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
        if (exiting) return;
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

    if (isPaused) return;

    // Update Ambient Audio (Only if game is active)
    if (gameStarted && audioCtx && ambientWind) {
        const heightFactor = THREE.MathUtils.clamp((state.pos.y + 20) / 150, 0, 1);
        ambientWind.filter.frequency.setTargetAtTime(300 + heightFactor * 800, audioCtx.currentTime, 0.5);
        ambientWind.gain.gain.setTargetAtTime(0.005 + heightFactor * 0.03, audioCtx.currentTime, 0.5);
    }

    // --- FISH POPULATION CONTROL ---
    const spawnInterval = 8;
    const timeBucket = Math.floor(time / spawnInterval);
    if (gameStarted && timeBucket !== state.lastSpawnBucket) {
        state.lastSpawnBucket = timeBucket;
        const fishCount = activeEntities.filter(e => e.type === 'fish').length;
        if (fishCount < 20) {
            const h = getMeshHeight(state.pos.x, state.pos.z);
            if (h < WATER_LEVEL + 2) {
                for (let i = 0; i < 5; i++) {
                    spawnFish(state.pos.x + (Math.random() - 0.5) * 30, state.pos.z + (Math.random() - 0.5) * 30);
                }
            }
        }
    }

    // --- DEAD BODY PHYSICS ---
    if (deadParts.length > 0) {
        deadParts.forEach(part => {
            part.vel.y -= 25 * dt; // Gravity for parts
            part.mesh.position.add(part.vel.clone().multiplyScalar(dt));
            part.mesh.rotation.x += part.rotVel.x;
            part.mesh.rotation.y += part.rotVel.y;
            part.mesh.rotation.z += part.rotVel.z;

            // Bounce off ground
            const groundH = getMeshHeight(part.mesh.position.x, part.mesh.position.z);
            if (part.mesh.position.y < groundH) {
                part.mesh.position.y = groundH;
                part.vel.y *= -0.4; // Bounce loss
                part.vel.x *= 0.8;
                part.vel.z *= 0.8;
                part.rotVel.multiplyScalar(0.8);
            }
        });
    }

    // --- DEBRIS PHYSICS ---
    for (let i = activeDebris.length - 1; i >= 0; i--) {
        const d = activeDebris[i];
        d.life -= dt;
        if (d.life <= 0) {
            scene.remove(d.mesh);
            activeDebris.splice(i, 1);
            continue;
        }
        d.vel.y -= 25 * dt;
        d.mesh.position.add(d.vel.clone().multiplyScalar(dt));
        d.mesh.rotation.x += d.rot.x;
        d.mesh.rotation.y += d.rot.y;

        const ground = getMeshHeight(d.mesh.position.x, d.mesh.position.z);
        if (d.mesh.position.y < ground) {
            d.mesh.position.y = ground;
            d.vel.y *= -0.3;
            d.vel.x *= 0.8;
            d.vel.z *= 0.8;
        }
    }

    // --- SMART CROSSHAIR LOGIC ---
    const crosshair = document.getElementById('crosshair');
    if (crosshair) {
        if (gameStarted && !isPaused && !isInventoryOpen) {
            crosshair.classList.remove('hidden');
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            const origin = new THREE.Vector3();
            camera.getWorldPosition(origin);
            const ray = new THREE.Raycaster(origin, dir, 0, 30);
            const hits = ray.intersectObjects([worldGroup, rocksInstanced, bushesInstanced], true);

            let found = false;
            for (const h of hits) {
                if (h.object === terrain || h.object === water) continue;
                let p = h.object;
                while (p && p !== scene) {
                    if (p.userData && p.userData.harvestType) {
                        found = true;
                        break;
                    }
                    p = p.parent;
                }
                if (found) break;
            }
            crosshair.style.backgroundColor = found ? '#ffd54f' : 'white';
            crosshair.style.transform = found ? 'translate(-50%, -50%) scale(1.5)' : 'translate(-50%, -50%) scale(1)';
            crosshair.style.boxShadow = found ? '0 0 10px #ffd54f' : 'none';
        } else {
            crosshair.classList.add('hidden');
        }
    }

    // --- TREE FALLING ANIMATION ---
    resources.forEach(res => {
        if (res.userData.isFalling) {
            res.userData.fallAngle = (res.userData.fallAngle || 0) + dt * 2.0;
            res.rotation.z = res.userData.fallAngle;
            // Force matrix update since matrixAutoUpdate is false
            res.updateMatrix();
            res.updateMatrixWorld(true);

            // Sink a bit
            res.position.y -= dt * 3;
            if (res.userData.fallAngle > Math.PI / 2) {
                res.visible = false;
                res.userData.isFalling = false;
                res.position.y = -1000;
            }
        }
    });

    if (gameStarted && !isInventoryOpen && !state.isDead) {
        // Auto-kill if HP reaches 0
        if (state.health <= 0) {
            die();
            return;
        }

        player.rotation.y = yaw;

        const moveDir = new THREE.Vector3();
        if (keys[currentBinds.forward]) moveDir.z += 1; // Forward
        if (keys[currentBinds.backward]) moveDir.z -= 1; // Backward
        if (keys[currentBinds.left]) moveDir.x += 1; // Strafe left
        if (keys[currentBinds.right]) moveDir.x -= 1; // Strafe right

        // RIDING — if mounted, use higher speed and attach horse to player
        if (state.mounted) {
            const rideSpeed = keys[currentBinds.sprint] ? 45 : 28; // Much faster on horseback
            const isMoving = moveDir.length() > 0;
            if (isMoving) {
                moveDir.normalize().applyQuaternion(player.quaternion);
                state.pos.add(moveDir.multiplyScalar(rideSpeed * dt));
                state.pos.x = THREE.MathUtils.clamp(state.pos.x, -WORLD_BORDER, WORLD_BORDER);
                state.pos.z = THREE.MathUtils.clamp(state.pos.z, -WORLD_BORDER, WORLD_BORDER);
                resolveCollisions(state.pos);
                walkCycle += dt * (rideSpeed / 1.5);
            } else {
                walkCycle = 0;
            }

            // Snap horse body below/behind player
            const horseEnt = state.mounted;
            horseEnt.pos.set(state.pos.x, state.pos.y - 0.5, state.pos.z);
            horseEnt.mesh.position.copy(horseEnt.pos);
            horseEnt.mesh.rotation.y = yaw;

            // Animate horse legs while riding
            const rideLimbSwing = Math.sin(walkCycle) * 0.8;
            const rl = horseEnt.mesh.userData.limbs;
            if (rl) {
                rl.fl.rotation.x = -rideLimbSwing;
                rl.fr.rotation.x = rideLimbSwing;
                rl.bl.rotation.x = rideLimbSwing;
                rl.br.rotation.x = -rideLimbSwing;
            }

            // Dismount with Shift (double-tap or hold while pressing a direction key while idle)
            if (keys[currentBinds.sprint] && !keys[currentBinds.forward] && !keys[currentBinds.backward] && !keys[currentBinds.left] && !keys[currentBinds.right]) {
                // Dismount: place horse next to player
                state.mounted = null;
                spawnResourcePop(state.pos, '🐴 Dismounted');
                // Slightly offset the horse so it\'s beside the player
                horseEnt.pos.x += Math.sin(yaw + Math.PI / 2) * 3;
                horseEnt.pos.z += Math.cos(yaw + Math.PI / 2) * 3;
                horseEnt.mesh.position.copy(horseEnt.pos);
            }

        } else {
            const speed = keys[currentBinds.sprint] ? 25 : 12;
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

            if (keys[currentBinds.jump] && state.isGrounded) {
                state.velY = 15;
                state.isGrounded = false;
            }
        }
    } else if (isInventoryOpen) {
        walkCycle = 0;
        // Player stands still in the main world while inventory is open.
        // The rotation is now handled by uiPlayer in the animate() loop.
    } else {
        walkCycle = 0;
    }

    // --- HORSE MOUNT PROMPT ---
    if (gameStarted && !state.mounted) {
        let nearHorse = null;
        let nearHorseDist = 6;
        for (const ent of activeEntities) {
            if (ent.type === 'horse' && ent.mesh.userData.isTamed) {
                const d = ent.pos.distanceTo(state.pos);
                if (d < nearHorseDist) {
                    nearHorseDist = d;
                    nearHorse = ent;
                }
            }
        }
        const mountPrompt = document.getElementById('mount-prompt');
        if (mountPrompt) {
            if (nearHorse) {
                mountPrompt.classList.remove('hidden');
            } else {
                mountPrompt.classList.add('hidden');
            }
        }
    } else {
        const mountPrompt = document.getElementById('mount-prompt');
        if (mountPrompt) mountPrompt.classList.add('hidden');
    }

    // Update Entities & UI Overlays
    if (gameStarted) {
        const frameSkip = frameCount % 3 === 0; // Low-frequency update trigger

        activeEntities.forEach(ent => {
            const dist = ent.pos.distanceTo(player.position);

            // 1. HARD CULLING (Visibility & UI)
            if (dist > 250) {
                ent.mesh.visible = false;
                if (ent.hpBarEl) {
                    ent.hpBarEl.style.display = 'none';
                    ent.hpBarEl.style.opacity = '0';
                }
                return;
            }

            ent.mesh.visible = true;

            // 2. LOGIC OPTIMIZATION (AI & Movement)
            // Skip AI entirely if very far
            if (dist > 160 && ent.type !== 'dragon') {
                if (ent.hpBarEl) ent.hpBarEl.style.display = 'none';
                return;
            }

            // Low-frequency updates for moderately far entities
            const isLowFreq = dist > 80;
            if (isLowFreq && !frameSkip && ent.type !== 'dragon') {
                // Keep health bars updated even on skipped logic frames for smoothness
                if (ent.showHealthTimer > 0) updateEntityHealthBar(ent, dt);
                return;
            }

            ent.update(dt, player.position, isLowFreq);

            // 3. HEALTH BAR LOGIC
            if (ent.showHealthTimer > 0) {
                updateEntityHealthBar(ent, dt);
            }
        });

        // NPC Interact Prompt — check closest villager within 10 units
        if (!dialogOpen) {
            let closestVillager = null;
            let closestDist = 10;
            for (const ent of activeEntities) {
                if (ent.type === 'villager' || ent.type === 'knight') {
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
                const scale = 1.0 + (1.0 - dmg.life / dmg.maxLife) * 0.5;
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

    if (gameStarted && attackAnim > 0) {
        // SWING ANIMATION (Priority)
        const progress = 1.0 - (attackAnim / 0.5);
        const swing = Math.sin(progress * Math.PI) * 2.2; // Much bigger swing
        rightArm.rotation.x = -1.5 + swing;
        leftArm.rotation.x = 0;
    } else if (gameStarted && walkCycle > 0 && state.isGrounded) {
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

    // Override right arm for attack animation - REMOVED (Conflicting with main swing animation)

    // --- WATER & SWIMMING PHYSICS ---
    const waterLevel = -10;
    const isSwimming = state.pos.y < waterLevel - 0.5; // True if body is submerged
    const headSubmerged = state.pos.y < waterLevel - 1.6; // True if head is submerged

    if (isSwimming) {
        state.velY -= 8 * dt; // Much lower gravity in water (buoyancy)
        state.velY *= 0.95;    // Water drag

        // Swim UP using Space
        if (keys[currentBinds.jump]) {
            state.velY += 12 * dt;
            if (state.velY > 4) state.velY = 4; // Cap upward swim speed
        }
    } else {
        state.velY -= 35 * dt; // Normal Gravity
    }

    state.pos.y += state.velY * dt;

    // Raycast DOWN from slightly above the player to find the VISUAL ground
    const rayOrigin = new THREE.Vector3(state.pos.x, Math.max(state.pos.y, waterLevel) + 5, state.pos.z);
    const rayDir = new THREE.Vector3(0, -1, 0);
    const groundRaycaster = new THREE.Raycaster(rayOrigin, rayDir, 0, 40);
    const groundHits = groundRaycaster.intersectObject(terrain, false);

    let groundHeight = -100;
    if (groundHits.length > 0) {
        groundHeight = groundHits[0].point.y;
    } else {
        groundHeight = getTerrainHeight(state.pos.x, state.pos.z);
    }

    // Collision Response
    if (state.pos.y <= groundHeight) {
        state.pos.y = groundHeight;
        state.velY = 0;
        state.isGrounded = true;
    } else {
        state.isGrounded = false;
    }

    // --- OXYGEN & DROWNING ---
    const oxygenContainer = document.getElementById('oxygen-container');
    const oxygenBar = document.getElementById('oxygen-bar');

    if (headSubmerged) {
        state.oxygen -= 15 * dt; // Lose oxygen in ~7 seconds
        if (oxygenContainer) oxygenContainer.classList.remove('hidden');
    } else {
        state.oxygen += 40 * dt; // Recover oxygen quickly
        if (state.oxygen >= 100) {
            state.oxygen = 100;
            if (oxygenContainer) oxygenContainer.classList.add('hidden');
        }
    }

    state.oxygen = Math.max(0, state.oxygen);
    if (oxygenBar) oxygenBar.style.width = state.oxygen + '%';

    // Drowning Damage
    if (state.oxygen <= 0) {
        state.health -= 15 * dt; // Take damage every second
        if (oxygenContainer) oxygenContainer.classList.add('low-oxygen');
    } else {
        if (oxygenContainer) oxygenContainer.classList.remove('low-oxygen');
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

        sun.position.set(player.position.x + 100, player.position.y + sunY * 200, player.position.z + sunZ * 200);
        sun.target.position.copy(player.position);

        if (sunY > 0) {
            let intensity = Math.min(sunY * 2, 1);
            sun.intensity = 1.6 * intensity;
            ambientLight.intensity = 0.4 + (0.3 * intensity);

            if (sunY < 0.3) {
                let blend = sunY / 0.3;
                sun.color.setHex(0xffaa00).lerp(new THREE.Color(0xfff0dd), blend);
                scene.background.setHex(0xff7700).lerp(new THREE.Color(0xffcca8), blend);
                scene.fog.color.copy(scene.background);
                starsMat.opacity = 1.0 - (sunY / 0.3); // Stars fade in during sunset
            } else {
                sun.color.setHex(0xfff0dd);
                let blend = (sunY - 0.3) / 0.7;
                scene.background.setHex(0xffcca8).lerp(new THREE.Color(0x87ceeb), blend);
                scene.fog.color.copy(scene.background);
                starsMat.opacity = 0;
            }
        } else {
            sun.intensity = 0;
            ambientLight.intensity = 0.2;
            scene.background.setHex(0x050510);
            scene.fog.color.copy(scene.background);
            starsMat.opacity = 1.0;
        }

        // Rotate stars slowly
        stars.rotation.y += dt * 0.02;
        stars.position.copy(player.position); // Stars follow player so they never run out

        // Animate fireflies
        const isNight = sunY < 0.1;
        firefliesMat.opacity = isNight ? 0.8 : 0;
        if (isNight) {
            const positions = firefliesGeo.attributes.position.array;
            for(let i=0; i<positions.length; i+=3) {
                positions[i+1] += Math.sin(time*0.001 + i) * dt * 0.5; // Hover
                positions[i] += Math.cos(time*0.0005 + i) * dt * 0.5; // Swirl
                positions[i+2] += Math.sin(time*0.0007 + i) * dt * 0.5;
                
                // Wrap around player
                if (positions[i] > player.position.x + 150) positions[i] -= 300;
                if (positions[i] < player.position.x - 150) positions[i] += 300;
                if (positions[i+2] > player.position.z + 150) positions[i+2] -= 300;
                if (positions[i+2] < player.position.z - 150) positions[i+2] += 300;
            }
            firefliesGeo.attributes.position.needsUpdate = true;
        }
    } else {
        if (isCustomizing) {
            scene.background = new THREE.Color(0x111118); // Dark cinematic studio background
            sun.position.set(player.position.x - 2, player.position.y + 3, player.position.z + 5);
            sun.target.position.copy(player.position);
            sun.intensity = 3.0; // Dramatic top-down spotlight
            ambientLight.intensity = 1.0; // Brighter ambient to see colors clearly
        } else {
            scene.background = menuBgTexture;
            sun.position.set(100, 100, 100);
            sun.intensity = 1.2;
            ambientLight.intensity = 0.8;
        }
        starsMat.opacity = 0;
        firefliesMat.opacity = 0;
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
        // PERFORMANCE FIX: Only raycast against collisionGroup + terrain
        const intersects = raycaster.intersectObjects([collisionGroup, terrain], true);

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
            cameraPivot.rotation.set(0, Math.PI - player.rotation.y, 0); // Counter-rotate so camera stays fixed in world while character spins
            camera.position.lerp(new THREE.Vector3(-1.5, 1.5, -3.5), 0.1);
            
            // Look directly to the left of the player's static world position
            camera.lookAt(player.position.x - 1.5, player.position.y + 1.5, player.position.z);
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

    // Update ground cracks
    for(let i = activeCracks.length - 1; i >= 0; i--) {
        const c = activeCracks[i];
        c.timer -= dt;
        if (c.timer < 2.0) {
            c.mesh.material.opacity = (c.timer / 2.0) * 0.8;
        }
        if (c.timer <= 0) {
            worldGroup.remove(c.mesh);
            c.mesh.material.dispose();
            c.mesh.material.map.dispose();
            c.mesh.geometry.dispose();
            activeCracks.splice(i, 1);
        }
    }
}

let frameCount = 0;

function updateEntityHealthBar(ent, dt) {
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

function animate() {
    frameCount++;
    requestAnimationFrame(animate);
    const time = performance.now();
    const dt = Math.min(time - lastTime, 100) / 1000;
    lastTime = time;
    update(dt);

    // Dynamic Rendering System (Chunk Culling)
    if (gameStarted && !isPaused) {
        const cx = Math.floor(player.position.x / DECOR_CHUNK_SIZE);
        const cz = Math.floor(player.position.z / DECOR_CHUNK_SIZE);
        const RENDER_DIST = 1.5; // Reduced from 3 to drastically cut draw calls
        
        for (const key in decorChunks) {
            const [kx, kz] = key.split(',').map(Number);
            if (Math.hypot(kx - cx, kz - cz) <= RENDER_DIST) {
                decorChunks[key].visible = true;
            } else {
                decorChunks[key].visible = false;
            }
        }
    }

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

            // Look at mouse
            uiPlayer.rotation.y = mouseX * 1.5;
            uiPlayer.rotation.x = -mouseY * 0.5;

            renderer.clearDepth(); // render on top of existing main scene output
            renderer.render(uiScene, uiCamera);
            renderer.setScissorTest(false);
        }
    }

    // 3. Animate water waves via GPU shader
    if (waterMat.userData.shader) {
        waterMat.userData.shader.uniforms.time.value = time * 0.001;
    }
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- M1 COMBAT SYSTEM ---
// --- CRAFTING & TOOLS ---
const CRAFTING_RECIPES = {
    wooden_pickaxe: { name: 'Wooden Pickaxe', cost: { wood: 5, stick: 3 }, type: 'tool' },
    stone_pickaxe: { name: 'Stone Pickaxe', cost: { stone: 5, stick: 3 }, type: 'tool' },
    wooden_sword: { name: 'Wooden Sword', cost: { wood: 7 }, type: 'weapon' },
    stone_sword: { name: 'Stone Sword', cost: { stone: 5, wood: 2 }, type: 'weapon' },
    medkit: { name: 'Berry Poultice', cost: { berry: 10, hide: 1 }, type: 'heal' },
    campfire: { name: 'Campfire', cost: { wood: 5, stone: 3 }, type: 'build' },
    wall: { name: 'Wood Wall', cost: { wood: 6 }, type: 'build' },
    roof: { name: 'Thatch Roof', cost: { wood: 4, stick: 4 }, type: 'build' },
    torch: { name: 'Torch', cost: { stick: 2, coal: 1 }, type: 'build' }
};

function updateCraftingUI() {
    const craftList = document.getElementById('crafting-list');
    if (!craftList) return;

    craftList.innerHTML = '';
    for (const [id, recipe] of Object.entries(CRAFTING_RECIPES)) {
        const canCraft = Object.entries(recipe.cost).every(([res, amt]) => (state.inventory[res] || 0) >= amt);

        const btn = document.createElement('button');
        btn.className = 'craft-btn';
        btn.disabled = !canCraft;

        let costText = Object.entries(recipe.cost).map(([res, amt]) => `${amt} ${res}`).join(', ');
        btn.innerHTML = `<span>${recipe.name}</span> <span class="recipe-req">${costText}</span>`;

        btn.onclick = () => craftItem(id);
        craftList.appendChild(btn);
    }
}

function craftItem(id) {
    const recipe = CRAFTING_RECIPES[id];
    if (!recipe) return;

    // Deduct resources
    for (const [res, amt] of Object.entries(recipe.cost)) {
        state.inventory[res] -= amt;
    }

    // Apply effect
    if (recipe.type === 'tool' || recipe.type === 'weapon') {
        state.inventory[id] = (state.inventory[id] || 0) + 1;
        spawnResourcePop(player.position, `Crafted: ${recipe.name}! Check your Bag [B]`);
    } else if (recipe.type === 'heal') {
        state.health = Math.min(100, state.health + 40);
        spawnResourcePop(player.position, `Used: ${recipe.name}!`);
    } else if (recipe.type === 'build') {
        let buildObj = null;
        if (id === 'campfire') {
            buildObj = createCampfire();
            // Track campfires so Wendigo AI can fear them
            const px = player.position.x - Math.sin(player.rotation.y) * 4;
            const pz = player.position.z - Math.cos(player.rotation.y) * 4;
            activeCampfires.push(new THREE.Vector3(px, 0, pz));
        } else if (id === 'wall') {
            buildObj = createWall();
        } else if (id === 'roof') {
            buildObj = createRoof();
        } else if (id === 'torch') {
            buildObj = createTorch();
        }

        if (buildObj) {
            const px = player.position.x - Math.sin(player.rotation.y) * 4;
            const pz = player.position.z - Math.cos(player.rotation.y) * 4;
            buildObj.position.set(px, getTerrainHeight(px, pz), pz);
            buildObj.rotation.y = player.rotation.y;
            worldGroup.add(buildObj);
            spawnResourcePop(player.position, `Built ${recipe.name}!`);
        }
    }

    updateInventoryUI();
    updateCraftingUI();
}

function equipItem(id) {
    if (state.inventory[id] > 0) {
        // If already equipped, unequip it
        if (state.equips.weapon === id) {
            unequipItem();
        } else {
            state.equips.weapon = id;
            const icon = id.includes('pickaxe') ? '⛏️' : (id.includes('sword') ? '⚔️' : '');
            let shortName = id.replace('_', '\n');
            document.getElementById('weapon-slot').innerHTML = `<span style="font-size:2rem; margin-bottom:5px;">${icon}</span><span class="slot-label" style="text-align:center;">${shortName.toUpperCase()}</span>`;
            updateHeldItem();
            updateInventoryUI();
            spawnResourcePop(player.position, `Equipped: ${id.toUpperCase()}`);
        }
    }
}

function unequipItem() {
    state.equips.weapon = null;
    const slot = document.getElementById('weapon-slot');
    if (slot) slot.innerHTML = `<span class="slot-label">WEAPON</span>`;
    updateHeldItem();
    updateInventoryUI();
    spawnResourcePop(player.position, `Holstered Tool`);
}

window.unequipItem = unequipItem; // Expose to HTML

function updateHeldItem() {
    const hand = player.userData.handGroup;
    if (!hand) return;

    hand.clear();
    const weaponId = state.equips.weapon;
    if (weaponId === 'wooden_pickaxe') {
        hand.add(createPickaxe('wood'));
    } else if (weaponId === 'stone_pickaxe') {
        hand.add(createPickaxe('stone'));
    } else if (weaponId === 'wooden_sword') {
        hand.add(createSword('wood'));
    } else if (weaponId === 'stone_sword') {
        hand.add(createSword('stone'));
    }
}

function getAttackDamage() {
    if (state.equips.weapon === 'stone_sword') return 50;
    if (state.equips.weapon === 'wooden_sword') return 30;
    if (state.equips.weapon === 'stone_pickaxe') return 25;
    if (state.equips.weapon === 'wooden_pickaxe') return 15;
    return 20; // Punch
}

window.addEventListener('mousedown', (e) => {
    // M1 = left click (button 0)
    if (e.button !== 0 || !gameStarted || isPaused || isInventoryOpen) return;
    if (attackCooldown > 0) return;
    attackCooldown = 0.6; // 0.6s between swings
    attackAnim = 0.5; // Longer, more visible animation duration

    // Raycast from CAMERA forward for pixel-perfect aim
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);

    const raycaster = new THREE.Raycaster(origin, dir, 0, 30);

    // Check all entity meshes
    let hit = false;
    const currentDmg = getAttackDamage();

    for (let i = activeEntities.length - 1; i >= 0; i--) {
        const ent = activeEntities[i];
        if (!ent.mesh.userData.hp) continue;

        const meshes = [];
        ent.mesh.traverse(child => { if (child.isMesh) meshes.push(child); });
        const intersects = raycaster.intersectObjects(meshes, false);

        if (intersects.length > 0) {
            // --- HORSE TAMING LOGIC ---
            if (ent.type === 'horse' && !ent.mesh.userData.isTamed) {
                if (state.inventory.carrot > 0) {
                    state.inventory.carrot--;
                    ent.mesh.userData.isTamed = true;
                    spawnResourcePop(ent.pos, '🐴 Horse Tamed! Press [E] to Mount');
                    // Spawn heart particles using damage number system
                    for (let h = 0; h < 3; h++) {
                        setTimeout(() => spawnDamageNumber(ent.pos.x, ent.pos.y + 2 + h, ent.pos.z, '❤️', false), h * 300);
                    }
                    updateInventoryUI();
                    hit = true;
                } else {
                    spawnResourcePop(state.pos, '🥕 Need a Carrot to tame!');
                    hit = true;
                }
                break;
            }

            ent.mesh.userData.hp -= currentDmg;
            ent.showHealthTimer = 5.0; // Show health bar for 5 seconds
            spawnDamageNumber(ent.pos.x, ent.pos.y + 2, ent.pos.z, currentDmg, true);

            showHitFlash();
            hit = true;
            
            // Retaliation aggro
            ent.isAggro = true;

            // Knock entity back slightly
            const knockDir = new THREE.Vector3().subVectors(ent.pos, state.pos).normalize();
            ent.pos.add(knockDir.multiplyScalar(3));

            if (ent.mesh.userData.hp <= 0) {
                // If this entity was mounted, dismount first
                if (state.mounted === ent) state.mounted = null;

                // Drop resources from animals
                if (ent.type === 'stag') {
                    addResource('meat', 2);
                    addResource('hide', 1);
                } else if (ent.type === 'bear') {
                    addResource('meat', 4);
                    addResource('hide', 3);
                } else if (ent.type === 'wolf') {
                    addResource('hide', 1);
                } else if (ent.type === 'boar') {
                    addResource('meat', 3);
                    addResource('hide', 2);
                } else if (ent.type === 'fox') {
                    addResource('meat', 1);
                    addResource('hide', 1);
                } else if (ent.type === 'rabbit') {
                    addResource('meat', 1);
                } else if (ent.type === 'wendigo') {
                    // Rare, valuable Wendigo drops
                    addResource('hide', 5);
                    addResource('bone', 3);
                    addResource('dark_essence', 1);
                    state.xp += 150; // Big XP bonus
                    spawnDamageNumber(ent.pos.x, ent.pos.y + 5, ent.pos.z, '✨ WENDIGO SLAIN! +150 XP', false);
                    spawnResourcePop(player.position, '🌑 Dark Essence obtained!');
                }

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

    // --- RESOURCE HARVESTING ---
    if (!hit) {
        // PERFORMANCE FIX: Only raycast against worldGroup (but not its children unless harvestType exists)
        // or specifically against harvestable instanced meshes
        const intersects = raycaster.intersectObjects([worldGroup, rocksInstanced, bushesInstanced], true);

        // Find the FIRST object that has a harvestType (ignoring terrain)
        // Find the FIRST object that has a harvestType (ignoring terrain)
        let harvestTarget = null;
        let intersectPoint = null;

        for (const intersect of intersects) {
            let t = intersect.object;
            if (t === terrain || t === water) continue; // Skip terrain and water!

            // Direct check on object or traverse UP to find the root tagged group
            let current = t;
            while (current && current !== scene) {
                if (current.userData && current.userData.harvestType) {
                    harvestTarget = current;
                    intersectPoint = intersect.point;
                    break;
                }
                current = current.parent;
            }
            if (harvestTarget) break;
        }

        if (harvestTarget && !harvestTarget.userData.isFalling) {
            const type = harvestTarget.userData.harvestType;
            const isInstanced = harvestTarget.isInstancedMesh;
            const instanceId = isInstanced ? intersects.find(i => i.object === harvestTarget).instanceId : null;
            const healthKey = isInstanced ? `${harvestTarget.uuid}_${instanceId}` : null;

            // Resource Health System
            if (isInstanced) {
                if (!state.instanceHealth.has(healthKey)) state.instanceHealth.set(healthKey, 3);
                let currentHp = state.instanceHealth.get(healthKey);
                if (currentHp <= 0) return; // ALREADY BROKEN
                currentHp--;
                state.instanceHealth.set(healthKey, currentHp);

                if (type === 'rock' && (!state.equips.weapon || !state.equips.weapon.includes('pickaxe'))) {
                    spawnResourcePop(intersectPoint, 'Need Pickaxe!');
                    state.instanceHealth.set(healthKey, currentHp + 1); // Refund HP
                    return;
                }

                if (currentHp <= 0) {
                    // Hide the instance by moving it under the world
                    const mat = new THREE.Matrix4();
                    harvestTarget.setMatrixAt(instanceId, mat.makeTranslation(0, -1000, 0));
                    harvestTarget.instanceMatrix.needsUpdate = true;

                    if (type === 'rock') {
                        addResource('stone', 3);
                        spawnResourcePop(intersectPoint, 'ROCK BROKEN! +3 Stone');
                        spawnDebris(intersectPoint, 0x757575, 10);
                        playSound('hit_rock', 0.5);
                    } else {
                        addResource('berry', 2);
                        spawnResourcePop(intersectPoint, 'BUSH CLEARED!');
                        spawnDebris(intersectPoint, 0x2e7d32, 5);
                        playSound('hit_wood', 0.5);
                    }
                } else {
                    if (type === 'rock') {
                        addResource('stone', 1);
                        spawnResourcePop(intersectPoint, `Stone ${currentHp}/3`);
                        playSound('hit_rock', 1.0 + Math.random() * 0.2);
                    } else {
                        addResource('berry', 1);
                        spawnResourcePop(intersectPoint, `Berry ${currentHp}/3`);
                        playSound('hit_wood', 1.0 + Math.random() * 0.2);
                    }
                }
            } else {
                // Individual Group (Trees/Large Bushes)
                if (harvestTarget.userData.hp === undefined) {
                    harvestTarget.userData.hp = (type === 'tree') ? 5 : 3;
                }
                if (harvestTarget.userData.hp <= 0) return; // ALREADY BROKEN
                harvestTarget.userData.hp--;

                // Shake effect
                const originalPos = harvestTarget.position.clone();
                const shakeInt = setInterval(() => {
                    harvestTarget.position.x = originalPos.x + (Math.random() - 0.5) * 0.4;
                    if (Math.random() > 0.8) clearInterval(shakeInt);
                }, 20);
                setTimeout(() => { harvestTarget.position.copy(originalPos); clearInterval(shakeInt); }, 100);

                if (type === 'tree') {
                    addResource('wood', 1);
                    spawnResourcePop(intersectPoint, `Wood ${harvestTarget.userData.hp}/5`);
                    playSound('hit_wood', 0.8 + Math.random() * 0.2);
                    if (harvestTarget.userData.hp <= 0) {
                        harvestTarget.userData.isFalling = true;
                        addResource('wood', 4);
                        addResource('stick', 3);
                        state.xp += 10;
                        spawnResourcePop(intersectPoint, 'TIMBER! +XP');
                        playSound('hit_wood', 0.4); // Deep crash
                    }
                } else if (type === 'carrot') {
                    // Harvest all 4 carrots at once
                    addResource('carrot', 4);
                    spawnResourcePop(intersectPoint, '+4 🥕 Carrot');
                    playSound('hit_wood', 1.0);
                    harvestTarget.userData.hp = 0;
                    harvestTarget.visible = false;
                    harvestTarget.position.y = -500;
                } else if (type === 'bush') {
                    addResource('berry', 1);
                    spawnResourcePop(intersectPoint, `Berry ${harvestTarget.userData.hp}/3`);
                    playSound('hit_wood', 1.2);
                    if (harvestTarget.userData.hp <= 0) {
                        harvestTarget.visible = false;
                        harvestTarget.position.y = -500;
                        playSound('hit_wood', 0.6);
                    }
                } else if (type === 'chest') {
                    // Loot the chest!
                    harvestTarget.userData.hp = 0;
                    harvestTarget.visible = false;
                    harvestTarget.position.y = -500;
                    const tier = harvestTarget.userData.chestTier;
                    if (tier === 'rare') {
                        addResource('bone', 2 + Math.floor(Math.random() * 3));
                        addResource('dark_essence', 1 + Math.floor(Math.random() * 2));
                        addResource('hide', 3 + Math.floor(Math.random() * 4));
                        addResource('stone', 5);
                        state.xp += 50;
                        spawnResourcePop(intersectPoint, '✨ RARE CHEST! Dark Essence found!');
                        spawnDebris(intersectPoint, 0xffd700, 15);
                    } else {
                        const lootTable = [
                            () => { addResource('wood', 3 + Math.floor(Math.random()*5)); spawnResourcePop(intersectPoint, '📦 +Wood!'); },
                            () => { addResource('stone', 3 + Math.floor(Math.random()*5)); spawnResourcePop(intersectPoint, '📦 +Stone!'); },
                            () => { addResource('hide', 2 + Math.floor(Math.random()*3)); spawnResourcePop(intersectPoint, '📦 +Hide!'); },
                            () => { addResource('meat', 2 + Math.floor(Math.random()*3)); spawnResourcePop(intersectPoint, '📦 +Meat!'); },
                            () => { addResource('bone', 1 + Math.floor(Math.random()*2)); spawnResourcePop(intersectPoint, '📦 +Bone!'); },
                        ];
                        lootTable[Math.floor(Math.random() * lootTable.length)]();
                        lootTable[Math.floor(Math.random() * lootTable.length)]();
                        state.xp += 20;
                        spawnDebris(intersectPoint, 0x8b5a2b, 10);
                    }
                    playSound('hit_wood', 0.5);
                    updateInventoryUI();
                    spawnDamageNumber(intersectPoint.x, intersectPoint.y + 2, intersectPoint.z, '🎁 OPENED!', false);
                }
            }

            // Visual Spark Effect
            spawnDamageNumber(intersectPoint.x, intersectPoint.y, intersectPoint.z, "✨", false);
            showHitFlash();
            hit = true;
        }
    }
});

function addResource(type, amount) {
    if (state.inventory[type] !== undefined) {
        state.inventory[type] += amount;
        updateInventoryUI();
    }
}

function spawnResourcePop(pos, text) {
    const screenPos = pos.clone().project(camera);
    const x = (screenPos.x + 1) * window.innerWidth / 2;
    const y = (-screenPos.y + 1) * window.innerHeight / 2;

    const el = document.createElement('div');
    el.className = 'resource-pop';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.appendChild(el);

    setTimeout(() => el.classList.add('fade-out'), 500);
    setTimeout(() => el.remove(), 1200);
}
function showHitFlash() {
    let flash = document.getElementById('hit-flash');
    if (!flash) {
        flash = document.createElement('div');
        flash.id = 'hit-flash';
        flash.style.position = 'fixed';
        flash.style.top = '0';
        flash.style.left = '0';
        flash.style.width = '100%';
        flash.style.height = '100%';
        flash.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
        flash.style.pointerEvents = 'none';
        flash.style.zIndex = '9999';
        flash.style.opacity = '0';
        flash.style.transition = 'opacity 0.1s';
        document.body.appendChild(flash);
    }
    flash.style.opacity = '1';
    setTimeout(() => { flash.style.opacity = '0'; }, 100);
}

function updateInventoryUI() {
    const itemsGrid = document.getElementById('items-grid');
    if (!itemsGrid) return;

    itemsGrid.innerHTML = '';
    for (const [item, count] of Object.entries(state.inventory)) {
        if (count > 0) {
            const slot = document.createElement('div');
            slot.className = 'inv-slot';

            // Skip rendering if equipped
            if (state.equips.weapon === item) continue;

            const icons = {
                wooden_pickaxe: '⛏️',
                stone_pickaxe: '⛏️',
                wooden_sword: '⚔️',
                stone_sword: '⚔️',
                wood: '🪵',
                stone: '🪨',
                stick: '🥖',
                berry: '🫐',
                carrot: '🥕',
                meat: '🥩',
                hide: '📜',
                bone: '🦴',
                dark_essence: '🌑',
                coal: '🌑'
            };

            const icon = icons[item] || '📦';
            slot.innerHTML = `
                <span class="item-icon">${icon}</span>
                <span class="item-name">${item.replace('_', ' ').toUpperCase()}</span>
                <span class="item-count">${count}</span>
            `;

            // Click to equip if it's a tool/weapon
            if (item.includes('pickaxe') || item.includes('sword')) {
                slot.title = "Click to Equip";
                slot.style.cursor = 'pointer';
                slot.onclick = () => equipItem(item);
            }

            itemsGrid.appendChild(slot);
        }
    }
}

