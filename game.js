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

const WEAPONS = {
    'Q': { name: 'NORMAL', dmg: 35, crater: 30, maxPower: 100, gravity: 0.22, color: '#f1c40f' },
    'W': { name: 'HEAVY', dmg: 55, crater: 50, maxPower: 75, gravity: 0.28, color: '#e74c3c' },
    'E': { name: 'SNIPER', dmg: 20, crater: 15, maxPower: 130, gravity: 0.15, color: '#00ffff' },
    'R': { name: 'NUKE', dmg: 80, crater: 80, maxPower: 55, gravity: 0.35, color: '#9b59b6' }
};

let gameState = {
    turn: 1, 
    myPlayerNum: 1, 
    angle: 45,
    power: 0, powerDir: 1, powerSpeed: 1.5,
    fuel: 100,
    selectedWeapon: 'Q', 
    isCharging: false, isGameStarted: false,
    players: {
        1: { x: 150, hp: 100, color: '#3498db', angle: 45 },
        2: { x: 1050, hp: 100, color: '#e74c3c', angle: 45 }
    },
    projectile: { x: 0, y: 0, vx: 0, vy: 0, active: false, owner: 0, weapon: 'Q' },
    terrain: [],
    lastActionId: 0,
    isProcessingHit: false 
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

    joinBtn.disabled = true;
    lobbyStatus.innerText = "전투 배치 중...";
    roomRef = ref(db, 'rooms/' + currentRoomCode);

    try {
        const snapshot = await get(roomRef);
        const data = snapshot.val();

        if (!data || data.playersCount === 0) {
            gameState.myPlayerNum = 1;
            const t = generateTerrain();
            await set(roomRef, { 
                playersCount: 1, terrain: t, turn: 1, action: null, hp1: 100, hp2: 100 
            });
            gameState.terrain = t;
            onDisconnect(roomRef).remove();
            lobbyStatus.innerText = "상대방 대기 중...";
        } else {
            gameState.myPlayerNum = 2;
            gameState.terrain = data.terrain || generateTerrain();
            await update(roomRef, { playersCount: 2 });
        }

        onValue(roomRef, (snap) => {
            const val = snap.val();
            if (!val) return;
            
            if (val.playersCount === 2 && !gameState.isGameStarted) startGame();
            
            if (val.turn !== undefined && val.turn !== gameState.turn) {
                gameState.turn = val.turn;
                updateTurnUI();
            }

            if (val.terrain && val.terrain.length > 0) {
                if (JSON.stringify(val.terrain) !== JSON.stringify(gameState.terrain)) {
                    gameState.terrain = [...val.terrain];
                }
            }

            if (val.hp1 !== undefined) {
                gameState.players[1].hp = val.hp1;
                document.getElementById('hp1').style.width = val.hp1 + '%';
            }
            if (val.hp2 !== undefined) {
                gameState.players[2].hp = val.hp2;
                document.getElementById('hp2').style.width = val.hp2 + '%';
            }
            
            if (val.action && val.action.id !== gameState.lastActionId) {
                if (val.action.player !== gameState.myPlayerNum) {
                    gameState.lastActionId = val.action.id;
                    executeFire(val.action);
                }
            }
        });
    } catch (e) { console.error(e); }
});

function startGame() {
    gameState.isGameStarted = true;
    lobbyContainer.style.display = 'none';
    gameContainer.style.display = 'flex';
    
    const otherPlayerNum = gameState.myPlayerNum === 1 ? 2 : 1;
    onValue(ref(db, `rooms/${currentRoomCode}/players/${otherPlayerNum}`), (snap) => {
        if (snap.exists()) {
            const data = snap.val();
            if (data.x !== undefined) gameState.players[otherPlayerNum].x = data.x;
            if (data.angle !== undefined) gameState.players[otherPlayerNum].angle = data.angle;
        }
    });
    updateTurnUI();
    gameLoop();
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
    const ix = Math.max(0, Math.min(1199, Math.floor(x)));
    const y = gameState.terrain[ix] || 450;
    const slopeX = Math.max(0, Math.min(1199, Math.floor(x + 10)));
    const slopeY = gameState.terrain[slopeX] || 450;
    const rotationRad = Math.atan2(slopeY - y, slopeX - x);
    return { y, rotationRad };
}

