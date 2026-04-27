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

let gameState = {
    turn: 1, 
    myPlayerNum: 1, 
    angle: 45,
    power: 0, powerDir: 1, powerSpeed: 1.5,
    fuel: 100,
    isCharging: false, isGameStarted: false,
    players: {
        1: { x: 150, hp: 100, color: '#3498db' },
        2: { x: 1050, hp: 100, color: '#e74c3c' }
    },
    projectile: { x: 0, y: 0, vx: 0, vy: 0, active: false },
    terrain: [],
    lastActionId: 0,
    isProcessingHit: false // [NEW] 충돌 처리 중 중복 방지 플래그
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
                playersCount: 1, 
                terrain: t, 
                turn: 1, 
                action: null,
                hp1: 100, hp2: 100 // HP 초기화
            });
            gameState.terrain = t;
            onDisconnect(roomRef).remove();
            lobbyStatus.innerText = "상대방 대기 중...";
        } else {
            gameState.myPlayerNum = 2;
            gameState.terrain = data.terrain;
            await update(roomRef, { playersCount: 2 });
        }

        // 통합 리스너: DB의 변화를 내 로컬 상태에 동기화
        onValue(roomRef, (snap) => {
            const val = snap.val();
            if (!val) return;
            
            if (val.playersCount === 2 && !gameState.isGameStarted) startGame();
            
            // 1. 턴 동기화
            if (val.turn !== undefined) {
                gameState.turn = val.turn;
                updateTurnUI();
            }

            // 2. HP 동기화
            if (val.hp1 !== undefined) {
                gameState.players[1].hp = val.hp1;
                document.getElementById('hp1').style.width = val.hp1 + '%';
            }
            if (val.hp2 !== undefined) {
                gameState.players[2].hp = val.hp2;
                document.getElementById('hp2').style.width = val.hp2 + '%';
            }
            
            // 3. 미사일 발사 동기화
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
    
    // 상대방 X 위치만 따로 감시 (성능 최적화)
    const otherPlayerNum = gameState.myPlayerNum === 1 ? 2 : 1;
    onValue(ref(db, `rooms/${currentRoomCode}/players/${otherPlayerNum}/x`), (snap) => {
        if (snap.exists()) gameState.players[otherPlayerNum].x = snap.val();
    });
    updateTurnUI();
    gameLoop();
}

window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && gameState.isCharging) {
        if (gameState.turn === gameState.myPlayerNum && !gameState.projectile.active) {
            sendFireAction();
        }
        gameState.isCharging = false;
        gameState.power = 0;
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
    // 발사 중이거나 내 턴이 아니면 아무것도 못함
    if (gameState.turn !== gameState.myPlayerNum || gameState.projectile.active) return;
    
    const p = gameState.players[gameState.myPlayerNum];
    let moved = false;

    if (keys['ArrowLeft'] && gameState.fuel > 0) { p.x -= 2.5; gameState.fuel -= 1; moved = true; }
    if (keys['ArrowRight'] && gameState.fuel > 0) { p.x += 2.5; gameState.fuel -= 1; moved = true; }
    if (p.x < 30) p.x = 30; if (p.x > canvas.width - 30) p.x = canvas.width - 30;

    if (moved) {
        const now = Date.now();
        if (now - lastMoveSync > 50) {
            // 중요: X 좌표만 업데이트 (턴 정보를 건드리지 않음)
            update(ref(db, `rooms/${currentRoomCode}/players/${gameState.myPlayerNum}`), { x: p.x });
            lastMoveSync = now;
        }
    }

    if (keys['ArrowUp'] && gameState.angle < 90) gameState.angle += 1;
    if (keys['ArrowDown'] && gameState.angle > 0) gameState.angle -= 1;
    
    if (keys['Space']) {
        gameState.isCharging = true;
        gameState.power += gameState.powerSpeed * gameState.powerDir;
        gameState.powerSpeed += 0.05; 
        if (gameState.power >= 100) { gameState.power = 100; gameState.powerDir = -1; }
        else if (gameState.power <= 0) { gameState.power = 0; gameState.powerDir = 1; }
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
        startX: pX, startY: tInfo.y - 35,
        vx: Math.cos(radian) * (gameState.power * 0.25) * dir,
        vy: -Math.sin(radian) * (gameState.power * 0.25)
    };
    
    gameState.lastActionId = actionId;
    gameState.isProcessingHit = false; // 발사 시 플래그 초기화
    update(roomRef, { action: actionData });
    executeFire(actionData);
}

