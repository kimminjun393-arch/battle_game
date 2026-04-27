import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, get, set, update, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyBUPl0t3VqvI_4VXEorTNXDAwlcUhnTuXE",
    authDomain: "btgm-8ff81.firebaseapp.com",
    databaseURL: "https://btgm-8ff81-default-rtdb.firebaseio.com",
    projectId: "btgm-8ff81",
    storageBucket: "btgm-8ff81.firebasestorage.app",
    messagingSenderId: "1073665495467",
    appId: "1:1073665495467:web:d2542c4e95e799128782ee",
    measurementId: "G-WVLW591W2R"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
let roomRef = null;
let currentRoomCode = "";

const lobbyContainer = document.getElementById('lobby-container');
const gameContainer = document.getElementById('game-container');
const joinBtn = document.getElementById('join-btn');
const roomCodeInput = document.getElementById('room-code');
const lobbyStatus = document.getElementById('lobby-status');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// [밸런스 패치] 클래스별 능력치
const TANK_TYPES = {
    'balanced': { name: 'Basic', maxHp: 300, maxFuel: 100, speed: 2.5, powerSpeedInc: 0.05, rangeMult: 1.0, dmgMult: 1.0 },
    'heavy':    { name: 'Heavy Man', maxHp: 450, maxFuel: 50, speed: 1.2, powerSpeedInc: 0.02, rangeMult: 0.7, dmgMult: 1.5 }, // 사거리 짧음, 데미지 강함
    'light':    { name: 'Speedy', maxHp: 200, maxFuel: 200, speed: 4.0, powerSpeedInc: 0.1, rangeMult: 1.4, dmgMult: 0.8 }   // 사거리 김, 데미지 약함
};

const WEAPONS = {
    'Q': { name: 'NORMAL', dmg: 35, crater: 30, baseMaxPower: 100, gravity: 0.22, color: '#f1c40f' },
    'W': { name: 'HEAVY', dmg: 55, crater: 50, baseMaxPower: 75, gravity: 0.28, color: '#e74c3c' },
    'E': { name: 'SNIPER', dmg: 20, crater: 15, baseMaxPower: 130, gravity: 0.15, color: '#00ffff' },
    'R': { name: 'NUKE', dmg: 80, crater: 80, baseMaxPower: 55, gravity: 0.35, color: '#9b59b6' }
};

let gameState = {
    turn: 1, myPlayerNum: 1, angle: 45, power: 0, powerDir: 1, powerSpeed: 1.5, fuel: 100, selectedWeapon: 'Q', 
    isCharging: false, isGameStarted: false,
    players: {
        1: { x: 150, hp: 300, color: '#3498db', angle: 45, tankType: 'balanced' },
        2: { x: 1050, hp: 300, color: '#e74c3c', angle: 45, tankType: 'balanced' }
    },
    projectile: { active: false }, terrain: [], lastActionId: 0, isProcessingHit: false 
};

const keys = {};
let lastMoveSync = 0;

function generateTerrain() {
    let t = [];
    let base = 350, freq1 = 0.004, amp1 = 60, freq2 = 0.015, amp2 = 25;
    const startRef = Math.random() * 2000;
    for (let x = 0; x < canvas.width; x++) {
        const y = base + Math.sin((x + startRef) * freq1) * amp1 + Math.sin((x + startRef) * freq2) * amp2;
        t.push(y);
    }
    return t;
}

