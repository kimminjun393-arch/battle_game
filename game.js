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

const MAX_HP = 300;
const MAP_WIDTH = 3000; 

const WEAPONS = {
    'Q': { name: 'NORMAL', dmg: 35, crater: 30, maxPower: 100, gravity: 0.22, color: '#f1c40f' },
    'W': { name: 'HEAVY', dmg: 55, crater: 50, maxPower: 75, gravity: 0.28, color: '#e74c3c' },
    'E': { name: 'SNIPER', dmg: 20, crater: 15, maxPower: 130, gravity: 0.15, color: '#00ffff' },
    'R': { name: 'NUKE', dmg: 80, crater: 80, maxPower: 55, gravity: 0.35, color: '#9b59b6' }
};

// 재질별 강도(hardness) 극단적 상향/하향 적용
const MAP_THEMES = {
    'GRASSLAND': { 
        name: '초원', bgTop: '#87CEEB', bgBottom: '#E0F6FF',
        mats: {
            'DIRT': { fill: '#2ecc71', stroke: '#27ae60', hardness: 1.0 },
            'ROCK': { fill: '#7f8c8d', stroke: '#636e72', hardness: 0.2 },
            'SAND': { fill: '#f1c40f', stroke: '#e67e22', hardness: 2.5 }
        }
    },
    'DESERT': { 
        name: '사막', bgTop: '#FFDAB9', bgBottom: '#FFA07A',
        mats: {
            'DIRT': { fill: '#e67e22', stroke: '#d35400', hardness: 1.1 },
            'ROCK': { fill: '#c0392b', stroke: '#922b21', hardness: 0.25 },
            'SAND': { fill: '#f39c12', stroke: '#e67e22', hardness: 2.8 }
        }
    },
    'BATTLEFIELD': { 
        name: '전쟁터', bgTop: '#4a4a4a', bgBottom: '#2c2c2a',
        mats: {
            'DIRT': { fill: '#555555', stroke: '#333333', hardness: 0.8 },
            'ROCK': { fill: '#2d3436', stroke: '#1e272e', hardness: 0.15 },
            'SAND': { fill: '#718093', stroke: '#2f3640', hardness: 2.2 }
        }
    }
};

let gameState = {
    turn: 1, 
    myPlayerNum: 1, 
    angle: 45,
    power: 0, powerDir: 1, powerSpeed: 1.5,
    fuel: 100,
    selectedWeapon: 'Q', 
    isCharging: false, isGameStarted: false,
    cameraX: 0,
    cameraMode: 'auto', 
    theme: 'GRASSLAND',
    terrain: [],
    chunks: [], 
    players: {
        1: { x: 300, hp: MAX_HP, color: '#3498db', angle: 45 },
        2: { x: MAP_WIDTH - 300, hp: MAX_HP, color: '#e74c3c', angle: 45 }
    },
    projectile: { x: 0, y: 0, vx: 0, vy: 0, active: false, owner: 0, weapon: 'Q' },
    lastActionId: 0,
    isProcessingHit: false 
};

const keys = {};
let lastMoveSync = 0;
let lastTime = 0;

function generateMapData() {
    let t = [];
    let base = 350, freq1 = 0.004, amp1 = 60, freq2 = 0.015, amp2 = 25;
    const startRef = Math.random() * 2000;
    for (let x = 0; x < MAP_WIDTH; x++) {
        const y = base + Math.sin((x + startRef) * freq1) * amp1 + Math.sin((x + startRef) * freq2) * amp2;
        t.push(y);
    }

    let chunks = [];
    let x = 0;
    const types = ['DIRT', 'ROCK', 'SAND'];
    
    while (x < MAP_WIDTH) {
        let width = 400 + Math.random() * 600; 
        let end = Math.min(x + width, MAP_WIDTH);
        let matType = types[Math.floor(Math.random() * types.length)];
        
        if (chunks.length > 0 && chunks[chunks.length - 1].mat === matType) {
            matType = types[(types.indexOf(matType) + 1) % types.length];
        }
        
        chunks.push({ start: Math.floor(x), end: Math.floor(end), mat: matType });
        x = end;
    }
    return { terrain: t, chunks: chunks };
}

