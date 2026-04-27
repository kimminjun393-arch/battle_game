const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// [NEW] 최대 체력 설정 상수 추가
const MAX_HP = 300;
// [NEW] HTML을 수정하지 않고 JS에서 로비에 탱크 선택 UI 자동 추가
if (!document.getElementById('tank-select')) {
    const selectHTML = `
        <select id="tank-select" style="margin-bottom: 15px; padding: 10px; font-size: 14px; border-radius: 5px; width: 100%; max-width: 250px; text-align: center; background: #333; color: white; border: 1px solid #555;">
            <option value="balanced">⚖️ 표준형 (HP 300 / 연료 100)</option>
            <option value="heavy">🛡️ 탱커형 (HP 450 / 연료 50 / 정밀조준)</option>
            <option value="light">⚡ 기동형 (HP 200 / 연료 200 / 쾌속기동)</option>
        </select>
    `;
    roomCodeInput.insertAdjacentHTML('beforebegin', selectHTML);
}

// [NEW] 탱크 종류별 스탯 정의
const TANK_TYPES = {
    'balanced': { name: '표준형', maxHp: 300, maxFuel: 100, speed: 2.5, powerSpeedInc: 0.05 },
    'heavy': { name: '탱커형', maxHp: 450, maxFuel: 50, speed: 1.2, powerSpeedInc: 0.02 }, // 파워가 천천히 차올라 미세조작 유리
    'light': { name: '기동형', maxHp: 200, maxFuel: 200, speed: 4.0, powerSpeedInc: 0.1 }   // 빠르지만 파워 게이지 훅훅 넘어감
};