function handleInput() {
    if (gameState.turn !== gameState.myPlayerNum || gameState.projectile.active) return;
    
    const p = gameState.players[gameState.myPlayerNum];
    const currentWeaponInfo = WEAPONS[gameState.selectedWeapon];
    let stateChanged = false;

    if (keys['ArrowLeft'] && gameState.fuel > 0) { p.x -= 2.5; gameState.fuel -= 1; stateChanged = true; }
    if (keys['ArrowRight'] && gameState.fuel > 0) { p.x += 2.5; gameState.fuel -= 1; stateChanged = true; }
    if (p.x < 30) p.x = 30; if (p.x > canvas.width - 30) p.x = canvas.width - 30;

    if (keys['ArrowUp'] && gameState.angle < 90) { gameState.angle += 1; stateChanged = true; }
    if (keys['ArrowDown'] && gameState.angle > 0) { gameState.angle -= 1; stateChanged = true; }
    
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
        gameState.power += gameState.powerSpeed * gameState.powerDir;
        gameState.powerSpeed += 0.05; 
        
        if (gameState.power >= currentWeaponInfo.maxPower) { 
            gameState.power = currentWeaponInfo.maxPower; 
            gameState.powerDir = -1; 
        } else if (gameState.power <= 0) { 
            gameState.power = 0; 
            gameState.powerDir = 1; 
        }
    }
    
    document.getElementById('status').innerText = 
        `ANGLE: ${gameState.angle}° | POWER: ${Math.floor(gameState.power)} | FUEL: ${Math.floor(gameState.fuel)}`;
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
    update(roomRef, { action: actionData });
    executeFire(actionData);
}

function executeFire(data) {
    gameState.projectile = { 
        x: data.startX, y: data.startY, vx: data.vx, vy: data.vy, 
        active: true, owner: data.player, weapon: data.weapon 
    };
}

