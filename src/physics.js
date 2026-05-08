// --- WORLD COLLIDER SYSTEM ---
// Simple flat circle colliders {x, z, r} stored in a spatial hash for fast lookup

const worldColliders = [];
const COLLIDER_CELL = 20;
const colliderGrid = new Map();

export function registerCollider(x, z, r) {
    worldColliders.push({x, z, r});
    const cx = Math.floor(x / COLLIDER_CELL);
    const cz = Math.floor(z / COLLIDER_CELL);
    const key = `${cx},${cz}`;
    if (!colliderGrid.has(key)) colliderGrid.set(key, []);
    colliderGrid.get(key).push({x, z, r});
}

export function resolveCollisions(pos) {
    const PLAYER_R = 0.8; // player radius
    const cx = Math.floor(pos.x / COLLIDER_CELL);
    const cz = Math.floor(pos.z / COLLIDER_CELL);
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            const cell = colliderGrid.get(`${cx+i},${cz+j}`);
            if (!cell) continue;
            for (const col of cell) {
                const dx = pos.x - col.x;
                const dz = pos.z - col.z;
                const distSq = dx*dx + dz*dz;
                const minDist = PLAYER_R + col.r;
                if (distSq < minDist * minDist && distSq > 0.001) {
                    // Push player out
                    const dist = Math.sqrt(distSq);
                    const overlap = minDist - dist;
                    pos.x += (dx / dist) * overlap;
                    pos.z += (dz / dist) * overlap;
                }
            }
        }
    }
}

export function checkCollision(x, z, r) {
    const cx = Math.floor(x / COLLIDER_CELL);
    const cz = Math.floor(z / COLLIDER_CELL);
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            const cell = colliderGrid.get(`${cx+i},${cz+j}`);
            if (!cell) continue;
            for (const col of cell) {
                const dx = x - col.x;
                const dz = z - col.z;
                const distSq = dx*dx + dz*dz;
                const minDist = r + col.r;
                if (distSq < minDist * minDist) {
                    return true;
                }
            }
        }
    }
    return false;
}