joinBtn.addEventListener('click', async () => {
    currentRoomCode = roomCodeInput.value.trim();
    if (!currentRoomCode) return alert("방 코드를 입력하세요!");

    joinBtn.disabled = true;
    lobbyStatus.innerText = "전투 배치 중...";
    roomRef = ref(db, 'rooms/' + currentRoomCode);

    try {
        const snapshot = await get(roomRef);
        const data = snapshot.val();

        if (!data || data.playersCount === 0) {
            const themeKeys = Object.keys(MAP_THEMES);
            const randomTheme = themeKeys[Math.floor(Math.random() * themeKeys.length)];
            const mapData = generateMapData();
            
            gameState.myPlayerNum = 1;
            gameState.terrain = mapData.terrain;
            gameState.chunks = mapData.chunks;
            gameState.theme = randomTheme;

            await set(roomRef, { 
                playersCount: 1, 
                terrain: mapData.terrain, 
                chunks: mapData.chunks,
                turn: 1, action: null, hp1: MAX_HP, hp2: MAX_HP, theme: randomTheme
            });
            onDisconnect(roomRef).remove();
            lobbyStatus.innerText = "상대방 대기 중...";
        } else {
            gameState.myPlayerNum = 2;
            gameState.terrain = data.terrain || generateMapData().terrain;
            gameState.chunks = data.chunks || [];
            gameState.theme = data.theme || 'GRASSLAND';
            await update(roomRef, { playersCount: 2 });
        }

        onValue(roomRef, (snap) => {
            const val = snap.val();
            if (!val) return;
            
            if (val.theme) gameState.theme = val.theme;
            if (val.chunks) gameState.chunks = val.chunks;
            
            if (val.playersCount === 2 && !gameState.isGameStarted) startGame();
            
            if (val.turn !== undefined && val.turn !== gameState.turn) {
                gameState.turn = val.turn;
                gameState.cameraMode = 'auto'; 
                updateTurnUI();
            }

            if (val.terrain && val.terrain.length > 0) {
                if (JSON.stringify(val.terrain) !== JSON.stringify(gameState.terrain)) {
                    gameState.terrain = [...val.terrain];
                }
            }

            if (val.hp1 !== undefined) {
                gameState.players[1].hp = val.hp1;
                updateHPUI(1, val.hp1);
            }
            if (val.hp2 !== undefined) {
                gameState.players[2].hp = val.hp2;
                updateHPUI(2, val.hp2);
            }
            
            if (val.action && val.action.id !== gameState.lastActionId) {
                if (val.action.player !== gameState.myPlayerNum) {
                    gameState.lastActionId = val.action.id;
                    gameState.cameraMode = 'auto'; 
                    executeFire(val.action);
                }
            }
        });
    } catch (e) { console.error(e); }
});

function updateHPUI(playerNum, hp) {
    const hpEl = document.getElementById(`hp${playerNum}`);
    if (hpEl) {
        hpEl.style.width = (hp / MAX_HP * 100) + '%';
        hpEl.innerText = `${Math.floor(hp)} / ${MAX_HP}`;
    }
}

function startGame() {
    gameState.isGameStarted = true;
    lobbyContainer.style.display = 'none';
    gameContainer.style.display = 'flex';
    lastTime = performance.now();
    
    const otherPlayerNum = gameState.myPlayerNum === 1 ? 2 : 1;
    onValue(ref(db, `rooms/${currentRoomCode}/players/${otherPlayerNum}`), (snap) => {
        if (snap.exists()) {
            const data = snap.val();
            if (data.x !== undefined) gameState.players[otherPlayerNum].x = data.x;
            if (data.angle !== undefined) gameState.players[otherPlayerNum].angle = data.angle;
        }
    });
    updateTurnUI();
    requestAnimationFrame(gameLoop); 
}

