// play.js: 놀이터 화면의 시작 파일. 서버 연결, 채팅 패널/입력, 3D 게임과의 연결을 담당
// (3D 부분은 game3d.js로 분리해서, 3D가 실패해도 채팅은 계속 동작하게 함)

import { openBoard, isBoardOpen, boardChanged } from './board.js';

const pageData = JSON.parse(document.getElementById('page-data').textContent);
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const playerCount = document.getElementById('player-count');
const notice = document.getElementById('notice');

// 이모티콘 목록 (서버의 EMOTE_COUNT와 개수를 맞춤). 숫자키 1~6 또는 아래 버튼으로 사용
const EMOTES = ['👋', '😂', '❤️', '😮', '👍', '🎉'];

let game = null;          // 3D 게임 객체 (불러오기에 실패하면 null 그대로)
let selfId = null;        // 내 소켓 id
let latestRides = null;   // 마지막으로 받은 놀이기구 상태 (3D가 늦게 준비돼도 반영하려고 보관)
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
  latestRides = { state: data.rides, serverNow: data.serverNow };
  if (game) game.setRides(data.rides, data.serverNow);
});

// 놀이기구 좌석 상태가 바뀜 (누가 타거나 내림)
socket.on('rides', (data) => {
  latestRides = data;
  if (game) game.setRides(data.state, data.serverNow);
});

// 놀이기구를 탈 수 없을 때 (자리 없음, 너무 멂 등): 안내 문구를 잠깐 바꿔서 보여줌
socket.on('ride-denied', (msg) => flashPrompt(msg));

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

// 이모티콘: 그 사람 캐릭터 머리 위에 크게 띄움
socket.on('emote', (e) => {
  if (game && EMOTES[e.index]) game.showEmote(e.id, EMOTES[e.index]);
});

// 입장/퇴장 같은 안내 메시지
socket.on('system', (text) => addSystemLine(text));

// 게시판에 변화가 생김 (모든 서버에 옴): 새 글이면 채팅창에 안내, 게시판이 열려 있으면 목록 새로고침
socket.on('board', (ev) => {
  if (ev.type === 'new') addSystemLine(`📌 ${ev.nickname}님이 게시판에 새 글을 올렸어요: ${ev.title}`);
  boardChanged(ev);
});

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
  if (isBoardOpen()) return; // 게시판 창이 열려 있으면 Enter는 게시판 입력에 씀
  if (e.key === 'Enter' && document.activeElement !== chatInput) {
    e.preventDefault();
    chatInput.focus();
  } else if (e.key === 'Escape' && document.activeElement === chatInput) {
    chatInput.blur();
  }
});

// ===== 이모티콘 =====
// 아래쪽 이모티콘 버튼 만들기
const emoteBar = document.getElementById('emote-bar');
EMOTES.forEach((emoji, i) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'emote-btn';
  btn.textContent = emoji;
  btn.title = `${i + 1}번 키`;
  btn.addEventListener('click', () => {
    socket.emit('emote', i);
    btn.blur(); // 버튼에 포커스가 남으면 스페이스바가 버튼을 다시 누르므로 해제
  });
  emoteBar.appendChild(btn);
});

// 숫자키 1~6으로 이모티콘 보내기 (채팅 입력 중에는 동작 안 함)
window.addEventListener('keydown', (e) => {
  if (isTyping() || e.repeat) return;
  const n = Number(e.key);
  if (n >= 1 && n <= EMOTES.length) socket.emit('emote', n - 1);
});

// ===== 놀이기구 타기 / 내리기 =====
const ridePrompt = document.getElementById('ride-prompt');
let promptText = null, flashTimer = null;
function showPrompt(text) {
  promptText = text;
  if (flashTimer) return; // 거절 메시지를 보여 주는 중이면 잠시 기다림
  ridePrompt.textContent = text || '';
  ridePrompt.classList.toggle('hidden', !text);
}
function flashPrompt(msg) {
  clearTimeout(flashTimer);
  ridePrompt.textContent = msg;
  ridePrompt.classList.remove('hidden');
  ridePrompt.classList.add('denied');
  flashTimer = setTimeout(() => {
    flashTimer = null;
    ridePrompt.classList.remove('denied');
    showPrompt(promptText);
  }, 1800);
}

// Shift: 근처 놀이기구 타기 / 타고 있으면 내리기. 타는 중 Space도 내리기
window.addEventListener('keydown', (e) => {
  if (!game || isTyping() || e.repeat) return;
  const riding = game.isRiding();
  if (e.key === 'Shift' || (e.code === 'Space' && riding)) {
    const act = game.interact();
    if (!act) return;
    if (act.type === 'board') {
      openBoardWindow();
    } else if (act.type === 'leave') {
      socket.emit('ride-leave');
      game.clearKey('Space'); // 내리자마자 점프하지 않게
    } else {
      socket.emit('ride-join', { ride: act.ride });
    }
  }
});

// ===== 게시판 =====
// 게시판 오브젝트 앞 Shift 또는 오른쪽 위 버튼으로 열기 (3D가 안 돼도 버튼으로 쓸 수 있음)
function openBoardWindow() {
  if (game) game.releaseKeys();
  openBoard();
}
const boardBtn = document.getElementById('board-open-btn');
boardBtn.addEventListener('click', () => {
  boardBtn.blur();
  openBoardWindow();
});

// 채팅 입력 중이거나 게시판 창이 열려 있는지 (이때는 WASD/점프/이모티콘/Shift가 동작하지 않게 3D 쪽에서 확인)
function isTyping() {
  if (isBoardOpen()) return true;
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

// 로딩 화면 숨기기 (살짝 사라지는 효과)
function hideLoading() {
  const el = document.getElementById('loading');
  el.classList.add('done');
  setTimeout(() => el.remove(), 500);
}

// ===== 3D 게임 불러오기 =====
// 실패해도(WebGL 미지원 등) 채팅은 그대로 쓸 수 있게 try/catch로 감쌈
(async () => {
  try {
    // 로딩 화면: 모델을 받는 만큼 진행률 막대를 채움
    const loader = await import('./loader.js');
    loader.setAssetVersion(pageData.assetVersion);
    loader.onLoadingProgress((ratio) => {
      const fill = document.getElementById('loading-fill');
      if (!fill) return; // 로딩 화면이 이미 사라진 뒤(캐릭터 모델 추가 로딩)에는 무시
      const pct = Math.round(ratio * 100);
      fill.style.width = pct + '%';
      document.getElementById('loading-text').textContent = pct + '%';
    });
    const { createGame } = await import('./game3d.js');
    game = await createGame({
      container: document.getElementById('game'),
      me: pageData.me,
      toys: pageData.toys,
      isTyping,
      onMove: (x, z, r, y) => socket.emit('move', { x, z, r, y }),
      onPrompt: showPrompt,
    });
    // 3D가 늦게 준비된 경우, 이미 받은 사람 목록을 반영
    if (selfId) game.setPlayers([...players.values()], selfId);
    if (latestRides) game.setRides(latestRides.state, latestRides.serverNow);
    hideLoading();
  } catch (err) {
    console.error('3D 불러오기 실패:', err);
    hideLoading();
    document.body.classList.add('no-3d');
    addSystemLine('3D 화면을 불러오지 못했어요. 채팅은 그대로 할 수 있어요.');
  }
})();
