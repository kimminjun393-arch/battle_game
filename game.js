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
    fuel: 100, // [NEW] 연료 시스템 추가
    isCharging: false, isGameStarted: false,
    players: {
        1: { x: 100, y: 440, color: '#3498db', hp: 100 },
        2: { x: 1100, y: 440, color: '#e74c3c', hp: 100 } // 2P 위치도 넓어진 맵에 맞게 수정
    },
    projectile: { x: 0, y: 0, vx: 0, vy: 0, active: false }
};

const keys = {};
let lastMoveSync = 0; // 너무 잦은 데이터 전송을 막기 위한 타이머

joinBtn.addEventListener('click', async () => {
    currentRoomCode = roomCodeInput.value.trim();
    if (!currentRoomCode) return alert("방 코드를 입력하세요!");

    joinBtn.disabled = true;
    lobbyStatus.innerText = "연결 중...";
    roomRef = ref(db, 'rooms/' + currentRoomCode);

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
    
    // [NEW] 상대방의 위치(X좌표) 변경을 실시간으로 감지하는 리스너 추가
    const otherPlayerNum = gameState.myPlayerNum === 1 ? 2 : 1;
    const otherPlayerRef = ref(db, `rooms/${currentRoomCode}/players/${otherPlayerNum}`);
    onValue(otherPlayerRef, (snap) => {
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
    
    // 이동키를 뗐을 때 최종 위치를 한 번 더 동기화하여 정확도 상승
    if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && gameState.turn === gameState.myPlayerNum) {
        update(ref(db, `rooms/${currentRoomCode}/players/${gameState.myPlayerNum}`), { 
            x: gameState.players[gameState.myPlayerNum].x 
        });
    }
    keys[e.code] = false;
});

function handleInput() {
    if (gameState.turn !== gameState.myPlayerNum || gameState.projectile.active) return;
    
    const p = gameState.players[gameState.myPlayerNum];
    let moved = false;

    // [NEW] 연료를 소비하며 좌우 이동
    if (keys['ArrowLeft'] && gameState.fuel > 0) {
        p.x -= 2; gameState.fuel -= 0.8; moved = true;
    }
    if (keys['ArrowRight'] && gameState.fuel > 0) {
        p.x += 2; gameState.fuel -= 0.8; moved = true;
    }

    // 맵 밖으로 나가지 못하게 제한
    if (p.x < 20) p.x = 20;
    if (p.x > canvas.width - 20) p.x = canvas.width - 20;

    // 이동 중일 때 일정 간격(100ms)으로 Firebase에 위치 전송
    if (moved) {
        const now = Date.now();
        if (now - lastMoveSync > 100) {
            update(ref(db, `rooms/${currentRoomCode}/players/${gameState.myPlayerNum}`), { x: p.x });
            lastMoveSync = now;
        }
    }

    // 각도 및 파워 조절
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
    gameState.power = 0; gameState.powerDir = 1; gameState.powerSpeed = 1.5;
}

function executeFire(data) {
    gameState.projectile = { x: data.startX, y: data.startY, vx: data.vx, vy: data.vy, active: true };
}

function updatePhysics() {
    if (!gameState.projectile.active) return;
    gameState.projectile.x += gameState.projectile.vx;
    gameState.projectile.vy += 0.25; 
    gameState.projectile.y += gameState.projectile.vy;

    if (gameState.projectile.y > 470) {
        checkHit();
        gameState.projectile.active = false;
        
        // [NEW] 턴이 넘어갈 때 연료 100으로 꽉 채워주기
        gameState.turn = gameState.turn === 1 ? 2 : 1;
        gameState.fuel = 100; 
        updateTurnUI();
    }
}

function checkHit() {
    const targetId = gameState.turn === 1 ? 2 : 1;
    const target = gameState.players[targetId];
    const dist = Math.hypot(gameState.projectile.x - target.x, gameState.projectile.y - target.y);
    
    // 탱크 크기 판정 약간 넓혀줌
    if (dist < 45) {
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
    
    // UI 업데이트 시 연료 상태도 갱신
    document.getElementById('status').innerText = 
        `ANGLE: ${gameState.angle}° | POWER: 0 | FUEL: ${Math.floor(gameState.fuel)}`;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, '#0f172a'); bg.addColorStop(1, '#1e293b');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#334155'; ctx.fillRect(0, 470, canvas.width, 30);

    for (let id in gameState.players) {
        const p = gameState.players[id];
        ctx.save();
        ctx.translate(p.x, p.y - 15);
        
        ctx.save();
        const dir = (id == 1) ? 1 : -1;
        const currentAngle = (gameState.turn == id) ? gameState.angle : 45;
        ctx.rotate(-currentAngle * (Math.PI / 180) * dir);
        ctx.fillStyle = p.color; ctx.fillRect(0, -4, 35, 8);
        ctx.restore();

        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI*2); ctx.fill();
        ctx.fillRect(-25, 5, 50, 20);
        
        // [NEW] 바퀴(궤도)가 구르는 듯한 디테일 추가 (x좌표에 따라 바퀴 무늬 변경)
        ctx.fillStyle = '#111';
        const wheelOffset = (p.x % 15) / 15 * 10;
        for(let i=0; i<4; i++) {
            ctx.fillRect(-22 + (i * 12) + (wheelOffset > 5 ? 2 : 0), 22, 6, 6);
        }
        ctx.restore();
    }

    if (gameState.projectile.active) {
        ctx.fillStyle = '#f1c40f';
        ctx.beginPath(); ctx.arc(gameState.projectile.x, gameState.projectile.y, 5, 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur = 10; ctx.shadowColor = "#f1c40f";
    } else { ctx.shadowBlur = 0; }

    if (gameState.isCharging && gameState.turn === gameState.myPlayerNum) {
        const barWidth = 300; const barHeight = 20;
        const barX = (canvas.width - barWidth) / 2; const barY = 30;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(barX, barY, barWidth, barHeight);
        
        const redColor = Math.min(255, gameState.power * 2.5);
        const greenColor = Math.max(0, 255 - gameState.power * 2.5);
        ctx.fillStyle = `rgb(255, ${greenColor}, 0)`;
        ctx.fillRect(barX, barY, (gameState.power / 100) * barWidth, barHeight);
        
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(barX, barY, barWidth, barHeight);
    }
}

function gameLoop() {
    if (gameState.isGameStarted) { handleInput(); updatePhysics(); draw(); }
    requestAnimationFrame(gameLoop);
}