window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (gameState.turn === gameState.myPlayerNum && !gameState.isCharging && !gameState.projectile.active) {
        if (e.code === 'KeyQ') gameState.selectedWeapon = 'Q';
        if (e.code === 'KeyW') gameState.selectedWeapon = 'W';
        if (e.code === 'KeyE') gameState.selectedWeapon = 'E';
        if (e.code === 'KeyR') gameState.selectedWeapon = 'R';
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && gameState.isCharging) {
        if (gameState.turn === gameState.myPlayerNum && !gameState.projectile.active) {
            sendFireAction();
        }
        gameState.isCharging = false;
        gameState.power = 0;
        gameState.powerSpeed = 1.5; 
    }
    keys[e.code] = false;
});

function getTerrainInfo(x) {
    const ix = Math.max(0, Math.min(MAP_WIDTH - 1, Math.floor(x)));
    const y = gameState.terrain[ix] || 450;
    const slopeX = Math.max(0, Math.min(MAP_WIDTH - 1, Math.floor(x + 10)));
    const slopeY = gameState.terrain[slopeX] || 450;
    const rotationRad = Math.atan2(slopeY - y, slopeX - x);
    return { y, rotationRad };
}

function handleInput(timeScale) {
    if (keys['KeyA']) {
        gameState.cameraMode = 'manual';
        gameState.cameraX -= 15 * timeScale;
    }
    if (keys['KeyD']) {
        gameState.cameraMode = 'manual';
        gameState.cameraX += 15 * timeScale;
    }

    if (gameState.turn !== gameState.myPlayerNum || gameState.projectile.active) return;
    
    const p = gameState.players[gameState.myPlayerNum];
    const currentWeaponInfo = WEAPONS[gameState.selectedWeapon];
    let stateChanged = false;

    if (keys['ArrowLeft'] && gameState.fuel > 0) { p.x -= 2.5 * timeScale; gameState.fuel -= 1 * timeScale; stateChanged = true; }
    if (keys['ArrowRight'] && gameState.fuel > 0) { p.x += 2.5 * timeScale; gameState.fuel -= 1 * timeScale; stateChanged = true; }
    
    if (p.x < 30) p.x = 30; 
    if (p.x > MAP_WIDTH - 30) p.x = MAP_WIDTH - 30;

    if (keys['ArrowUp']) { gameState.angle += 1 * timeScale; stateChanged = true; }
    if (keys['ArrowDown']) { gameState.angle -= 1 * timeScale; stateChanged = true; }
    
    if (stateChanged) {
        const now = Date.now();
        if (now - lastMoveSync > 50) {
            update(ref(db, `rooms/${currentRoomCode}/players/${gameState.myPlayerNum}`), { 
                x: p.x, angle: gameState.angle
            });
            lastMoveSync = now;
        }
    }

    if (keys['Space']) {
        gameState.isCharging = true;
        gameState.power += gameState.powerSpeed * gameState.powerDir * timeScale;
        gameState.powerSpeed += 0.05 * timeScale; 
        
        if (gameState.power >= currentWeaponInfo.maxPower) { 
            gameState.power = currentWeaponInfo.maxPower; 
            gameState.powerDir = -1; 
        } else if (gameState.power <= 0) { 
            gameState.power = 0; 
            gameState.powerDir = 1; 
        }
    }
    
    document.getElementById('status').innerText = 
        `ANGLE: ${Math.floor(gameState.angle)}° | POWER: ${Math.floor(gameState.power)} | FUEL: ${Math.floor(gameState.fuel)} | [A][D] 카메라 이동`;
}

