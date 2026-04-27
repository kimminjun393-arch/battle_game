import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, get, set, update, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// 1. Firebase 설정 (본인 키 유지)
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

// 2. 게임 상태
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
    power: 0,
    isCharging: false,
    isGameStarted: false,
    players: {
        1: { x: 100, y: 440, color: '#3498db', hp: 100 },
        2: { x: 700, y: 440, color: '#e74c3c', hp: 100 }
    },
    projectile: { x: 0, y: 0, vx: 0, vy: 0, active: false }
};

const keys = {};

// 3. 매칭 시스템
joinBtn.addEventListener('click', async () => {
    const roomCode = roomCodeInput.value.trim();
    if (!roomCode) return alert("방 코드를 입력하세요!");

    joinBtn.disabled = true;
    lobbyStatus.innerText = "연결 중...";
    roomRef = ref(db, 'rooms/' + roomCode);

    try {
        const snapshot = await get(roomRef);
        const data = snapshot.val();

        if (!data || data.playersCount === 0) {
            gameState.myPlayerNum = 1;
            await set(roomRef, { playersCount: 1 });
            onDisconnect(roomRef).remove();
            lobbyStatus.innerText = "상대방을 기다리는 중...";
            onValue(roomRef, (snap) => {
                const val = snap.val();
                if (val && val.playersCount === 2 && !gameState.isGameStarted) startGame();
                if (val && val.action && val.action.player !== gameState.myPlayerNum) executeFire(val.action);
            });
        } else if (data.playersCount === 1) {
            gameState.myPlayerNum = 2;
            await update(roomRef, { playersCount: 2 });
            onValue(roomRef, (snap) => {
                const val = snap.val();
                if (val && val.action && val.action.player !== gameState.myPlayerNum) executeFire(val.action);
            });
            startGame();
        } else {
            alert("방이 꽉 찼습니다!");
            joinBtn.disabled = false;
        }
    } catch (e) { console.error(e); }
});

function startGame() {
    gameState.isGameStarted = true;
    lobbyContainer.style.display = 'none';
    gameContainer.style.display = 'flex';
    updateTurnUI();
    gameLoop();
}

// 4. 컨트롤
window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && gameState.isCharging) sendFireAction();
    keys[e.code] = false;
});

function handleInput() {
    if (gameState.turn !== gameState.myPlayerNum || gameState.projectile.active) return;
    if (keys['ArrowUp'] && gameState.angle < 90) gameState.angle += 1;
    if (keys['ArrowDown'] && gameState.angle > 0) gameState.angle -= 1;
    if (keys['Space']) {
        gameState.isCharging = true;
        if (gameState.power < 100) gameState.power += 1.2;
    }
    document.getElementById('status').innerText = `ANGLE: ${gameState.angle}° | POWER: ${Math.floor(gameState.power)}`;
}

// 5. 물리 & 동기화
function sendFireAction() {
    const radian = gameState.angle * (Math.PI / 180);
    const dir = gameState.turn === 1 ? 1 : -1;
    const p = gameState.players[gameState.turn];
    const actionData = {
        player: gameState.myPlayerNum,
        startX: p.x, startY: p.y - 20,
        vx: Math.cos(radian) * (gameState.power * 0.22) * dir,
        vy: -Math.sin(radian) * (gameState.power * 0.22),
        timestamp: Date.now()
    };
    update(roomRef, { action: actionData });
    executeFire(actionData);
    gameState.isCharging = false;
    gameState.power = 0;
}

function executeFire(data) {
    gameState.projectile = { x: data.startX, y: data.startY, vx: data.vx, vy: data.vy, active: true };
}

function updatePhysics() {
    if (!gameState.projectile.active) return;
    gameState.projectile.x += gameState.projectile.vx;
    gameState.projectile.vy += 0.25; // 중력
    gameState.projectile.y += gameState.projectile.vy;

    if (gameState.projectile.y > 470) {
        checkHit();
        gameState.projectile.active = false;
        gameState.turn = gameState.turn === 1 ? 2 : 1;
        updateTurnUI();
    }
}

function checkHit() {
    const targetId = gameState.turn === 1 ? 2 : 1;
    const target = gameState.players[targetId];
    const dist = Math.hypot(gameState.projectile.x - target.x, gameState.projectile.y - target.y);
    if (dist < 40) {
        target.hp -= 35;
        document.getElementById(`hp${targetId}`).style.width = Math.max(0, target.hp) + '%';
        if (target.hp <= 0) {
            alert(`PLAYER ${gameState.turn} WIN!`);
            location.reload();
        }
    }
}

function updateTurnUI() {
    const el = document.getElementById('turn-display');
    const isMyTurn = gameState.turn === gameState.myPlayerNum;
    el.innerText = isMyTurn ? "YOUR TURN" : "WAITING...";
    el.style.color = isMyTurn ? "#f1c40f" : "#475569";
}

// 6. 그래픽 (STELLAR STRIKE 전용 디자인)
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 배경 그라데이션
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, '#0f172a'); bg.addColorStop(1, '#1e293b');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 지면
    ctx.fillStyle = '#334155'; ctx.fillRect(0, 470, canvas.width, 30);

    // 탱크 그리기
    for (let id in gameState.players) {
        const p = gameState.players[id];
        ctx.save();
        ctx.translate(p.x, p.y - 15);
        
        // 포신
        ctx.save();
        const dir = (id == 1) ? 1 : -1;
        const currentAngle = (gameState.turn == id) ? gameState.angle : 45;
        ctx.rotate(-currentAngle * (Math.PI / 180) * dir);
        ctx.fillStyle = p.color;
        ctx.fillRect(0, -4, 35, 8);
        ctx.restore();

        // 몸통
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI*2); ctx.fill(); // 터릿
        ctx.fillRect(-25, 5, 50, 20); // 바디
        ctx.restore();
    }

    // 포탄
    if (gameState.projectile.active) {
        ctx.fillStyle = '#f1c40f';
        ctx.beginPath(); ctx.arc(gameState.projectile.x, gameState.projectile.y, 5, 0, Math.PI*2); ctx.fill();
        // 잔상 효과 (심플)
        ctx.shadowBlur = 10; ctx.shadowColor = "#f1c40f";
    } else { ctx.shadowBlur = 0; }
}

function gameLoop() {
    if (gameState.isGameStarted) { handleInput(); updatePhysics(); draw(); }
    requestAnimationFrame(gameLoop);
}