joinBtn.addEventListener('click', async () => {
    currentRoomCode = roomCodeInput.value.trim();
    if (!currentRoomCode) return alert("방 코드를 입력하세요!");
    const myTankChoice = document.getElementById('tank-select').value;
    const myTankStats = TANK_TYPES[myTankChoice];
    joinBtn.disabled = true;
    lobbyStatus.innerText = "전투 배치 중...";
    roomRef = ref(db, 'rooms/' + currentRoomCode);

    try {
        const snapshot = await get(roomRef);
        const data = snapshot.val();
        if (!data || data.playersCount === 0) {
            gameState.myPlayerNum = 1;
            gameState.fuel = myTankStats.maxFuel;
            const t = generateTerrain();
            await set(roomRef, { playersCount: 1, terrain: t, turn: 1, hp1: myTankStats.maxHp, tank1: myTankChoice, hp2: 300, tank2: 'balanced' });
            gameState.terrain = t;
            onDisconnect(roomRef).remove();
            lobbyStatus.innerText = "상대방 대기 중...";
        } else {
            gameState.myPlayerNum = 2;
            gameState.fuel = myTankStats.maxFuel;
            gameState.terrain = data.terrain;
            await update(roomRef, { playersCount: 2, hp2: myTankStats.maxHp, tank2: myTankChoice });
        }
        onValue(roomRef, (snap) => {
            const val = snap.val();
            if (!val) return;
            if (val.tank1) gameState.players[1].tankType = val.tank1;
            if (val.tank2) gameState.players[2].tankType = val.tank2;
            if (val.playersCount === 2 && !gameState.isGameStarted) startGame();
            if (val.turn !== undefined && val.turn !== gameState.turn) { gameState.turn = val.turn; updateTurnUI(); }
            if (val.terrain) gameState.terrain = [...val.terrain];
            updateHP(1, val.hp1); updateHP(2, val.hp2);
            if (val.action && val.action.id !== gameState.lastActionId) {
                if (val.action.player !== gameState.myPlayerNum) {
                    gameState.lastActionId = val.action.id;
                    executeFire(val.action);
                }
            }
        });
    } catch (e) { console.error(e); }
});

function updateHP(num, hp) {
    if (hp === undefined) return;
    gameState.players[num].hp = hp;
    const maxHp = TANK_TYPES[gameState.players[num].tankType].maxHp;
    const hpEl = document.getElementById(`hp${num}`);
    if (hpEl) {
        hpEl.style.width = Math.max(0, (hp / maxHp * 100)) + '%';
        hpEl.innerText = `${Math.floor(hp)} / ${maxHp}`;
        hpEl.style.textAlign = 'center'; hpEl.style.lineHeight = '25px'; hpEl.style.fontSize = '12px';
    }
}

function startGame() {
    gameState.isGameStarted = true;
    lobbyContainer.style.display = 'none';
    gameContainer.style.display = 'flex';
    const other = gameState.myPlayerNum === 1 ? 2 : 1;
    onValue(ref(db, `rooms/${currentRoomCode}/players/${other}`), (snap) => {
        if (snap.exists()) {
            const d = snap.val();
            if (d.x !== undefined) gameState.players[other].x = d.x;
            if (d.angle !== undefined) gameState.players[other].angle = d.angle;
        }
    });
    gameLoop();
}

window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (gameState.turn === gameState.myPlayerNum && !gameState.isCharging && !gameState.projectile.active) {
        if (['KeyQ','KeyW','KeyE','KeyR'].includes(e.code)) gameState.selectedWeapon = e.code.replace('Key','');
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && gameState.isCharging) {
        if (gameState.turn === gameState.myPlayerNum && !gameState.projectile.active) sendFireAction();
        gameState.isCharging = false; gameState.power = 0;
    }
    keys[e.code] = false;
});

function getTerrainInfo(x) {
    const ix = Math.max(0, Math.min(1199, Math.floor(x)));
    const y = gameState.terrain[ix] || 450;
    const slopeX = Math.max(0, Math.min(1199, Math.floor(x + 10)));
    const slopeY = gameState.terrain[slopeX] || 450;
    return { y, rotationRad: Math.atan2(slopeY - y, slopeX - x) };
}

