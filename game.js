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
    terrain: []
};

const keys = {};
let lastMoveSync = 0;

function generateTerrain() {
    let t = [];
    let base = 350; 
    let freq1 = 0.004, amp1 = 60;
    let freq2 = 0.015, amp2 = 25;
    const startRef = Math.random() * 2000;

    for (let x = 0; x < canvas.width; x++) {
        const y = base + 
                  Math.sin((x + startRef) * freq1) * amp1 + 
                  Math.sin((x + startRef) * freq2) * amp2;
        t.push(y);
    }
    return t;
}

joinBtn.addEventListener('click', async () => {
    currentRoomCode = roomCodeInput.value.trim();
    if (!currentRoomCode) return alert("방 코드를 입력하세요!");

    joinBtn.disabled = true;
    lobbyStatus.innerText = "전투 준비 중...";
    roomRef = ref(db, 'rooms/' + currentRoomCode);

    try {
        const snapshot = await get(roomRef);
        const data = snapshot.val();

        if (!data || data.playersCount === 0) {
            gameState.myPlayerNum = 1;
            const t = generateTerrain();
            // 방 생성 시 지형과 기본 턴 상태를 명확히 세팅
            await set(roomRef, { 
                playersCount: 1, 
                terrain: t, 
                turn: 1,
                action: null 
            });
            gameState.terrain = t;
            onDisconnect(roomRef).remove();
            lobbyStatus.innerText = "상대방 대기 중...";
        } else {
            gameState.myPlayerNum = 2;
            gameState.terrain = data.terrain;
            await update(roomRef, { playersCount: 2 });
        }

        // 공통 리스너 (턴 정보 및 발사 액션 감시)
        onValue(roomRef, (snap) => {
            const val = snap.val();
            if (!val) return;
            if (val.playersCount === 2 && !gameState.isGameStarted) startGame();
            
            // 턴 동기화
            if (val.turn !== undefined) gameState.turn = val.turn;
            
            // 발사 액션 동기화 (내가 쏜 게 아닐 때만 실행)
            if (val.action && val.action.player !== gameState.myPlayerNum) {
                executeFire(val.action);
                // 발사 데이터를 읽었으면 바로 비워줌 (중복 발사 방지)
                update(roomRef, { action: null });
            }
        });

    } catch (e) { console.error(e); }
});

function startGame() {
    gameState.isGameStarted = true;
    lobbyContainer.style.display = 'none';
    gameContainer.style.display = 'flex';
    
    // 상대방 위치 실시간 감지
    const otherPlayerNum = gameState.myPlayerNum === 1 ? 2 : 1;
    onValue(ref(db, `rooms/${currentRoomCode}/players/${otherPlayerNum}`), (snap) => {
        if (snap.exists() && snap.val().x !== undefined) {
            gameState.players[otherPlayerNum].x = snap.val().x;
        }
    });

    updateTurnUI();
    gameLoop();
}

window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && gameState.isCharging) sendFireAction();
    if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && gameState.turn === gameState.myPlayerNum) {
        update(ref(db, `rooms/${currentRoomCode}/players/${gameState.myPlayerNum}`), { 
            x: gameState.players[gameState.myPlayerNum].x 
        });
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
    let moved = false;

    if (keys['ArrowLeft'] && gameState.fuel > 0) { p.x -= 2.5; gameState.fuel -= 1; moved = true; }
    if (keys['ArrowRight'] && gameState.fuel > 0) { p.x += 2.5; gameState.fuel -= 1; moved = true; }

    if (p.x < 30) p.x = 30; if (p.x > canvas.width - 30) p.x = canvas.width - 30;

    if (moved) {
        const now = Date.now();
        if (now - lastMoveSync > 80) {
            update(ref(db, `rooms/${currentRoomCode}/players/${gameState.myPlayerNum}`), { x: p.x });
            lastMoveSync = now;
        }
    }

    if (keys['ArrowUp'] && gameState.angle < 90) gameState.angle += 1;
    if (keys['ArrowDown'] && gameState.angle > 0) gameState.angle -= 1;
    
    if (keys['Space']) {
        gameState.isCharging = true;
        gameState.power += gameState.powerSpeed * gameState.powerDir;
        gameState.powerSpeed += 0.04; 
        if (gameState.power >= 100) { gameState.power = 100; gameState.powerDir = -1; }
        else if (gameState.power <= 0) { gameState.power = 0; gameState.powerDir = 1; }
    }
    
    document.getElementById('status').innerText = 
        `ANGLE: ${gameState.angle}° | POWER: ${Math.floor(gameState.power)} | FUEL: ${Math.floor(gameState.fuel)}`;
}

