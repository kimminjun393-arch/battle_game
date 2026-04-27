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
        // [MODIFIED] y 좌표는 이제 지형에 맞춰 자동 계산되므로 y 제거, rotation(회전각) 추가
        1: { x: 100, rotation: 0, color: '#3498db', hp: 100 },
        2: { x: 1100, rotation: 0, color: '#e74c3c', hp: 100 }
    },
    projectile: { x: 0, y: 0, vx: 0, vy: 0, active: false },
    terrain: [] // [NEW] 지형 높이 값을 저장할 배열 (1200px)
};

const keys = {};
let lastMoveSync = 0;

// [NEW] 랜덤 지형 생성 함수 (sum of sine waves 방식)
function generateTerrain() {
    let t = [];
    let base = 380; // 기본 바닥 높이 (UI를 피하기 위해 약간 높게 시작)
    let freq1 = 0.005, amp1 = 50; // 큰 완만한 언덕
    let freq2 = 0.02, amp2 = 20; // 작고 세밀한 굴곡

    // 1P가 방 만들 때 임의의 파라미터 값 설정
    const p1 = Math.random() * amp1; const p2 = Math.random() * amp2; const startRef = Math.random() * canvas.width;

    for (let x = 0; x < canvas.width; x++) {
        // 굴곡진 지형 수학 공식
        const y = base + 
                  Math.sin((x + startRef) * freq1) * (amp1 + p1) + 
                  Math.sin((x + startRef + 500) * freq2) * (amp2 + p2);
        t.push(y);
    }
    return t;
}

joinBtn.addEventListener('click', async () => {
    currentRoomCode = roomCodeInput.value.trim();
    if (!currentRoomCode) return alert("방 코드를 입력하세요!");

    joinBtn.disabled = true;
    lobbyStatus.innerText = "전쟁터 탐색 중...";
    roomRef = ref(db, 'rooms/' + currentRoomCode);

    try {
        const snapshot = await get(roomRef);
        const data = snapshot.val();

        if (!data || data.playersCount === 0) {
            gameState.myPlayerNum = 1;
            // [NEW] 1P(방장)가 랜덤 지형 데이터를 만들어서 방 데이터에 추가
            const t = generateTerrain();
            await set(roomRef, { playersCount: 1, terrain: t });
            gameState.terrain = t; // 자기 자신도 지형 저장

            onDisconnect(roomRef).remove();
            lobbyStatus.innerText = "동료(상대방)를 기다리는 중...";
            
            onValue(roomRef, (snap) => {
                const val = snap.val();
                if (val && val.playersCount === 2 && !gameState.isGameStarted) startGame();
                if (val && val.action && val.action.player !== gameState.myPlayerNum) executeFire(val.action);
            });
        } else if (data.playersCount === 1) {
            gameState.myPlayerNum = 2;
            // [NEW] 2P는 1P가 이미 만들어둔 terrain 지형 데이터를 가져옴
            if (data.terrain) gameState.terrain = data.terrain;
            await update(roomRef, { playersCount: 2 });
            onValue(roomRef, (snap) => {
                const val = snap.val();
                if (val && val.action && val.action.player !== gameState.myPlayerNum) executeFire(val.action);
            });
            startGame();
        } else {
            alert("이미 전투 중인 방입니다!");
            joinBtn.disabled = false;
        }
    } catch (e) { console.error(e); }
});

function startGame() {
    gameState.isGameStarted = true;
    lobbyContainer.style.display = 'none';
    gameContainer.style.display = 'flex';
    
    // 상대방 위치 감지
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
    if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && gameState.turn === gameState.myPlayerNum) {
        update(ref(db, `rooms/${currentRoomCode}/players/${gameState.myPlayerNum}`), { 
            x: gameState.players[gameState.myPlayerNum].x 
        });
    }
    keys[e.code] = false;
});

// [NEW] X 좌표를 입력하면 지형 y 좌표와 지형의 기울기(rotation)를 반환하는 함수
function getTerrainInfo(x) {
    const ix = Math.max(0, Math.min(1199, Math.floor(x)));
    const y = gameState.terrain[ix];
    
    // x 좌표와 x+10 좌표 사이의 slope(기울기)를 구해서 몸통 회전각 계산
    const slopeX = Math.max(0, Math.min(1199, Math.floor(x + 10)));
    const slopeY = gameState.terrain[slopeX];
    const rotationRad = Math.atan2(slopeY - y, slopeX - x); // 기울기 라디안 각도

    return { y, rotationRad };
}

function handleInput() {
    if (gameState.turn !== gameState.myPlayerNum || gameState.projectile.active) return;
    
    const p = gameState.players[gameState.myPlayerNum];
    let moved = false;

    // 좌우 이동 (연료 소비)
    if (keys['ArrowLeft'] && gameState.fuel > 0) {
        p.x -= 2; gameState.fuel -= 0.8; moved = true;
    }
    if (keys['ArrowRight'] && gameState.fuel > 0) {
        p.x += 2; gameState.fuel -= 0.8; moved = true;
    }

    // 맵 밖 제한
    if (p.x < 30) p.x = 30;
    if (p.x > canvas.width - 30) p.x = canvas.width - 30;

    // Firebase 위치 전송 (타이머)
    if (moved) {
        const now = Date.now();
        if (now - lastMoveSync > 100) {
            update(ref(db, `rooms/${currentRoomCode}/players/${gameState.myPlayerNum}`), { x: p.x });
            lastMoveSync = now;
        }
    }

    // 각도 조절
    if (keys['ArrowUp'] && gameState.angle < 90) gameState.angle += 1;
    if (keys['ArrowDown'] && gameState.angle > 0) gameState.angle -= 1;
    
    // 파워 충전
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
    const pX = gameState.players[gameState.turn].x;
    const terrainInfo = getTerrainInfo(pX); // 발사할 때 지형 y 좌표 가져오기

    const actionData = {
        player: gameState.myPlayerNum,
        // 지형 y 좌표에서 탱크 몸통 위쪽 포구 부분에서 발사되도록 위치 조정
        startX: pX, startY: terrainInfo.y - 25,
        vx: Math.cos(radian) * (gameState.power * 0.22) * dir,
        vy: -Math.sin(radian) * (gameState.power * 0.22),
        timestamp: Date.now()
    };
    update(roomRef, { action: actionData });
    executeFire(actionData);
    
    // 파워 초기화
    gameState.isCharging = false;
    gameState.power = 0; gameState.powerDir = 1; gameState.powerSpeed = 1.5;
}

