// tools/test-bot.js: 혼자서 멀티플레이를 테스트하기 위한 봇. 가짜 유저로 로그인해서 원을 그리며 걷고 가끔 채팅함
// 사용법: node tools/test-bot.js [서버번호] [봇 수] [주소]
//   놀이기구 테스트: RIDE=seesaw node tools/test-bot.js 1 2   (slide / swing / seesaw / merry)
//   시연용 돌아다니기: RIDE=tour node tools/test-bot.js 1 6   (걸어 다니다 놀이기구를 골라 타고 내리기 반복)
//   봇 여러 무리를 동시에 띄울 때는 BOT_START로 이름 번호를 겹치지 않게: BOT_START=3 -> bot_3부터
//   예) node tools/test-bot.js 1 2            -> 로컬 서버 1에 봇 2명
//   예) node tools/test-bot.js 1 1 http://EC2주소:3000
const { io } = require('socket.io-client');

const ROOM_ID = Number(process.argv[2] || 1);
const BOT_COUNT = Number(process.argv[3] || 1);
const BASE = process.argv[4] || 'http://localhost:3000';
const RIDE = process.env.RIDE || '';
const BOT_START = Number(process.env.BOT_START || 1); // 첫 봇 번호
// 놀이기구 구역 중심 (game/rides.js와 같음)
const ZONES = { slide: { x: 9, z: -9.6 }, swing: { x: 10.5, z: 6.5 }, seesaw: { x: -10, z: 6 }, merry: { x: 0, z: -11 } };
const LINES = ['안녕하세요!', '여기 미끄럼틀 있어요', '같이 놀아요~', '그네 타러 갈래요', '삑삑!'];

// 봇 1명 실행: 회원가입(이미 있으면 로그인) -> 세션 쿠키로 socket.io 접속 -> 걷기/채팅
async function runBot(n) {
  const username = `bot_${n}`;
  const password = 'botpass1234';
  const form = new URLSearchParams({ username, password, nickname: `봇${n}` });

  // 가입 시도 후 로그인 (redirect를 따라가지 않아야 Set-Cookie를 받을 수 있음)
  await fetch(BASE + '/register', { method: 'POST', body: form, redirect: 'manual' });
  const res = await fetch(BASE + '/login', { method: 'POST', body: form, redirect: 'manual' });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error(`${username} 로그인 실패`);

  // 캐릭터 고르기 (봇마다 다른 장난감/색)
  const colors = ['#ff9f1c', '#b388ff', '#3a86ff', '#ff5a5f', '#ffd23f'];
  await fetch(BASE + '/enter', {
    method: 'POST', redirect: 'manual', headers: { cookie },
    body: new URLSearchParams({ roomId: ROOM_ID, toyId: ((n - 1) % 5) + 1, color: colors[(n - 1) % 5] }),
  });

  const socket = io(BASE, { extraHeaders: { cookie } });
  socket.on('connect', () => socket.emit('join', { roomId: ROOM_ID }));
  socket.on('fatal', (msg) => { console.log(`[${username}] 끊김: ${msg}`); process.exit(1); });
  if (RIDE !== 'tour') socket.on('chat', (c) => console.log(`[${username}이 본 채팅] ${c.nickname}: ${c.content}`));

  socket.on('ride-denied', (msg) => console.log(`[${username}] 탑승 거절: ${msg}`));
  socket.on('init', (data) => {
    console.log(`[${username}] ${data.roomName} 입장, 현재 ${data.players.length}명`);
    // 놀이기구 모드: 구역으로 이동해서 타고, 좌석 상태를 출력 (미끄럼틀은 다 내려오면 다시 탐)
    // 시연용 모드: 다시 연결돼도(서버 재시작 등) 타이머가 두 번 생기지 않게 한 번만 시작
    if (RIDE === 'tour') {
      if (!socket.tour) socket.tour = startTour(socket, n);
      else socket.tour.reset();
      return;
    }
    if (RIDE) {
      const z = ZONES[RIDE];
      socket.emit('move', { x: z.x + (n - 1) * 0.3, y: 0, z: z.z, r: 0 });
      const ride = () => socket.emit('ride-join', { ride: RIDE });
      setTimeout(ride, 300 + n * 150);
      socket.on('rides', (d) => {
        const seats = d.state[RIDE].seats.map((s) => (s ? (s.id === socket.id ? '나' : '다른 봇') : '빈자리'));
        console.log(`[${username}] ${RIDE} 좌석: ${seats.join(', ')}`);
        if (RIDE === 'slide' && !d.state.slide.seats.some((s) => s && s.id === socket.id)) setTimeout(ride, 1500);
      });
      setInterval(() => socket.emit('chat', LINES[Math.floor(Math.random() * LINES.length)]), 7000 + n * 1000);
      return;
    }
    // 놀이터 가운데를 중심으로 원을 그리며 걷기 (1초에 15번 위치 전송)
    let t = n * 2;
    let jumpT = -1; // 점프 중이면 0~1, 아니면 -1
    setInterval(() => {
      t += 0.02;
      const x = Math.cos(t) * (5 + n), z = Math.sin(t) * (5 + n);
      const r = Math.atan2(-Math.sin(t), Math.cos(t)); // 걷는 방향을 바라봄
      // 가끔 점프 (포물선으로 올라갔다 내려옴)
      if (jumpT < 0 && Math.random() < 0.02) jumpT = 0;
      let y = 0;
      if (jumpT >= 0) {
        y = 4 * 1.1 * jumpT * (1 - jumpT);
        jumpT += 0.1;
        if (jumpT > 1) jumpT = -1;
      }
      socket.emit('move', { x, y, z, r });
    }, 66);
    // 가끔 이모티콘
    setInterval(() => socket.emit('emote', Math.floor(Math.random() * 6)), 9000 + n * 700);
    // 6~10초마다 채팅
    setInterval(() => socket.emit('chat', LINES[Math.floor(Math.random() * LINES.length)]), 6000 + n * 1000);
  });
}