function sendFireAction() {
    const radian = gameState.angle * (Math.PI / 180);
    const dir = gameState.myPlayerNum === 1 ? 1 : -1;
    const pX = gameState.players[gameState.myPlayerNum].x;
    const tInfo = getTerrainInfo(pX);

    const actionData = {
        player: gameState.myPlayerNum,
        // 포탄이 땅에 바로 닿지 않도록 시작 높이를 -35로 넉넉히 줌
        startX: pX, startY: tInfo.y - 35,
        vx: Math.cos(radian) * (gameState.power * 0.25) * dir,
        vy: -Math.sin(radian) * (gameState.power * 0.25)
    };
    
    // DB에 발사 명령 전달
    update(roomRef, { action: actionData });
    executeFire(actionData);
    
    gameState.isCharging = false;
    gameState.power = 0; gameState.powerDir = 1; gameState.powerSpeed = 1.5;
}

function executeFire(data) {
    gameState.projectile = { x: data.startX, y: data.startY, vx: data.vx, vy: data.vy, active: true };
}

function updatePhysics() {
    if (!gameState.projectile.active) return;

    gameState.projectile.x += gameState.projectile.vx;
    gameState.projectile.vy += 0.22; // 중력 살짝 조정
    gameState.projectile.y += gameState.projectile.vy;

    const px = Math.floor(gameState.projectile.x);
    
    // [보완] 충돌 조건 세분화: 화면 양옆/아래로 나가거나 땅에 닿았을 때
    const hitGround = px >= 0 && px < 1200 && gameState.projectile.y >= gameState.terrain[px];
    const outOfBounds = gameState.projectile.y > canvas.height + 50 || gameState.projectile.x < -50 || gameState.projectile.x > canvas.width + 50;

    if (hitGround || outOfBounds) {
        if (hitGround) checkHit();
        
        gameState.projectile.active = false;
        
        // [중요] 발사한 사람이 턴 전환 권한을 가짐 (동기화 꼬임 방지)
        if (gameState.turn === gameState.myPlayerNum) {
            const nextTurn = gameState.turn === 1 ? 2 : 1;
            update(roomRef, { turn: nextTurn, action: null });
        }
        
        gameState.fuel = 100;
        updateTurnUI();
    }
}

function checkHit() {
    const targetId = gameState.turn === 1 ? 2 : 1;
    const tX = gameState.players[targetId].x;
    const tY = getTerrainInfo(tX).y;
    const dist = Math.hypot(gameState.projectile.x - tX, gameState.projectile.y - tY);
    
    if (dist < 50) {
        // 내 화면에서 데미지 처리 (나중에 HP도 DB 연동하면 좋음)
        gameState.players[targetId].hp -= 35;
        document.getElementById(`hp${targetId}`).style.width = Math.max(0, gameState.players[targetId].hp) + '%';
        if (gameState.players[targetId].hp <= 0) {
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

    // 배경
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

    // 탱크
    for (let id in gameState.players) {
        const p = gameState.players[id];
        const tInfo = getTerrainInfo(p.x);
        
        ctx.save();
        ctx.translate(p.x, tInfo.y - 12);
        
        // 포신
        ctx.save();
        const dir = (id == 1) ? 1 : -1;
        const currentAngle = (gameState.turn == id) ? gameState.angle : 45;
        ctx.rotate(-currentAngle * (Math.PI / 180) * dir);
        ctx.fillStyle = p.color; ctx.fillRect(0, -3, 30, 6);
        ctx.restore();

        // 몸통 (회전)
        ctx.rotate(tInfo.rotationRad);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI*2); ctx.fill();
        ctx.fillRect(-22, 4, 44, 16);
        ctx.restore();
    }

    // 포탄
    if (gameState.projectile.active) {
        ctx.fillStyle = '#f1c40f';
        ctx.beginPath(); ctx.arc(gameState.projectile.x, gameState.projectile.y, 5, 0, Math.PI*2); ctx.fill();
    }

    // 파워 게이지
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
