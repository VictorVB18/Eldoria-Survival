import * as THREE from 'three';

export const gameState = {
    started: false,
    paused: false,
    inventoryOpen: false,
    customizing: false,
    dayTime: 0.25,
    currentSaveSlot: 1,
    // Player state
    pos: new THREE.Vector3(0, 20, 0),
    velY: 0,
    isGrounded: false,
    health: 100,
    hunger: 100,
    xp: 0,
    level: 1
};
