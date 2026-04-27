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
        1: { x: 150, hp: 100, color: '#3498db', angle: 45 },
        2: { x: 1050, hp: 100, color: '#e74c3c', angle: 45 }
    },
    projectile: { x: 0, y: 0, vx: 0, vy: 0, active: false, owner: 0 },
    terrain: [],
    lastActionId: 0,
    isProcessingHit: false 
};

const keys = {};
let lastMoveSync = 0;

// [NEW] 크레이터(파임) 반경 정의
const CRATER_RADIUS = 30;

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
            // 2P는 방의 초기 지형을 가져옴
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

            // [MODIFIED] 지형 실시간 동기화 - 핵심!!
            // 상대방이 깎은 지형 데이터를 내 화면에 실시간으로 덮어씌움
            if (val.terrain && val.terrain.length > 0) {
                // 단순 대입이 아니라 값 복사를 해야 데이터 꼬임을 막음
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
    if (gameState.turn !== gameState.myPlayerNum || gameState.projectile.active) return;
    
    const p = gameState.players[gameState.myPlayerNum];
    let stateChanged = false;

    if (keys['ArrowLeft'] && gameState.fuel > 0) { p.x -= 2.5; gameState.fuel -= 1; stateChanged = true; }
    if (keys['ArrowRight'] && gameState.fuel > 0) { p.x += 2.5; gameState.fuel -= 1; stateChanged = true; }
    
    // [MODIFIED] 지형이 깎여서 낭떠러지가 되면 탱크가 아래로 추락하게 물리엔진 강화!!
    const currentTerrainY = getTerrainInfo(p.x).y;
    // 탱크 Y좌표가 지형 Y좌표보다 위에 있으면(값이 작으면) 아래로 떨어짐
    // (이 로직은 draw에서 translate 할 때 tInfo.y를 사용하므로 시각적으로만 보완)

    if (p.x < 30) p.x = 30; if (p.x > canvas.width - 30) p.x = canvas.width - 30;

    if (keys['ArrowUp'] && gameState.angle < 90) { gameState.angle += 1; stateChanged = true; }
    if (keys['ArrowDown'] && gameState.angle > 0) { gameState.angle -= 1; stateChanged = true; }
    
    if (stateChanged) {
        const now = Date.now();
        if (now - lastMoveSync > 50) {
            update(ref(db, `rooms/${currentRoomCode}/players/${gameState.myPlayerNum}`), { 
                x: p.x,
                angle: gameState.angle
            });
            lastMoveSync = now;
        }
    }

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
    gameState.isProcessingHit = false; 
    update(roomRef, { action: actionData });
    executeFire(actionData);
}

function executeFire(data) {
    gameState.projectile = { 
        x: data.startX, y: data.startY, vx: data.vx, vy: data.vy, active: true, 
        owner: data.player 
    };
}

function updatePhysics() {
    if (!gameState.projectile.active) return;

    gameState.projectile.x += gameState.projectile.vx;
    gameState.projectile.vy += 0.22;
    gameState.projectile.y += gameState.projectile.vy;

    const px = Math.floor(gameState.projectile.x);
    const hitGround = px >= 0 && px < 1200 && gameState.projectile.y >= gameState.terrain[px];
    // 포탄이 화면 위로 나가는 건 OOB 처리 안 함 (다시 떨어질 수 있으니까)
    const outOfBounds = gameState.projectile.y > canvas.height + 100 || gameState.projectile.x < -100 || gameState.projectile.x > canvas.width + 100;

    if (hitGround || outOfBounds) {
        gameState.projectile.active = false;
        
        // 포탄 주인만 충돌 처리 권한을 가짐
        if (gameState.projectile.owner === gameState.myPlayerNum && !gameState.isProcessingHit) {
            gameState.isProcessingHit = true; 
            
            if (hitGround) {
                // 1. 데미지 계산
                checkHitAndSync(); 
                
                // [NEW] 2. 지형 파괴 계산 및 로컬 반영!!
                const craterX = gameState.projectile.x;
                applyCrater(craterX);
            }
            
            const nextTurn = gameState.myPlayerNum === 1 ? 2 : 1;
            // [MODIFIED] 3. 턴 전환, 미사일 데이터 삭제, 그리고 **변경된 지형 배열 전체**를 DB에 동기화!!
            update(roomRef, { 
                turn: nextTurn, 
                action: null,
                terrain: gameState.terrain // 지형 배열 통째로 전송 (약 1200개 숫자)
            }).then(() => {
                gameState.isProcessingHit = false;
            });
        }
        
        gameState.fuel = 100;
        updateTurnUI();
    }
}

