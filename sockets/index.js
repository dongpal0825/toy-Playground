// sockets/index.js: socket.io 실시간 기능 (입장/퇴장, 채팅 저장/전송, 캐릭터 위치 동기화)
const { Server } = require('socket.io');
const pool = require('../db');
const rooms = require('../game/rooms');
const rides = require('../game/rides');

const RECENT_CHAT_COUNT = 30;  // 입장할 때 불러올 최근 채팅 수
const CHAT_MAX_LENGTH = 200;   // 채팅 한 줄 최대 글자 수 (DB 컬럼 길이와 같음)
const CHAT_COOLDOWN_MS = 500;  // 채팅 도배 방지: 0.5초에 한 번만
const MOVE_COOLDOWN_MS = 40;   // 위치 받기 제한: 1초에 최대 25번
const BROADCAST_MS = 66;       // 위치 보내기 주기: 1초에 약 15번
const EMOTE_COUNT = 6;         // 이모티콘 종류 수 (화면의 public/js/play.js EMOTES 목록과 같아야 함)
const EMOTE_COOLDOWN_MS = 800; // 이모티콘 도배 방지

function setupSockets(server, sessionMiddleware) {
  const io = new Server(server);

  // 로그인 세션을 socket.io에서도 읽을 수 있게 연결 (socket.request.session)
  io.engine.use(sessionMiddleware);

  io.on('connection', (socket) => {
    const user = socket.request.session && socket.request.session.user;
    // 로그인하지 않은 연결은 바로 끊음
    if (!user) {
      socket.emit('fatal', '로그인이 필요해요.');
      return socket.disconnect(true);
    }

    let roomId = null;      // 이 소켓이 들어간 방 번호
    let logId = null;       // play_logs 테이블의 이번 접속 기록 id
    let lastChatAt = 0;
    let lastMoveAt = 0;
    let lastEmoteAt = 0;
    let lastRideAt = 0;     // 놀이기구 타기/내리기 연타 방지
    let joining = false;    // 입장 처리 중 표시 (join을 여러 번 보내도 한 번만 처리)

    // 입장: 인원 확인 -> 기록 남기기 -> 현재 상태와 최근 채팅을 보내줌
    socket.on('join', async (data) => {
      try {
        if (roomId !== null || joining) return; // 이미 입장했거나 입장 처리 중인 소켓
        joining = true;
        const wantRoom = Number(data && data.roomId);
        if (!rooms.isValidRoom(wantRoom)) return socket.emit('fatal', '없는 서버예요.');

        // 같은 계정이 다른 탭/기기에서 접속 중이면 예전 접속을 끊음
        const old = rooms.findSocketByUser(user.id);
        if (old) {
          const oldSocket = io.sockets.sockets.get(old.socketId);
          if (oldSocket) {
            oldSocket.emit('fatal', '다른 곳에서 같은 계정으로 접속해서 연결이 끊겼어요.');
            oldSocket.disconnect(true);
          }
        }

        const [roomRows] = await pool.query('SELECT name, max_players FROM rooms WHERE id = ?', [wantRoom]);
        if (rooms.getCounts()[wantRoom] >= roomRows[0].max_players) {
          return socket.emit('fatal', '서버가 꽉 찼어요. 다른 서버를 골라 주세요.');
        }

        // 마지막으로 놀던 위치에서 시작 (기록이 없으면 놀이터 입구)
        const [lastRows] = await pool.query(
          'SELECT last_x, last_z FROM play_logs WHERE user_id = ? AND last_x IS NOT NULL ORDER BY id DESC LIMIT 1',
          [user.id]
        );
        const start = lastRows[0] ? { x: lastRows[0].last_x, z: lastRows[0].last_z } : { x: 0, z: 18 };

        // 접속 기록(play_logs) 남기기
        const [logResult] = await pool.query('INSERT INTO play_logs (user_id, room_id) VALUES (?, ?)', [user.id, wantRoom]);
        logId = logResult.insertId;

        // 최근 채팅 불러오기 (오래된 것부터 보이게 순서 뒤집기)
        const [chatRows] = await pool.query(
          `SELECT c.content, c.created_at, u.nickname
             FROM chat_messages c JOIN users u ON u.id = c.user_id
            WHERE c.room_id = ? ORDER BY c.id DESC LIMIT ?`,
          [wantRoom, RECENT_CHAT_COUNT]
        );

        // DB를 기다리는 사이에 연결이 끊겼으면 방에 넣지 않고 기록만 닫음 (유령 캐릭터 방지)
        if (!socket.connected) {
          await pool.query('UPDATE play_logs SET left_at = NOW() WHERE id = ?', [logId]);
          return;
        }

        // 메모리의 방 상태에 추가하고 socket.io 방에 참가
        roomId = wantRoom;
        rooms.addPlayer(roomId, socket.id, {
          userId: user.id, logId, nickname: user.nickname, toyId: user.toyId, color: user.color,
          x: start.x, z: start.z, r: Math.PI, // 처음엔 놀이터 안쪽(카메라 반대쪽)을 바라봄
        });
        socket.join(roomKey(roomId));

        socket.emit('init', {
          selfId: socket.id,
          roomName: roomRows[0].name,
          players: rooms.listPlayers(roomId),
          chats: chatRows.reverse().map((c) => ({ nickname: c.nickname, content: c.content, at: c.created_at })),
          rides: rides.getState(roomId),   // 놀이기구 좌석 상태 (누가 타고 있는지)
          serverNow: Date.now(),           // 화면이 서버 시각에 맞춰 놀이기구를 움직이도록
        });

        const me = rooms.listPlayers(roomId).find((p) => p.id === socket.id);
        socket.to(roomKey(roomId)).emit('player-joined', me);
        io.to(roomKey(roomId)).emit('system', `${user.nickname}님이 들어왔어요.`);
      } catch (err) {
        console.error('join 오류:', err);
        socket.emit('fatal', '입장 중 오류가 발생했어요.');
      } finally {
        joining = false;
      }
    });

    // 채팅: 길이/도배 검사 -> DB 저장 -> 같은 방 모두에게 전송 (말풍선도 이걸로 띄움)
    socket.on('chat', async (text) => {
      try {
        if (roomId === null || typeof text !== 'string') return;
        const content = text.trim().slice(0, CHAT_MAX_LENGTH);
        if (!content) return;
        const now = Date.now();
        if (now - lastChatAt < CHAT_COOLDOWN_MS) return;
        lastChatAt = now;

        await pool.query('INSERT INTO chat_messages (room_id, user_id, content) VALUES (?, ?, ?)', [roomId, user.id, content]);
        io.to(roomKey(roomId)).emit('chat', { id: socket.id, nickname: user.nickname, content, at: new Date() });
      } catch (err) {
        console.error('chat 오류:', err);
      }
    });

    // 이모티콘: 정해진 목록의 번호만 받아서 같은 방 모두에게 전송 (DB에는 저장하지 않음)
    socket.on('emote', (index) => {
      if (roomId === null) return;
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0 || i >= EMOTE_COUNT) return;
      const now = Date.now();
      if (now - lastEmoteAt < EMOTE_COOLDOWN_MS) return;
      lastEmoteAt = now;
      io.to(roomKey(roomId)).emit('emote', { id: socket.id, index: i });
    });

    // 놀이기구 타기: 구역/빈자리 검사는 game/rides.js가 함. 성공하면 같은 방 모두에게 좌석 상태 전송
    socket.on('ride-join', (data) => {
      if (roomId === null || !data) return;
      const now = Date.now();
      if (now - lastRideAt < 300) return;
      lastRideAt = now;
      const player = rooms.getPlayer(roomId, socket.id);
      if (!player) return;
      const result = rides.join(roomId, socket.id, String(data.ride), player);
      if (!result.ok) return socket.emit('ride-denied', result.reason);
      emitRides(roomId);
      // 미끄럼틀은 다 내려오면 서버가 자동으로 자리를 비움
      if (data.ride === 'slide') {
        const myRoom = roomId;
        rides.scheduleSlideEnd(myRoom, socket.id, () => {
          rides.leave(myRoom, socket.id);
          emitRides(myRoom);
        });
      }
    });

    // 놀이기구 내리기
    socket.on('ride-leave', () => {
      if (roomId === null) return;
      if (rides.leave(roomId, socket.id)) emitRides(roomId);
    });

    // 이동: 너무 자주 오는 요청은 버리고 메모리의 위치만 갱신 (전송은 아래 타이머가 모아서 함)
    socket.on('move', (data) => {
      if (roomId === null || !data) return;
      const now = Date.now();
      if (now - lastMoveAt < MOVE_COOLDOWN_MS) return;
      lastMoveAt = now;
      const x = Number(data.x), z = Number(data.z), r = Number(data.r), y = Number(data.y) || 0;
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(r) || !Number.isFinite(y)) return;
      rooms.updatePosition(roomId, socket.id, x, z, r, y);
    });

    // 퇴장: 메모리에서 지우고, play_logs에 퇴장 시간과 마지막 위치 저장
    socket.on('disconnect', async () => {
      if (roomId === null) return;
      const player = rooms.removePlayer(roomId, socket.id);
      if (rides.leave(roomId, socket.id)) emitRides(roomId); // 타고 있던 자리 비우기
      io.to(roomKey(roomId)).emit('player-left', socket.id);
      if (player) io.to(roomKey(roomId)).emit('system', `${player.nickname}님이 나갔어요.`);
      try {
        if (logId && player) {
          await pool.query('UPDATE play_logs SET left_at = NOW(), last_x = ?, last_z = ? WHERE id = ?', [player.x, player.z, logId]);
        }
      } catch (err) {
        console.error('퇴장 기록 오류:', err);
      }
    });
  });

  // 놀이기구 좌석 상태를 같은 방 모두에게 보냄 (서버 시각 포함)
  function emitRides(id) {
    io.to(roomKey(id)).emit('rides', { state: rides.getState(id), serverNow: Date.now() });
  }

  // 위치 전송 타이머: 1초에 약 15번, 각 방에서 움직인 사람들의 위치만 모아서 한 번에 보냄
  setInterval(() => {
    for (const id of rooms.ROOM_IDS) {
      const moved = rooms.takeMoved(id);
      if (moved.length > 0) io.to(roomKey(id)).emit('moves', moved);
    }
  }, BROADCAST_MS);

  // 서버가 꺼질 때(pm2 restart, Ctrl+C) 접속 중인 모든 사람의 퇴장 시간과 마지막 위치를 저장
  async function saveAllOnShutdown() {
    for (const id of rooms.ROOM_IDS) {
      for (const p of rooms.listPlayersRaw(id)) {
        try {
          await pool.query('UPDATE play_logs SET left_at = NOW(), last_x = ?, last_z = ? WHERE id = ?', [p.x, p.z, p.logId]);
        } catch (err) {
          console.error('종료 저장 오류:', err.message);
        }
      }
    }
  }

  return { io, saveAllOnShutdown };
}

// 서버가 시작될 때: 지난번에 갑자기 꺼져서 퇴장 시간이 비어 있는 기록을 정리
async function closeDanglingLogs() {
  try {
    const [r] = await pool.query('UPDATE play_logs SET left_at = NOW() WHERE left_at IS NULL');
    if (r.affectedRows > 0) console.log(`닫히지 않은 접속 기록 ${r.affectedRows}개 정리`);
  } catch (err) {
    console.error('접속 기록 정리 오류:', err.message);
  }
}
setupSockets.closeDanglingLogs = closeDanglingLogs;

// socket.io 방 이름 (예: "room-1")
function roomKey(id) {
  return 'room-' + id;
}

module.exports = setupSockets;