// 시연용 돌아다니기 모드 (RIDE=tour): 놀이터를 걸어 다니다가 놀이기구를 골라 타고, 내려서 또 다른 곳으로 감
// 순서: 아무 데나 걸어가기 -> 놀이기구 구역 가장자리로 걸어가기 -> 타기 -> 몇 초 뒤 내리기 -> 반복
function startTour(socket, n) {
  const WALK_SPEED = 4;                 // 걷는 속도 (m/초, 실제 유저 5보다 조금 느리게)
  const pos = { x: Math.cos(n) * 4, z: Math.sin(n) * 4, r: 0 };
  let targets = [];                     // 걸어갈 지점 목록
  let onArrive = null;                  // 마지막 지점에 도착하면 할 일
  let riding = false;                   // 지금 놀이기구에 앉아 있는지 (서버 'rides' 기준)
  let leaveTimer = null;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // 놀이터 가운데 근처 아무 지점
  const randomSpot = () => { const a = rand(0, Math.PI * 2), d = rand(2, 7); return { x: Math.cos(a) * d, z: Math.sin(a) * d }; };
  // 놀이기구 구역 가장자리 중 놀이터 가운데 쪽 지점 (기구 한가운데를 뚫고 걷지 않게)
  const zoneEdge = (name) => {
    const z = ZONES[name], d = Math.hypot(z.x, z.z) || 1, back = 2 + rand(-0.4, 0.4);
    return { x: z.x - (z.x / d) * back + rand(-0.5, 0.5), z: z.z - (z.z / d) * back + rand(-0.5, 0.5) };
  };

  // 다음 행동: 한두 군데 걸어 다닌 뒤 놀이기구 하나를 골라서 타러 감
  function nextPlan() {
    const ride = pick(Object.keys(ZONES));
    targets = [randomSpot()];
    if (Math.random() < 0.4) targets.push(randomSpot());
    targets.push(zoneEdge(ride));
    onArrive = () => setTimeout(() => socket.emit('ride-join', { ride }), rand(300, 1200));
  }

  // 서버가 알려 준 좌석 상태로 탔는지/내렸는지 판단
  socket.on('rides', (d) => {
    let seatedOn = null;
    for (const [name, r] of Object.entries(d.state)) {
      if (r.seats.some((s) => s && s.id === socket.id)) seatedOn = name;
    }
    if (seatedOn && !riding) {
      riding = true;
      // 미끄럼틀은 서버가 자동으로 내려 주고, 나머지는 8~16초 타다가 내림
      if (seatedOn !== 'slide') leaveTimer = setTimeout(() => socket.emit('ride-leave'), rand(8000, 16000));
      if (Math.random() < 0.5) setTimeout(() => socket.emit('emote', pick([0, 1, 2, 4])), rand(1000, 4000));
    } else if (!seatedOn && riding) {
      riding = false;
      clearTimeout(leaveTimer);
      setTimeout(nextPlan, rand(800, 2000)); // 잠깐 쉬었다가 다음 장소로
    }
  });
  // 자리가 꽉 찼거나 하면 다른 데로 감
  socket.on('ride-denied', () => setTimeout(nextPlan, rand(500, 1500)));

  // 1초에 15번: 목표 지점으로 걸어가며 위치 전송 (타는 동안에는 보내지 않음)
  setInterval(() => {
    if (riding || targets.length === 0) return;
    const t = targets[0], dx = t.x - pos.x, dz = t.z - pos.z, dist = Math.hypot(dx, dz);
    const step = WALK_SPEED * 0.066;
    if (dist <= step) {
      pos.x = t.x; pos.z = t.z;
      targets.shift();
      if (targets.length === 0 && onArrive) { const f = onArrive; onArrive = null; f(); }
    } else {
      pos.x += (dx / dist) * step; pos.z += (dz / dist) * step;
      pos.r = Math.atan2(dx, dz); // 걷는 방향을 바라봄
    }
    socket.emit('move', { x: pos.x, y: 0, z: pos.z, r: pos.r });
  }, 66);

  // 가끔 채팅 (DB에 쌓이므로 40~80초에 한 번만)
  const chatLoop = () => setTimeout(() => { socket.emit('chat', pick(LINES)); chatLoop(); }, rand(40000, 80000));
  chatLoop();
  setTimeout(nextPlan, rand(500, 3000) + n * 400);

  // 다시 접속했을 때: 서버 좌석 정보가 사라졌으니 처음부터 다시 계획
  return { reset() { riding = false; clearTimeout(leaveTimer); nextPlan(); } };
}

for (let i = BOT_START; i < BOT_START + BOT_COUNT; i++) {
  runBot(i).catch((e) => console.error(e.message));
}