// [NEW] 지형을 원형으로 깎아내는 함수 - 핵심!!
function applyCrater(craterX) {
    const startX = Math.max(0, Math.floor(craterX - CRATER_RADIUS));
    const endX = Math.min(canvas.width - 1, Math.floor(craterX + CRATER_RADIUS));

    // 원의 방정식: (x-cx)^2 + (y-cy)^2 = r^2 -> y = cy + sqrt(r^2 - (x-cx)^2)
    // 우리는 cy(원의 중심y)를 지형 표면으로 잡고, 지형 배열 값을 cy보다 더 크게(아래로) 만듦
    for (let x = startX; x <= endX; x++) {
        const dx = x - craterX;
        // 반원 계산 (r^2 - dx^2)가 음수면 반지름 밖이므로 패스
        const distSq = CRATER_RADIUS * CRATER_RADIUS - dx * dx;
        if (distSq > 0) {
            const dy = Math.sqrt(distSq); // 중심에서 떨어진y거리
            const surfaceY = gameState.terrain[x];
            // 지형 Y값을 기존 Y값과 원형y값 중 더 큰(아래에 있는) 값으로 선택!!
            const newY = Math.max(surfaceY, surfaceY + dy * 0.7); // 0.7 곱해서 파임 깊이 조절

            // 지형 배열 업데이트
            if (newY < canvas.height - 10) { // 화면 맨 바닥까지 파이는 것 방지
                gameState.terrain[x] = newY;
            }
        }
    }
}

function checkHitAndSync() {
    const targetId = gameState.myPlayerNum === 1 ? 2 : 1;
    const tX = gameState.players[targetId].x;
    const tY = getTerrainInfo(tX).y;
    // 탱크 지형 y 좌표에 맞춰 거리 판정 (지형 파괴된 거 반영됨)
    const dist = Math.hypot(gameState.projectile.x - tX, gameState.projectile.y - tY);
    
    // 지형이 깎여서 포탄 Y가 탱크보다 훨씬 아래 있으면 안 맞은 걸로 처리해야 함
    // (이미 outOfBounds 로직에 의해 땅 밑 충돌은 해결됨)

    if (dist < 50) {
        const newHP = Math.max(0, gameState.players[targetId].hp - 35);
        const hpUpdate = {};
        hpUpdate[`hp${targetId}`] = newHP;
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

    // [MODIFIED] 지형 그리기 (파여진 거 반영됨)
    ctx.fillStyle = '#7a6a4a'; // 황토색
    ctx.beginPath();
    ctx.moveTo(0, canvas.height); // 왼쪽 아래 시작
    for (let x = 0; x < canvas.width; x++) {
        ctx.lineTo(x, gameState.terrain[x]);
    }
    ctx.lineTo(canvas.width, canvas.height); // 오른쪽 아래 끝
    ctx.closePath();
    ctx.fill();
    // 테두리 디테일
    ctx.strokeStyle = '#554a3a'; ctx.lineWidth = 2; ctx.stroke();

    for (let id in gameState.players) {
        const p = gameState.players[id];
        // 내 X 좌표에 따른 지형 정보 (깎여서 바뀐 Y, 회전각) 가져오기
        const tInfo = getTerrainInfo(p.x); 
        
        ctx.save();
        // [MODIFIED] 탱크를 항상 변경된 지형 Y 위에 배치 (translate)
        ctx.translate(p.x, tInfo.y - 12); 
        
        ctx.save();
        const currentAngle = (gameState.myPlayerNum == id) ? gameState.angle : (p.angle || 45);
        
        if (id == 1) { ctx.rotate(-currentAngle * (Math.PI / 180)); } 
        else { ctx.rotate((-180 + currentAngle) * (Math.PI / 180)); }
        
        ctx.fillStyle = p.color; ctx.fillRect(0, -3, 30, 6);
        ctx.restore();

        // 몸통 회전 (지형 기울기에 맞춤)
        ctx.rotate(tInfo.rotationRad);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI*2); ctx.fill();
        ctx.strokeRect(-22, 4, 44, 16); ctx.fillRect(-22, 4, 44, 16);
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