function executeFire(data) {
    gameState.projectile = { x: data.startX, y: data.startY, vx: data.vx, vy: data.vy, active: true };
}

function updatePhysics() {
    if (!gameState.projectile.active) return;
    gameState.projectile.x += gameState.projectile.vx;
    gameState.projectile.vy += 0.25; // 중력
    gameState.projectile.y += gameState.projectile.vy;

    // [MODIFIED] 지형과 충돌 감지 (바닥 y 좌표가 아닌 지형 높이 값과 비교)
    const px = Math.floor(gameState.projectile.x);
    if (gameState.projectile.y > canvas.height + 10 || (px >= 0 && px < 1200 && gameState.projectile.y >= gameState.terrain[px])) {
        // [MODIFIED] 지형과 충돌한 지점 근처 지형을 깎아서 크레이터(파임 효과) 동기화는 나중에... 일단 충돌 처리만
        
        checkHit();
        gameState.projectile.active = false;
        
        // 턴 넘김 및 연료 회복
        gameState.turn = gameState.turn === 1 ? 2 : 1;
        gameState.fuel = 100; 
        updateTurnUI();
    }
}

function checkHit() {
    const targetId = gameState.turn === 1 ? 2 : 1;
    const targetInfo = getTerrainInfo(gameState.players[targetId].x);
    // 탱크 지형 y 좌표에 맞춰 거리 판정
    const dist = Math.hypot(gameState.projectile.x - gameState.players[targetId].x, gameState.projectile.y - targetInfo.y);
    
    // 히트 판정 거리 약간 넓힘
    if (dist < 45) {
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
    el.style.color = isMyTurn ? "#f1c40f" : "#aaa";
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // [MODIFIED] 배경: 황량하고 연기 자욱한 삭막한 전쟁터
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, '#111'); bg.addColorStop(0.7, '#2c2c2a'); bg.addColorStop(1, '#332a2a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);

    // [MODIFIED] 랜덤 지형 그리기 (황토색/흙빛)
    ctx.fillStyle = '#7a6a4a'; // 황토색
    ctx.beginPath();
    ctx.moveTo(0, canvas.height); // 왼쪽 아래 시작
    for (let x = 0; x < canvas.width; x++) {
        ctx.lineTo(x, gameState.terrain[x]);
    }
    ctx.lineTo(canvas.width, canvas.height); // 오른쪽 아래 끝
    ctx.closePath();
    ctx.fill();
    // 지면 테두리 그리기 (디테일)
    ctx.strokeStyle = '#554a3a'; ctx.lineWidth = 3; ctx.stroke();

    // 탱크
    for (let id in gameState.players) {
        const p = gameState.players[id];
        // [MODIFIED] 내 X 좌표에 따른 지형 정보 가져오기 (Y좌표, 회전각)
        const tInfo = getTerrainInfo(p.x); 
        
        ctx.save();
        ctx.translate(p.x, tInfo.y - 15); // [MODIFIED] 지형 y좌표 터릿 위치로 원점 이동

        // (1) 포신 그리기 (내 턴일 때만 조절)
        ctx.save();
        const dir = (id == 1) ? 1 : -1;
        const currentAngle = (gameState.turn == id) ? gameState.angle : 45;
        ctx.rotate(-currentAngle * (Math.PI / 180) * dir);
        ctx.fillStyle = p.color; ctx.fillRect(0, -4, 35, 8);
        ctx.fillStyle = '#222'; ctx.fillRect(32, -5, 3, 10); // 포구 테두리
        ctx.restore();

        // [MODIFIED] (2) 지형 기울기에 맞춰 몸통/터릿 회전 연산 추가
        ctx.rotate(tInfo.rotationRad); 

        // 터릿/몸통 그리기
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI*2); ctx.fill(); // 터릿
        ctx.strokeRect(-25, 5, 50, 20); ctx.fillRect(-25, 5, 50, 20); // 몸통
        
        // 무한궤도(트랙)
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(-28, 22, 56, 7); // 트랙 배경
        ctx.fillStyle = '#111'; // 트랙 무늬 색
        // 바퀴 회전 느낌 (x좌표값 연산)
        const wheelOffset = (p.x % 15) / 15 * 10;
        for(let i=0; i<4; i++) { ctx.fillRect(-22 + (i * 12) + (wheelOffset > 5 ? 2 : 0), 22, 6, 6); }
        ctx.restore();
    }

    // 포탄
    if (gameState.projectile.active) {
        ctx.fillStyle = '#f1c40f';
        ctx.beginPath(); ctx.arc(gameState.projectile.x, gameState.projectile.y, 5, 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur = 10; ctx.shadowColor = "#f1c40f";
    } else { ctx.shadowBlur = 0; }

    // 파워 게이지 바 (중앙 상단)
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
    if (gameState.isGameStarted && gameState.terrain.length > 0) { // [NEW] 지형 데이터가 있을 때만 게임 돌림
        handleInput(); updatePhysics(); draw(); 
    }
    requestAnimationFrame(gameLoop);
}
