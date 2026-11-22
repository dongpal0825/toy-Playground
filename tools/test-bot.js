// tools/test-bot.js: 혼자서 멀티플레이를 테스트하기 위한 봇. 가짜 유저로 로그인해서 원을 그리며 걷고 가끔 채팅함
// 사용법: node tools/test-bot.js [서버번호] [봇 수] [주소]
//   놀이기구 테스트: RIDE=seesaw node tools/test-bot.js 1 2   (slide / swing / seesaw / merry)
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
  socket.on('chat', (c) => console.log(`[${username}이 본 채팅] ${c.nickname}: ${c.content}`));

  socket.on('ride-denied', (msg) => console.log(`[${username}] 탑승 거절: ${msg}`));
  socket.on('init', (data) => {
    console.log(`[${username}] ${data.roomName} 입장, 현재 ${data.players.length}명`);
    // 놀이기구 모드: 구역으로 이동해서 타고, 좌석 상태를 출력 (미끄럼틀은 다 내려오면 다시 탐)
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

for (let i = BOT_START; i < BOT_START + BOT_COUNT; i++) {
  runBot(i).catch((e) => console.error(e.message));
}
