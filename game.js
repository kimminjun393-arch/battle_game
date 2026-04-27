// ==========================================
// 1. Firebase 설정 및 초기화
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, get, set, update, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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

// ==========================================
// 2. 게임 상태 및 DOM 요소
// ==========================================
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

// ==========================================
// 3. 로비 & 매칭 시스템 (Room Code)
// ==========================================
joinBtn.addEventListener('click', async () => {
    const roomCode = roomCodeInput.value.trim();
    if (!roomCode) {
        alert("방 코드를 입력해주세요!");
        return;
    }

    joinBtn.disabled = true;
    lobbyStatus.innerText = "방 정보 확인 중...";
    roomRef = ref(db, 'rooms/' + roomCode);

    try {
        const snapshot = await get(roomRef);
        const data = snapshot.val();

        if (!data || data.playersCount === 0) {
            // 방이 없으면 내가 방장(1P)이 됨
            gameState.myPlayerNum = 1;
            await set(roomRef, { playersCount: 1 });
            // 내가 나가면 방 폭파
            onDisconnect(roomRef).remove(); 
            
            lobbyStatus.innerText = `[${roomCode}] 방 개설! 상대방(2P)을 기다립니다...`;

            // 2P 접속 및 액션 대기
            onValue(roomRef, (snap) => {
                const val = snap.val();
                if (!val) return;
                
                if (val.playersCount === 2 && !gameState.isGameStarted) {
                    startGame();
                }
                if (val.action && val.action.player !== gameState.myPlayerNum) {
                    executeFire(val.action);
                }
            });

        } else if (data.playersCount === 1) {
            // 방에 1명이 있으면 내가 2P로 접속
            gameState.myPlayerNum = 2;
            await update(roomRef, { playersCount: 2 });
            lobbyStatus.innerText = "접속 완료! 게임을 시작합니다.";
            
            // 1P의 액션 대기
            onValue(roomRef, (snap) => {
                const val = snap.val();
                if (val && val.action && val.action.player !== gameState.myPlayerNum) {
                    executeFire(val.action);
                }
            });
            startGame();

        } else {
            alert("이미 꽉 찬 방입니다!");
            joinBtn.disabled = false;
            lobbyStatus.innerText = "다른 방 코드를 입력하세요.";
        }
    } catch (error) {
        console.error("Firebase 에러:", error);
        alert("데이터베이스 연결 실패!");
        joinBtn.disabled = false;
    }
});

function startGame() {
    gameState.isGameStarted = true;
    lobbyContainer.style.display = 'none';
    gameContainer.style.display = 'flex';
    document.getElementById('turn-display').innerText = `당신은 ${gameState.myPlayerNum}P 입니다!`;
    setTimeout(() => updateTurnUI(), 2000); // 2초 뒤 진짜 턴 표시
    gameLoop();
}

// ==========================================
// 4. 입력 및 조작
// ==========================================
window.addEventListener('keydown', (e) => { keys[e.code] = true; });
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
        if (gameState.power < 100) gameState.power += 1.5;
    } else {
        gameState.isCharging = false;
        gameState.power = 0;
    }

    document.getElementById('status').innerText = `각도: ${gameState.angle}° | 파워: ${Math.floor(gameState.power)}`;
}

// ==========================================
// 5. 물리 엔진 및 동기화
// ==========================================
function sendFireAction() {
    const radian = gameState.angle * (Math.PI / 180);
    const direction = gameState.turn === 1 ? 1 : -1;
    const p = gameState.players[gameState.turn];
    
    // Firebase로 쏜 정보 전송 (나의 화면은 onValue가 아니라 즉시 실행)
    const actionData = {
        player: gameState.myPlayerNum,
        startX: p.x,
        startY: p.y - 20,
        vx: Math.cos(radian) * (gameState.power * 0.2) * direction,
        vy: -Math.sin(radian) * (gameState.power * 0.2),
        timestamp: Date.now() // 중복 방지용
    };

    update(roomRef, { action: actionData });
    executeFire(actionData);
    
    gameState.isCharging = false;
    gameState.power = 0;
}

function executeFire(data) {
    gameState.projectile.x = data.startX;
    gameState.projectile.y = data.startY;
    gameState.projectile.vx = data.vx;
    gameState.projectile.vy = data.vy;
    gameState.projectile.active = true;
}

function updatePhysics() {
    if (!gameState.projectile.active) return;

    const gravity = 0.3;
    gameState.projectile.x += gameState.projectile.vx;
    gameState.projectile.vy += gravity;
    gameState.projectile.y += gameState.projectile.vy;

    if (gameState.projectile.y > 470) {
        checkHit();
        resetTurn();
    }
}

function checkHit() {
    const targetNum = gameState.turn === 1 ? 2 : 1;
    const target = gameState.players[targetNum];
    const dist = Math.hypot(gameState.projectile.x - target.x, gameState.projectile.y - target.y);

    if (dist < 40) {
        target.hp -= 30;
        document.getElementById(`hp${targetNum}`).style.width = Math.max(0, target.hp) + '%';
        if (target.hp <= 0) {
            setTimeout(() => {
                alert(`Player ${gameState.turn} 승리!`);
                location.reload();
            }, 100);
        }
    }
}

function resetTurn() {
    gameState.projectile.active = false;
    gameState.turn = gameState.turn === 1 ? 2 : 1;
    updateTurnUI();
}

function updateTurnUI() {
    const turnDisplay = document.getElementById('turn-display');
    const isMyTurn = gameState.turn === gameState.myPlayerNum;
    turnDisplay.innerText = isMyTurn ? "내 차례입니다!" : "상대방 턴 대기 중...";
    turnDisplay.style.color = gameState.turn === 1 ? '#3498db' : '#e74c3c';
}

// ==========================================
// 6. 렌더링 및 루프
// ==========================================
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#95a5a6';
    ctx.fillRect(0, 470, canvas.width, 30);

    for (let id in gameState.players) {
        const p = gameState.players[id];
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 15, p.y - 15, 30, 15);
        ctx.beginPath();
        ctx.arc(p.x, p.y - 15, 10, 0, Math.PI * 2);
        ctx.fill();
    }

    if (gameState.projectile.active) {
        ctx.fillStyle = '#2c3e50';
        ctx.beginPath();
        ctx.arc(gameState.projectile.x, gameState.projectile.y, 6, 0, Math.PI * 2);
        ctx.fill();
    }
}

function gameLoop() {
    if (gameState.isGameStarted) {
        handleInput();
        updatePhysics();
        draw();
    }
    requestAnimationFrame(gameLoop);
}