function handleInput() {
    if (gameState.turn !== gameState.myPlayerNum || gameState.projectile.active) return;
    const p = gameState.players[gameState.myPlayerNum];
    const stats = TANK_TYPES[p.tankType];
    const wInfo = WEAPONS[gameState.selectedWeapon];
    let changed = false;

    if (keys['ArrowLeft'] && gameState.fuel > 0) { p.x -= stats.speed; gameState.fuel -= 1; changed = true; }
    if (keys['ArrowRight'] && gameState.fuel > 0) { p.x += stats.speed; gameState.fuel -= 1; changed = true; }
    if (keys['ArrowUp']) { gameState.angle += 1; changed = true; }
    if (keys['ArrowDown']) { gameState.angle -= 1; changed = true; }
    
    if (changed) {
        const now = Date.now();
        if (now - lastMoveSync > 50) {
            update(ref(db, `rooms/${currentRoomCode}/players/${gameState.myPlayerNum}`), { x: p.x, angle: gameState.angle });
            lastMoveSync = now;
        }
    }

    if (keys['Space']) {
        gameState.isCharging = true;
        gameState.power += gameState.powerSpeed * gameState.powerDir;
        gameState.powerSpeed += stats.powerSpeedInc; 
        const maxRange = wInfo.baseMaxPower * stats.rangeMult; // 클래스별 사거리 적용
        if (gameState.power >= maxRange) { gameState.power = maxRange; gameState.powerDir = -1; }
        else if (gameState.power <= 0) { gameState.power = 0; gameState.powerDir = 1; }
    }
    document.getElementById('status').innerText = `CLASS: ${stats.name} | ANGLE: ${gameState.angle}° | POWER: ${Math.floor(gameState.power)} | FUEL: ${Math.floor(gameState.fuel)}`;
}

function sendFireAction() {
    const actionId = Date.now();
    const rad = gameState.angle * (Math.PI / 180);
    const dir = gameState.myPlayerNum === 1 ? 1 : -1;
    const pX = gameState.players[gameState.myPlayerNum].x;
    const tInfo = getTerrainInfo(pX);

    const actionData = {
        id: actionId, player: gameState.myPlayerNum, weapon: gameState.selectedWeapon,
        startX: pX, startY: tInfo.y - 35,
        vx: Math.cos(rad) * (gameState.power * 0.25) * dir,
        vy: -Math.sin(rad) * (gameState.power * 0.25)
    };
    gameState.lastActionId = actionId;
    update(roomRef, { action: actionData });
    executeFire(actionData);
}

function executeFire(d) {
    gameState.projectile = { x: d.startX, y: d.startY, vx: d.vx, vy: d.vy, active: true, owner: d.player, weapon: d.weapon };
}

function updatePhysics() {
    if (!gameState.projectile.active) return;
    const wInfo = WEAPONS[gameState.projectile.weapon];
    gameState.projectile.x += gameState.projectile.vx;
    gameState.projectile.vy += wInfo.gravity; 
    gameState.projectile.y += gameState.projectile.vy;

    const px = Math.floor(gameState.projectile.x);
    const hitGround = px >= 0 && px < 1200 && gameState.projectile.y >= gameState.terrain[px];
    if (hitGround || gameState.projectile.y > 1000) {
        gameState.projectile.active = false;
        if (gameState.projectile.owner === gameState.myPlayerNum) {
            if (hitGround) { checkHitAndSync(); applyCrater(gameState.projectile.x, wInfo.crater); }
            const next = gameState.myPlayerNum === 1 ? 2 : 1;
            update(roomRef, { turn: next, action: null, terrain: gameState.terrain });
        }
        gameState.fuel = TANK_TYPES[gameState.players[gameState.myPlayerNum].tankType].maxFuel;
    }
}

function applyCrater(cx, r) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(1199, Math.floor(cx + r)); x++) {
        const distSq = r * r - (x - cx) * (x - cx);
        if (distSq > 0) gameState.terrain[x] = Math.min(600, gameState.terrain[x] + Math.sqrt(distSq) * 0.8);
    }
}