function executeFire(data) {
    gameState.projectile = { x: data.startX, y: data.startY, vx: data.vx, vy: data.vy, active: true };
}

function updatePhysics() {
    if (!gameState.projectile.active) return;

    gameState.projectile.x += gameState.projectile.vx;
    gameState.projectile.vy += 0.22;
    gameState.projectile.y += gameState.projectile.vy;

    const px = Math.floor(gameState.projectile.x);
    const hitGround = px >= 0 && px < 1200 && gameState.projectile.y >= gameState.terrain[px];
    const outOfBounds = gameState.projectile.y > canvas.height + 100 || gameState.projectile.x < -100 || gameState.projectile.x > canvas.width + 100;

    if (hitGround || outOfBounds) {
        gameState.projectile.active = false;
        
        // [핵심] 턴을 넘기는 권한은 오직 미사일을 쏜 사람에게만 있음
        if (gameState.turn === gameState.myPlayerNum && !gameState.isProcessingHit) {
            gameState.isProcessingHit = true; // 중복 실행 방지
            
            if (hitGround) checkHitAndSync(); // 데미지 계산 및 DB 동기화
            
            const nextTurn = gameState.turn === 1 ? 2 : 1;
            // 턴 전환과 미사일 데이터 삭제를 동시에 수행
            update(roomRef, { 
                turn: nextTurn, 
                action: null 
            }).then(() => {
                gameState.isProcessingHit = false;
            });
        }
        
        gameState.fuel = 100;
        updateTurnUI();
    }
}

// 쏜 사람이 상대방의 HP를 계산해서 DB에 올림 (전체 동기화)
function checkHitAndSync() {
    const targetId = gameState.turn === 1 ? 2 : 1;
    const tX = gameState.players[targetId].x;
    const tY = getTerrainInfo(tX).y;
    const dist = Math.hypot(gameState.projectile.x - tX, gameState.projectile.y - tY);
    
    if (dist < 50) {
        const newHP = Math.max(0, gameState.players[targetId].hp - 35);
        const hpUpdate = {};
        hpUpdate[`hp${targetId}`] = newHP;
        update(roomRef, hpUpdate); // DB에 깎인 HP 반영

        if (newHP <= 0) {
            alert(`PLAYER ${gameState.turn} WIN!`);
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

    // 지형
    ctx.fillStyle = '#7a6a4a';
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    for (let x = 0; x < canvas.width; x++) { ctx.lineTo(x, gameState.terrain[x]); }
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath(); ctx.fill();

    // 탱크들
    for (let id in gameState.players) {
        const p = gameState.players[id];
        const tInfo = getTerrainInfo(p.x);
        ctx.save();
        ctx.translate(p.x, tInfo.y - 12);
        
        // 포신
        ctx.save();
        const dir = (id == 1) ? 1 : -1;
        // 내 탱크면 내가 조절하는 각도, 상대 탱크면 45도 고정 (또는 상대 각도 동기화 추가 가능)
        const currentAngle = (gameState.myPlayerNum == id) ? gameState.angle : 45;
        ctx.rotate(-currentAngle * (Math.PI / 180) * dir);
        ctx.fillStyle = p.color; ctx.fillRect(0, -3, 30, 6);
        ctx.restore();

        // 몸통
        ctx.rotate(tInfo.rotationRad);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI*2); ctx.fill();
        ctx.fillRect(-22, 4, 44, 16);
        ctx.restore();
    }

    if (gameState.projectile.active) {
        ctx.fillStyle = '#f1c40f';
        ctx.beginPath(); ctx.arc(gameState.projectile.x, gameState.projectile.y, 5, 0, Math.PI*2); ctx.fill();
    }

    if (gameState.isCharging && gameState.turn === gameState.myPlayerNum) {
        const barWidth = 300, barX = (canvas.width - 300) / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(barX, 30, barWidth, 15);
        ctx.fillStyle = '#f1c40f'; ctx.fillRect(barX, 30, (gameState.power/100)*barWidth, 15);
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
