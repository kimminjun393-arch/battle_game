// ==========================================
// 1. Firebase 설정 (나중에 여기에 정보 입력)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// const firebaseConfig = { apiKey: "...", projectId: "..." };
// const app = initializeApp(firebaseConfig);
// const db = getDatabase(app);

// ==========================================
// 2. 게임 상태 (State)
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let gameState = {
    turn: 1, // 1 or 2
    myPlayerNum: 1, // 접속 시 1P인지 2P인지 할당됨
    angle: 45,
    power: 0,
    isCharging: false,
    players: {
        1: { x: 100, y: 440, color: '#3498db', hp: 100 },
        2: { x: 700, y: 440, color: '#e74c3c', hp: 100 }
    },
    projectile: { x: 0, y: 0, vx: 0, vy: 0, active: false }
};

const keys = {};

// ==========================================
// 3. 입력 관리 (Input Manager)
// ==========================================
window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && gameState.isCharging) {
        fireProjectile();
    }
    keys[e.code] = false;
});

function handleInput() {
    // 내 턴이 아니거나 포탄이 날아가는 중이면 조작 불가
    if (gameState.turn !== gameState.myPlayerNum || gameState.projectile.active) return;

    // 각도 조절 (위/아래 화살표)
    if (keys['ArrowUp'] && gameState.angle < 90) gameState.angle += 1;
    if (keys['ArrowDown'] && gameState.angle > 0) gameState.angle -= 1;

    // 파워 충전 (스페이스바)
    if (keys['Space']) {
        gameState.isCharging = true;
        if (gameState.power < 100) gameState.power += 1.5;
    } else {
        gameState.isCharging = false;
        gameState.power = 0;
    }

    // UI 업데이트
    document.getElementById('status').innerText = `각도: ${gameState.angle}° | 파워: ${Math.floor(gameState.power)}`;
}

// ==========================================
// 4. 물리 엔진 & 통신 (Physics & Network)
// ==========================================
function fireProjectile() {
    const p = gameState.players[gameState.turn];
    
    // 수학 공식: 각도(Degree)를 라디안(Radian)으로 변환 후 x, y 속도 계산
    const radian = gameState.angle * (Math.PI / 180);
    // 방향(1P는 오른쪽, 2P는 왼쪽으로 쏨)
    const direction = gameState.turn === 1 ? 1 : -1;
    
    // 서버로 보낼 액션 데이터 (Firebase 연동 시 이 데이터를 서버로 쏩니다)
    const actionData = {
        startX: p.x,
        startY: p.y - 20,
        vx: Math.cos(radian) * (gameState.power * 0.2) * direction, // 파워 스케일링
        vy: -Math.sin(radian) * (gameState.power * 0.2) // Canvas는 위로 갈수록 y가 작아지므로 -
    };

    // 실시간 동기화 함수 (현재는 로컬에서 바로 실행)
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

    // 중력 적용
    const gravity = 0.3;
    gameState.projectile.x += gameState.projectile.vx;
    gameState.projectile.vy += gravity;
    gameState.projectile.y += gameState.projectile.vy;

    // 바닥 충돌 판정
    if (gameState.projectile.y > 470) {
        checkHit();
        resetTurn();
    }
}

function checkHit() {
    const targetNum = gameState.turn === 1 ? 2 : 1;
    const target = gameState.players[targetNum];
    
    // 거리 계산 (Math.hypot)
    const dist = Math.hypot(gameState.projectile.x - target.x, gameState.projectile.y - target.y);

    if (dist < 40) { // 피격 범위
        target.hp -= 30; // 데미지
        document.getElementById(`hp${targetNum}`).style.width = target.hp + '%';
        if (target.hp <= 0) alert(`Player ${gameState.turn} 승리!`);
    }
}

function resetTurn() {
    gameState.projectile.active = false;
    gameState.turn = gameState.turn === 1 ? 2 : 1;
    
    const turnDisplay = document.getElementById('turn-display');
    turnDisplay.innerText = `PLAYER ${gameState.turn} TURN`;
    turnDisplay.style.color = gameState.turn === 1 ? '#f1c40f' : '#e74c3c';
}

// ==========================================
// 5. 렌더링 (Renderer)
// ==========================================
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 바닥
    ctx.fillStyle = '#95a5a6';
    ctx.fillRect(0, 470, canvas.width, 30);

    // 플레이어
    for (let id in gameState.players) {
        const p = gameState.players[id];
        ctx.fillStyle = p.color;
        // 탱크 형태 (몸통 + 포신)
        ctx.fillRect(p.x - 15, p.y - 15, 30, 15);
        ctx.beginPath();
        ctx.arc(p.x, p.y - 15, 10, 0, Math.PI * 2);
        ctx.fill();
    }

    // 포탄
    if (gameState.projectile.active) {
        ctx.fillStyle = '#2c3e50';
        ctx.beginPath();
        ctx.arc(gameState.projectile.x, gameState.projectile.y, 6, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ==========================================
// 6. 메인 루프 (Main Loop)
// ==========================================
function gameLoop() {
    handleInput();
    updatePhysics();
    draw();
    requestAnimationFrame(gameLoop);
}

// 게임 시작
gameLoop();
