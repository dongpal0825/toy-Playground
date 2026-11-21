// play.js: 놀이터 화면의 시작 파일. 서버 연결, 채팅 패널/입력, 3D 게임과의 연결을 담당
// (3D 부분은 game3d.js로 분리해서, 3D가 실패해도 채팅은 계속 동작하게 함)

const pageData = JSON.parse(document.getElementById('page-data').textContent);
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const playerCount = document.getElementById('player-count');
const notice = document.getElementById('notice');

let game = null;          // 3D 게임 객체 (불러오기에 실패하면 null 그대로)
let selfId = null;        // 내 소켓 id
const players = new Map(); // 같은 방에 있는 사람들 (소켓 id -> 정보)

// ===== 서버 연결 =====
const socket = io({ reconnection: false });

socket.on('connect', () => {
  socket.emit('join', { roomId: pageData.roomId });
});

// 입장 완료: 지금 방에 있는 사람들과 최근 채팅을 받음
socket.on('init', (data) => {
  selfId = data.selfId;
  chatLog.textContent = '';
  data.chats.forEach((c) => addChatLine(c.nickname, c.content, c.at));
  addSystemLine(`${data.roomName}에 입장했어요!`);
  data.players.forEach((p) => players.set(p.id, p));
  updateCount();
  if (game) game.setPlayers(data.players, selfId);
});

// 다른 사람이 들어옴 / 나감
socket.on('player-joined', (p) => {
  players.set(p.id, p);
  updateCount();
  if (game) game.addPlayer(p);
});
socket.on('player-left', (id) => {
  players.delete(id);
  updateCount();
  if (game) game.removePlayer(id);
});

// 다른 사람들의 위치 (1초에 약 15번 옴)
socket.on('moves', (list) => {
  for (const m of list) {
    const p = players.get(m.id);
    if (p) Object.assign(p, m);
  }
  if (game) game.applyMoves(list, selfId);
});

// 채팅: 왼쪽 위 패널에 추가하고, 그 사람 캐릭터 머리 위에 말풍선
socket.on('chat', (c) => {
  addChatLine(c.nickname, c.content, c.at);
  if (game) game.showBubble(c.id, c.content);
});

// 입장/퇴장 같은 안내 메시지
socket.on('system', (text) => addSystemLine(text));

// 더 이상 놀 수 없는 상황 (중복 접속, 서버 꽉 참 등)
socket.on('fatal', (msg) => showNotice(msg, true));
socket.on('disconnect', () => showNotice('서버와 연결이 끊겼어요.', true));
socket.on('connect_error', () => showNotice('서버에 연결할 수 없어요.', true));

// ===== 채팅 패널 =====
// 채팅 한 줄 추가 (textContent만 사용해서 HTML이 실행되지 않게 함: XSS 방지)
function addChatLine(nickname, content, at) {
  const li = document.createElement('li');
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = formatTime(at);
  const name = document.createElement('b');
  name.textContent = nickname;
  const text = document.createElement('span');
  text.textContent = ' ' + content;
  li.append(time, name, text);
  appendLine(li);
}

// 안내 메시지 한 줄 추가
function addSystemLine(text) {
  const li = document.createElement('li');
  li.className = 'system';
  li.textContent = text;
  appendLine(li);
}

// 줄을 추가하고, 맨 아래를 보고 있었다면 자동으로 아래로 스크롤 (너무 많으면 오래된 줄 삭제)
function appendLine(li) {
  const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 30;
  chatLog.appendChild(li);
  while (chatLog.children.length > 200) chatLog.firstChild.remove();
  if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
}

function formatTime(at) {
  const d = at ? new Date(at) : new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function updateCount() {
  playerCount.textContent = `${players.size}명 접속 중`;
}

function showNotice(msg, withLink) {
  notice.textContent = msg;
  if (withLink) {
    const a = document.createElement('a');
    a.href = '/servers';
    a.className = 'btn small';
    a.textContent = '서버 선택으로 돌아가기';
    notice.append(document.createElement('br'), a);
  }
  notice.classList.remove('hidden');
}

// ===== 채팅 입력 =====
// 보내기 (Enter 또는 버튼)
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text) socket.emit('chat', text);
  chatInput.value = '';
  chatInput.blur(); // 보내고 나면 다시 캐릭터를 움직일 수 있게 포커스 해제
});

// 게임 화면에서 Enter를 누르면 입력창으로 이동, 입력 중 Esc를 누르면 빠져나옴
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement !== chatInput) {
    e.preventDefault();
    chatInput.focus();
  } else if (e.key === 'Escape' && document.activeElement === chatInput) {
    chatInput.blur();
  }
});

// 채팅 입력 중인지 (입력 중에는 WASD로 캐릭터가 움직이지 않게 3D 쪽에서 확인)
function isTyping() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

// ===== 3D 게임 불러오기 =====
// 실패해도(WebGL 미지원 등) 채팅은 그대로 쓸 수 있게 try/catch로 감쌈
(async () => {
  try {
    const { createGame } = await import('./game3d.js');
    game = await createGame({
      container: document.getElementById('game'),
      me: pageData.me,
      toys: pageData.toys,
      isTyping,
      onMove: (x, z, r) => socket.emit('move', { x, z, r }),
    });
    // 3D가 늦게 준비된 경우, 이미 받은 사람 목록을 반영
    if (selfId) game.setPlayers([...players.values()], selfId);
  } catch (err) {
    console.error('3D 불러오기 실패:', err);
    document.body.classList.add('no-3d');
    addSystemLine('3D 화면을 불러오지 못했어요. 채팅은 그대로 할 수 있어요.');
  }
})();