function updatePhysics() {
    if (!gameState.projectile.active) return;

    const weaponInfo = WEAPONS[gameState.projectile.weapon];

    gameState.projectile.x += gameState.projectile.vx;
    gameState.projectile.vy += weaponInfo.gravity; 
    gameState.projectile.y += gameState.projectile.vy;

    const px = Math.floor(gameState.projectile.x);
    const hitGround = px >= 0 && px < 1200 && gameState.projectile.y >= gameState.terrain[px];
    const outOfBounds = gameState.projectile.y > canvas.height + 100 || gameState.projectile.x < -100 || gameState.projectile.x > canvas.width + 100;

    if (hitGround || outOfBounds) {
        gameState.projectile.active = false;
        
        if (gameState.projectile.owner === gameState.myPlayerNum && !gameState.isProcessingHit) {
            gameState.isProcessingHit = true; 
            
            if (hitGround) {
                checkHitAndSync(); 
                applyCrater(gameState.projectile.x, weaponInfo.crater);
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

function applyCrater(craterX, radius) {
    const startX = Math.max(0, Math.floor(craterX - radius));
    const endX = Math.min(canvas.width - 1, Math.floor(craterX + radius));

    for (let x = startX; x <= endX; x++) {
        const dx = x - craterX;
        const distSq = radius * radius - dx * dx;
        if (distSq > 0) {
            const dy = Math.sqrt(distSq); 
            const surfaceY = gameState.terrain[x];
            const newY = Math.max(surfaceY, surfaceY + dy * 0.8);

            if (newY < canvas.height - 10) gameState.terrain[x] = newY;
        }
    }
}

function checkHitAndSync() {
    const targetId = gameState.myPlayerNum === 1 ? 2 : 1;
    const tX = gameState.players[targetId].x;
    const tY = getTerrainInfo(tX).y;
    const dist = Math.hypot(gameState.projectile.x - tX, gameState.projectile.y - tY);
    const weaponInfo = WEAPONS[gameState.projectile.weapon];
    
    if (dist < weaponInfo.crater + 20) {
        const newHP = Math.max(0, gameState.players[targetId].hp - weaponInfo.dmg);
        const hpUpdate = {}; hpUpdate[`hp${targetId}`] = newHP;
        update(roomRef, hpUpdate);

        if (newHP <= 0) {
            alert(`PLAYER ${gameState.myPlayerNum} WIN!`);
            location.reload();
        }
    }
}

function updateTurnUI() {
    const el = document.getElementById('turn-display');
    const isMyTurn = gameState.turn === gameState.myPlayerNum;
    el.innerText = isMyTurn ? "YOUR TURN" : "WAITING...";
    el.style.color = isMyTurn ? "#f1c40f" : "#666";
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, '#111'); bg.addColorStop(1, '#2c2c2a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#7a6a4a'; 
    ctx.beginPath(); ctx.moveTo(0, canvas.height); 
    for (let x = 0; x < canvas.width; x++) { ctx.lineTo(x, gameState.terrain[x]); }
    ctx.lineTo(canvas.width, canvas.height); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#554a3a'; ctx.lineWidth = 2; ctx.stroke();

    for (let id in gameState.players) {
        const p = gameState.players[id];
        const tInfo = getTerrainInfo(p.x); 
        ctx.save();
        ctx.translate(p.x, tInfo.y - 12); 
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

    // [NEW] 궤적(포물선) 그리기 - 스페이스바 누르고 있을 때만!
    if (gameState.isCharging && gameState.turn === gameState.myPlayerNum) {
        const currentWeaponInfo = WEAPONS[gameState.selectedWeapon];
        const radian = gameState.angle * (Math.PI / 180);
        const dir = gameState.myPlayerNum === 1 ? 1 : -1;
        const pX = gameState.players[gameState.myPlayerNum].x;
        const tInfo = getTerrainInfo(pX);

        let simX = pX;
        let simY = tInfo.y - 35;
        let simVx = Math.cos(radian) * (gameState.power * 0.25) * dir;
        let simVy = -Math.sin(radian) * (gameState.power * 0.25);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(simX, simY);
        // 반투명 흰색 점선 설정
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 12]); // 점선 길이와 간격 설정

        // 최대 150틱(약 2.5초치) 시뮬레이션
        for (let i = 0; i < 150; i++) {
            simX += simVx;
            simVy += currentWeaponInfo.gravity;
            simY += simVy;
            ctx.lineTo(simX, simY);
            
            // 지형에 충돌하거나 화면 밖으로 나가면 그리기 중단
            const checkX = Math.floor(simX);
            if (checkX >= 0 && checkX < canvas.width && simY >= gameState.terrain[checkX]) break;
            if (simY > canvas.height) break;
        }
        ctx.stroke();
        ctx.restore();
    }

    if (gameState.projectile.active) {
        const projWeaponInfo = WEAPONS[gameState.projectile.weapon];
        ctx.fillStyle = projWeaponInfo.color;
        ctx.beginPath(); ctx.arc(gameState.projectile.x, gameState.projectile.y, 6, 0, Math.PI*2); ctx.fill();
    }

    // 무기 UI 패널
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(20, 20, 230, 130);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, 230, 130);

    const keysArr = ['Q', 'W', 'E', 'R'];
    keysArr.forEach((key, idx) => {
        const wInfo = WEAPONS[key];
        const isSelected = (gameState.selectedWeapon === key);
        const yPos = 45 + (idx * 28);

        if (isSelected) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fillRect(22, yPos - 16, 226, 26);
        }

        ctx.fillStyle = wInfo.color;
        ctx.beginPath();
        ctx.arc(40, yPos - 4, 6, 0, Math.PI * 2);
        ctx.fill();
        if (isSelected) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        ctx.fillStyle = isSelected ? '#ffffff' : '#aaaaaa';
        ctx.font = isSelected ? 'bold 13px sans-serif' : '13px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`[${key}] ${wInfo.name}`, 55, yPos);
        
        ctx.font = '11px sans-serif';
        ctx.fillStyle = isSelected ? '#dddddd' : '#777777';
        // [MODIFIED] EXP 대신 '사거리'로 텍스트 변경
        ctx.fillText(`ATK:${wInfo.dmg} | 사거리:${wInfo.maxPower}`, 135, yPos);
    });
    ctx.restore();

    if (gameState.isCharging && gameState.turn === gameState.myPlayerNum) {
        const currentWeaponInfo = WEAPONS[gameState.selectedWeapon];
        const barWidth = 300, barX = (canvas.width - 300) / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(barX, 30, barWidth, 15);
        const fillRatio = gameState.power / currentWeaponInfo.maxPower;
        ctx.fillStyle = currentWeaponInfo.color; 
        ctx.fillRect(barX, 30, fillRatio * barWidth, 15);
    }
}

function gameLoop() {
    if (gameState.isGameStarted && gameState.terrain.length > 0) {
        handleInput();
        updatePhysics();
        draw();
    }
    requestAnimationFrame(gameLoop);
}