function sendFireAction() {
    const actionId = Date.now();
    const radian = gameState.angle * (Math.PI / 180);
    const dir = gameState.myPlayerNum === 1 ? 1 : -1;
    const pX = gameState.players[gameState.myPlayerNum].x;
    const tInfo = getTerrainInfo(pX);

    const actionData = {
        id: actionId,
        player: gameState.myPlayerNum,
        weapon: gameState.selectedWeapon, 
        startX: pX, startY: tInfo.y - 35,
        vx: Math.cos(radian) * (gameState.power * 0.25) * dir,
        vy: -Math.sin(radian) * (gameState.power * 0.25)
    };
    
    gameState.lastActionId = actionId;
    gameState.isProcessingHit = false; 
    gameState.cameraMode = 'auto'; 
    update(roomRef, { action: actionData });
    executeFire(actionData);
}

function executeFire(data) {
    gameState.projectile = { 
        x: data.startX, y: data.startY, vx: data.vx, vy: data.vy, 
        active: true, owner: data.player, weapon: data.weapon 
    };
}

function updatePhysics(timeScale) {
    if (!gameState.projectile.active) return;

    const weaponInfo = WEAPONS[gameState.projectile.weapon];
    gameState.projectile.x += gameState.projectile.vx * timeScale;
    gameState.projectile.vy += weaponInfo.gravity * timeScale; 
    gameState.projectile.y += gameState.projectile.vy * timeScale;

    const px = Math.floor(gameState.projectile.x);
    const hitGround = px >= 0 && px < MAP_WIDTH && gameState.projectile.y >= gameState.terrain[px];
    const outOfBounds = gameState.projectile.y > canvas.height + 100 || gameState.projectile.x < -100 || gameState.projectile.x > MAP_WIDTH + 100;

    if (hitGround || outOfBounds) {
        gameState.projectile.active = false;
        if (gameState.projectile.owner === gameState.myPlayerNum && !gameState.isProcessingHit) {
            gameState.isProcessingHit = true; 
            if (hitGround) {
                checkHitAndSync(); 
                
                const currentTheme = MAP_THEMES[gameState.theme] || MAP_THEMES['GRASSLAND'];
                const hitChunk = gameState.chunks.find(c => px >= c.start && px < c.end) || gameState.chunks[0];
                const matInfo = currentTheme.mats[hitChunk.mat];
                
                const finalCraterRadius = weaponInfo.crater * matInfo.hardness;
                applyCrater(gameState.projectile.x, gameState.projectile.y, finalCraterRadius);
            }
            const nextTurn = gameState.myPlayerNum === 1 ? 2 : 1;
            update(roomRef, { 
                turn: nextTurn, action: null, terrain: gameState.terrain 
            }).then(() => { gameState.isProcessingHit = false; });
        }
        gameState.fuel = 100;
        updateTurnUI();
    }
}

function applyCrater(craterX, craterY, radius) {
    const startX = Math.max(0, Math.floor(craterX - radius));
    const endX = Math.min(MAP_WIDTH - 1, Math.floor(craterX + radius));
    
    for (let x = startX; x <= endX; x++) {
        const dx = x - craterX;
        const distSq = radius * radius - dx * dx;
        if (distSq > 0) {
            const dy = Math.sqrt(distSq); 
            const bottomOfCrater = craterY + dy; 
            if (gameState.terrain[x] < bottomOfCrater) {
                gameState.terrain[x] = Math.min(bottomOfCrater, canvas.height - 10);
            }
        }
    }
}