const WEAPONS = {
'Q': { name: 'NORMAL', dmg: 35, crater: 30, maxPower: 100, gravity: 0.22, color: '#f1c40f' },
@@ -44,8 +60,8 @@ let gameState = {
selectedWeapon: 'Q', 
isCharging: false, isGameStarted: false,
players: {
        1: { x: 150, hp: MAX_HP, color: '#3498db', angle: 45 },
        2: { x: 1050, hp: MAX_HP, color: '#e74c3c', angle: 45 }
        1: { x: 150, hp: 300, color: '#3498db', angle: 45, tankType: 'balanced' },
        2: { x: 1050, hp: 300, color: '#e74c3c', angle: 45, tankType: 'balanced' }
},
projectile: { x: 0, y: 0, vx: 0, vy: 0, active: false, owner: 0, weapon: 'Q' },
terrain: [],
@@ -71,6 +87,10 @@ joinBtn.addEventListener('click', async () => {
currentRoomCode = roomCodeInput.value.trim();
if (!currentRoomCode) return alert("방 코드를 입력하세요!");

    // 선택한 탱크 정보 가져오기
    const myTankChoice = document.getElementById('tank-select').value;
    const myTankStats = TANK_TYPES[myTankChoice];

joinBtn.disabled = true;
lobbyStatus.innerText = "전투 배치 중...";
roomRef = ref(db, 'rooms/' + currentRoomCode);
@@ -81,24 +101,34 @@ joinBtn.addEventListener('click', async () => {

if (!data || data.playersCount === 0) {
gameState.myPlayerNum = 1;
            gameState.fuel = myTankStats.maxFuel; // 초기 연료 세팅
const t = generateTerrain();
            // [MODIFIED] 초기 체력을 MAX_HP로 설정
await set(roomRef, { 
                playersCount: 1, terrain: t, turn: 1, action: null, hp1: MAX_HP, hp2: MAX_HP 
                playersCount: 1, terrain: t, turn: 1, action: null, 
                hp1: myTankStats.maxHp, tank1: myTankChoice,
                hp2: 300, tank2: 'balanced' // 임시 값
});
gameState.terrain = t;
onDisconnect(roomRef).remove();
lobbyStatus.innerText = "상대방 대기 중...";
} else {
gameState.myPlayerNum = 2;
            gameState.fuel = myTankStats.maxFuel;
gameState.terrain = data.terrain || generateTerrain();
            await update(roomRef, { playersCount: 2 });
            await update(roomRef, { 
                playersCount: 2,
                hp2: myTankStats.maxHp, tank2: myTankChoice
            });
}

onValue(roomRef, (snap) => {
const val = snap.val();
if (!val) return;

            // 양쪽 탱크 정보 동기화
            if (val.tank1) gameState.players[1].tankType = val.tank1;
            if (val.tank2) gameState.players[2].tankType = val.tank2;

if (val.playersCount === 2 && !gameState.isGameStarted) startGame();

if (val.turn !== undefined && val.turn !== gameState.turn) {
@@ -112,31 +142,27 @@ joinBtn.addEventListener('click', async () => {
}
}

            // [MODIFIED] HP 비율 계산 및 HTML 텍스트 표시
            // 동적 최대 체력에 맞춰 UI 바 업데이트
if (val.hp1 !== undefined) {
gameState.players[1].hp = val.hp1;
const hpEl = document.getElementById('hp1');
                const maxHp1 = TANK_TYPES[gameState.players[1].tankType].maxHp;
if (hpEl) {
                    hpEl.style.width = (val.hp1 / MAX_HP * 100) + '%';
                    hpEl.innerText = `${Math.floor(val.hp1)} / ${MAX_HP}`;
                    hpEl.style.textAlign = 'center';
                    hpEl.style.color = 'white';
                    hpEl.style.fontSize = '14px';
                    hpEl.style.fontWeight = 'bold';
                    hpEl.style.lineHeight = '20px'; // 높이에 맞춰 조절
                    hpEl.style.width = Math.max(0, (val.hp1 / maxHp1 * 100)) + '%';
                    hpEl.innerText = `${Math.floor(val.hp1)} / ${maxHp1}`;
                    hpEl.style.textAlign = 'center'; hpEl.style.color = 'white';
                    hpEl.style.fontSize = '14px'; hpEl.style.fontWeight = 'bold'; hpEl.style.lineHeight = '20px';
}
}
if (val.hp2 !== undefined) {
gameState.players[2].hp = val.hp2;
const hpEl = document.getElementById('hp2');
                const maxHp2 = TANK_TYPES[gameState.players[2].tankType].maxHp;
if (hpEl) {
                    hpEl.style.width = (val.hp2 / MAX_HP * 100) + '%';
                    hpEl.innerText = `${Math.floor(val.hp2)} / ${MAX_HP}`;
                    hpEl.style.textAlign = 'center';
                    hpEl.style.color = 'white';
                    hpEl.style.fontSize = '14px';
                    hpEl.style.fontWeight = 'bold';
                    hpEl.style.lineHeight = '20px';
                    hpEl.style.width = Math.max(0, (val.hp2 / maxHp2 * 100)) + '%';
                    hpEl.innerText = `${Math.floor(val.hp2)} / ${maxHp2}`;
                    hpEl.style.textAlign = 'center'; hpEl.style.color = 'white';
                    hpEl.style.fontSize = '14px'; hpEl.style.fontWeight = 'bold'; hpEl.style.lineHeight = '20px';
}
}

@@ -203,11 +229,13 @@ function handleInput() {
if (gameState.turn !== gameState.myPlayerNum || gameState.projectile.active) return;

const p = gameState.players[gameState.myPlayerNum];
    const myTankStats = TANK_TYPES[p.tankType];
const currentWeaponInfo = WEAPONS[gameState.selectedWeapon];
let stateChanged = false;

    if (keys['ArrowLeft'] && gameState.fuel > 0) { p.x -= 2.5; gameState.fuel -= 1; stateChanged = true; }
    if (keys['ArrowRight'] && gameState.fuel > 0) { p.x += 2.5; gameState.fuel -= 1; stateChanged = true; }
    // [MODIFIED] 탱크 이동 속도를 클래스별 스탯으로 적용
    if (keys['ArrowLeft'] && gameState.fuel > 0) { p.x -= myTankStats.speed; gameState.fuel -= 1; stateChanged = true; }
    if (keys['ArrowRight'] && gameState.fuel > 0) { p.x += myTankStats.speed; gameState.fuel -= 1; stateChanged = true; }
if (p.x < 30) p.x = 30; if (p.x > canvas.width - 30) p.x = canvas.width - 30;

if (keys['ArrowUp']) { gameState.angle += 1; stateChanged = true; }
@@ -226,7 +254,8 @@ function handleInput() {
if (keys['Space']) {
gameState.isCharging = true;
gameState.power += gameState.powerSpeed * gameState.powerDir;
        gameState.powerSpeed += 0.05; 
        // [MODIFIED] 파워 차오르는 속도를 탱크별로 차별화 (조작 난이도)
        gameState.powerSpeed += myTankStats.powerSpeedInc; 

if (gameState.power >= currentWeaponInfo.maxPower) { 
gameState.power = currentWeaponInfo.maxPower; 
@@ -238,7 +267,7 @@ function handleInput() {
}

document.getElementById('status').innerText = 
        `ANGLE: ${gameState.angle}° | POWER: ${Math.floor(gameState.power)} | FUEL: ${Math.floor(gameState.fuel)}`;
        `CLASS: ${myTankStats.name} | ANGLE: ${gameState.angle}° | POWER: ${Math.floor(gameState.power)} | FUEL: ${Math.floor(gameState.fuel)}`;
}

function sendFireAction() {
@@ -300,7 +329,8 @@ function updatePhysics() {
}).then(() => { gameState.isProcessingHit = false; });
}

        gameState.fuel = 100;
        // [MODIFIED] 내 턴이 다시 돌아오거나 끝날 때 내 탱크 종류에 맞는 Max 연료량으로 충전
        gameState.fuel = TANK_TYPES[gameState.players[gameState.myPlayerNum].tankType].maxFuel;
updateTurnUI();
}
}
@@ -382,13 +412,19 @@ function draw() {
for (let id in gameState.players) {
const p = gameState.players[id];
const tInfo = getTerrainInfo(p.x); 
        const pTankStats = TANK_TYPES[p.tankType || 'balanced'];

ctx.save();
ctx.translate(p.x, tInfo.y - 12); 

        // [NEW] 탱크 머리 위 캔버스에도 체력을 정확한 숫자로 표시
        // 탱크 머리 위 표시 (이름과 체력)
        ctx.fillStyle = '#aaa';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`[${pTankStats.name}]`, 0, -38);

ctx.fillStyle = '#fff';
ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
ctx.fillText(`HP: ${Math.floor(p.hp)}`, 0, -25);

ctx.save();