function checkHitAndSync() {
    const wInfo = WEAPONS[gameState.projectile.weapon];
    const attackerStats = TANK_TYPES[gameState.players[gameState.projectile.owner].tankType];
    let updates = {};
    for (let i = 1; i <= 2; i++) {
        const p = gameState.players[i];
        if (Math.hypot(gameState.projectile.x - p.x, gameState.projectile.y - getTerrainInfo(p.x).y) < wInfo.crater + 20) {
            let dmg = wInfo.dmg * attackerStats.dmgMult; // 클래스별 데미지 배율 적용
            if (i === gameState.projectile.owner) dmg *= 0.5;
            updates[`hp${i}`] = Math.max(0, p.hp - dmg);
        }
    }
    if (Object.keys(updates).length > 0) {
        update(roomRef, updates);
        if (updates.hp1 === 0 || updates.hp2 === 0) { setTimeout(() => { alert("GAME OVER!"); location.reload(); }, 200); }
    }
}

function updateTurnUI() {
    const el = document.getElementById('turn-display');
    const isMy = gameState.turn === gameState.myPlayerNum;
    el.innerText = isMy ? "YOUR TURN" : "WAITING...";
    el.style.color = isMy ? "#f1c40f" : "#666";
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#7a6a4a'; ctx.beginPath(); ctx.moveTo(0, 600);
    for (let x = 0; x < 1200; x++) ctx.lineTo(x, gameState.terrain[x]);
    ctx.lineTo(1200, 600); ctx.fill();

    for (let id in gameState.players) {
        const p = gameState.players[id];
        const t = getTerrainInfo(p.x);
        const stats = TANK_TYPES[p.tankType || 'balanced'];
        ctx.save();
        ctx.translate(p.x, t.y - 12);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(stats.name, 0, -40);
        ctx.save();
        const ang = (gameState.myPlayerNum == id) ? gameState.angle : (p.angle || 45);
        ctx.rotate((id == 1 ? -ang : -180 + ang) * (Math.PI / 180));
        ctx.fillStyle = p.color; ctx.fillRect(0, -3, 30, 6);
        ctx.restore();
        ctx.rotate(t.rotationRad);
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI*2); ctx.fill();
        ctx.fillRect(-22, 4, 44, 16);
        ctx.restore();
    }

    if (gameState.turn === gameState.myPlayerNum && !gameState.projectile.active) {
        const w = WEAPONS[gameState.selectedWeapon];
        const stats = TANK_TYPES[gameState.players[gameState.myPlayerNum].tankType];
        const rad = gameState.angle * (Math.PI / 180);
        const dir = gameState.myPlayerNum === 1 ? 1 : -1;
        const maxRange = w.baseMaxPower * stats.rangeMult;
        let sx = gameState.players[gameState.myPlayerNum].x, sy = getTerrainInfo(sx).y - 35;
        let svx = Math.cos(rad) * ((gameState.isCharging ? gameState.power : maxRange) * 0.25) * dir;
        let svy = -Math.sin(rad) * ((gameState.isCharging ? gameState.power : maxRange) * 0.25);
        ctx.beginPath(); ctx.strokeStyle = w.color; ctx.setLineDash([5, 5]);
        for (let i = 0; i < 100; i++) {
            sx += svx; svy += w.gravity; sy += svy; ctx.lineTo(sx, sy);
            if (sx < 0 || sx > 1200 || sy > gameState.terrain[Math.floor(sx)]) break;
        }
        ctx.stroke(); ctx.setLineDash([]);
    }

    if (gameState.projectile.active) {
        ctx.fillStyle = WEAPONS[gameState.projectile.weapon].color;
        ctx.beginPath(); ctx.arc(gameState.projectile.x, gameState.projectile.y, 6, 0, Math.PI*2); ctx.fill();
    }
}

function gameLoop() {
    handleInput(); updatePhysics(); draw();
    requestAnimationFrame(gameLoop);
}