function checkHitAndSync() {
    const weaponInfo = WEAPONS[gameState.projectile.weapon];
    let hpUpdates = {};
    let isGameOver = false;
    for (let i = 1; i <= 2; i++) {
        const tX = gameState.players[i].x;
        const tY = getTerrainInfo(tX).y;
        const dist = Math.hypot(gameState.projectile.x - tX, gameState.projectile.y - tY);
        
        const currentTheme = MAP_THEMES[gameState.theme] || MAP_THEMES['GRASSLAND'];
        const hitChunk = gameState.chunks.find(c => tX >= c.start && tX < c.end) || gameState.chunks[0];
        const matInfo = currentTheme.mats[hitChunk.mat];
        const finalCraterRadius = weaponInfo.crater * matInfo.hardness;

        if (dist < finalCraterRadius + 20) {
            let dmgApplied = weaponInfo.dmg;
            if (i === gameState.projectile.owner) dmgApplied = Math.floor(dmgApplied * 0.5);
            const newHP = Math.max(0, gameState.players[i].hp - dmgApplied);
            hpUpdates[`hp${i}`] = newHP;
            if (newHP <= 0) isGameOver = true;
        }
    }
    if (Object.keys(hpUpdates).length > 0) {
        update(roomRef, hpUpdates);
        if (isGameOver) {
            setTimeout(() => { alert("GAME OVER!"); location.reload(); }, 100);
        }
    }
}

function updateTurnUI() {
    const el = document.getElementById('turn-display');
    const isMyTurn = gameState.turn === gameState.myPlayerNum;
    el.innerText = isMyTurn ? "YOUR TURN" : "WAITING...";
    el.style.color = isMyTurn ? "#f1c40f" : "#666";
}

function updateCamera() {
    if (gameState.cameraMode === 'manual') {
        gameState.cameraX = Math.max(0, Math.min(gameState.cameraX, MAP_WIDTH - canvas.width));
        return;
    }
    let targetX;
    if (gameState.projectile.active) {
        targetX = gameState.projectile.x;
    } else {
        targetX = gameState.players[gameState.turn].x;
    }
    let desiredCameraX = targetX - (canvas.width / 2);
    desiredCameraX = Math.max(0, Math.min(desiredCameraX, MAP_WIDTH - canvas.width));
    gameState.cameraX += (desiredCameraX - gameState.cameraX) * 0.1;
}

function draw() {
    const currentTheme = MAP_THEMES[gameState.theme] || MAP_THEMES['GRASSLAND'];

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    bg.addColorStop(0, currentTheme.bgTop); bg.addColorStop(1, currentTheme.bgBottom);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-gameState.cameraX, 0);

    gameState.chunks.forEach(chunk => {
        const mat = currentTheme.mats[chunk.mat];
        let sX = chunk.start;
        let renderStartX = sX > 0 ? sX - 1 : sX; 
        let eX = Math.min(chunk.end, MAP_WIDTH - 1);

        ctx.fillStyle = mat.fill;
        ctx.beginPath();
        ctx.moveTo(renderStartX, canvas.height);
        for(let x = renderStartX; x <= eX; x++) {
            ctx.lineTo(x, gameState.terrain[x]);
        }
        ctx.lineTo(eX, canvas.height);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = mat.stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for(let x = renderStartX; x <= eX; x++) {
            if(x === renderStartX) ctx.moveTo(x, gameState.terrain[x]);
            else ctx.lineTo(x, gameState.terrain[x]);
        }
        ctx.stroke();
    });

    for (let id in gameState.players) {
        const p = gameState.players[id];
        const tInfo = getTerrainInfo(p.x); 
        ctx.save();
        ctx.translate(p.x, tInfo.y - 12); 
        ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        
        ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
        ctx.strokeText(`HP: ${Math.floor(p.hp)}`, 0, -25);
        ctx.fillText(`HP: ${Math.floor(p.hp)}`, 0, -25);
        
        ctx.save();
        const currentAngle = (gameState.myPlayerNum == id) ? gameState.angle : (p.angle || 45);
        if (id == 1) ctx.rotate(-currentAngle * (Math.PI / 180)); 
        else ctx.rotate((-180 + currentAngle) * (Math.PI / 180)); 
        ctx.fillStyle = p.color; ctx.fillRect(0, -3, 30, 6);
        ctx.restore();

        ctx.rotate(tInfo.rotationRad);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI*2); ctx.fill();
        ctx.strokeRect(-22, 4, 44, 16); ctx.fillRect(-22, 4, 44, 16);
        ctx.restore();
    }

    if (gameState.turn === gameState.myPlayerNum && !gameState.projectile.active) {
        const currentWeaponInfo = WEAPONS[gameState.selectedWeapon];
        const radian = gameState.angle * (Math.PI / 180);
        const dir = gameState.myPlayerNum === 1 ? 1 : -1;
        const pX = gameState.players[gameState.myPlayerNum].x;
        const tInfo = getTerrainInfo(pX);
        const simPower = gameState.isCharging ? gameState.power : currentWeaponInfo.maxPower;

        let simX = pX;
        let simY = tInfo.y - 35;
        let simVx = Math.cos(radian) * (simPower * 0.25) * dir;
        let simVy = -Math.sin(radian) * (simPower * 0.25);

        ctx.save(); ctx.beginPath(); ctx.moveTo(simX, simY);
        ctx.globalAlpha = gameState.isCharging ? 1.0 : 0.35;
        ctx.strokeStyle = currentWeaponInfo.color; ctx.lineWidth = 2; ctx.setLineDash([8, 12]);

        for (let i = 0; i < 200; i++) {
            simX += simVx; simVy += currentWeaponInfo.gravity; simY += simVy;
            ctx.lineTo(simX, simY);
            const checkX = Math.floor(simX);
            if (checkX >= 0 && checkX < MAP_WIDTH && simY >= gameState.terrain[checkX]) break;
            if (simY > canvas.height) break;
        }
        ctx.stroke(); ctx.restore();
    }

    if (gameState.projectile.active) {
        const projWeaponInfo = WEAPONS[gameState.projectile.weapon];
        ctx.fillStyle = projWeaponInfo.color;
        ctx.beginPath(); ctx.arc(gameState.projectile.x, gameState.projectile.y, 6, 0, Math.PI*2); ctx.fill();
    }

    ctx.restore();
    
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(canvas.width - 150, 20, 130, 35);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`MAP: ${currentTheme.name}`, canvas.width - 85, 44);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(20, 20, 230, 130);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.strokeRect(20, 20, 230, 130);

    ['Q', 'W', 'E', 'R'].forEach((key, idx) => {
        const wInfo = WEAPONS[key];
        const isSelected = (gameState.selectedWeapon === key);
        const yPos = 45 + (idx * 28);
        if (isSelected) { ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'; ctx.fillRect(22, yPos - 16, 226, 26); }
        ctx.fillStyle = wInfo.color; ctx.beginPath(); ctx.arc(40, yPos - 4, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = isSelected ? '#ffffff' : '#aaaaaa'; ctx.font = isSelected ? 'bold 13px sans-serif' : '13px sans-serif';
        ctx.textAlign = 'left'; ctx.fillText(`[${key}] ${wInfo.name}`, 55, yPos);
    });
    ctx.restore();

    if (gameState.isCharging && gameState.turn === gameState.myPlayerNum) {
        const currentWeaponInfo = WEAPONS[gameState.selectedWeapon];
        const barWidth = 300, barX = (canvas.width - 300) / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(barX, 30, barWidth, 15);
        ctx.fillStyle = currentWeaponInfo.color; ctx.fillRect(barX, 30, (gameState.power / currentWeaponInfo.maxPower) * barWidth, 15);
    }
}

function gameLoop(timestamp) {
    if (!timestamp) timestamp = performance.now();
    if (!lastTime) lastTime = timestamp;
    const dt = timestamp - lastTime;
    lastTime = timestamp;
    const safeDt = Math.min(dt, 50);
    const timeScale = safeDt / (1000 / 60);

    if (gameState.isGameStarted && gameState.terrain.length > 0 && gameState.chunks.length > 0) {
        handleInput(timeScale);
        updatePhysics(timeScale);
        updateCamera();
        draw();
    }
    requestAnimationFrame(gameLoop);
}
