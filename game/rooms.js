// game/rooms.js: 서버 1~3에 지금 누가 접속해 있고 어디에 있는지를 서버 메모리에 보관하는 파일
// (위치는 초당 여러 번 바뀌므로 DB가 아니라 메모리에 두고, 퇴장할 때만 DB에 저장)

const ROOM_IDS = [1, 2, 3];
const MAP_LIMIT = 28; // 놀이터 맵의 가장자리 (x, z 모두 -28 ~ 28 안에서만 움직일 수 있음)
const MAX_JUMP_HEIGHT = 2; // 점프 높이 최대값 (이상한 값이 와도 하늘로 날아가지 않게)

// 방 번호 -> (소켓 id -> 플레이어 정보) 형태로 저장
const rooms = new Map(ROOM_IDS.map((id) => [id, new Map()]));

// 올바른 방 번호인지 확인
function isValidRoom(roomId) {
  return rooms.has(roomId);
}

// 방에 플레이어 추가
function addPlayer(roomId, socketId, player) {
  rooms.get(roomId).set(socketId, { ...player, dirty: false });
}

// 방에서 플레이어 제거 (퇴장할 때 마지막 정보를 돌려줌)
function removePlayer(roomId, socketId) {
  const room = rooms.get(roomId);
  const player = room.get(socketId);
  room.delete(socketId);
  return player;
}

// 방에 있는 플레이어 목록 (화면에 보낼 정보만 골라서)
function listPlayers(roomId) {
  return [...rooms.get(roomId).entries()].map(([id, p]) => publicInfo(id, p));
}

// 서버 내부용: 방에 있는 플레이어의 전체 정보 (종료 시 DB 저장에 사용)
function listPlayersRaw(roomId) {
  return [...rooms.get(roomId).values()];
}

// 다른 유저에게 보내도 되는 정보만 추림 (DB id 등은 최소한으로)
function publicInfo(socketId, p) {
  return { id: socketId, nickname: p.nickname, toyId: p.toyId, color: p.color, x: p.x, y: p.y || 0, z: p.z, r: p.r };
}

// 위치 갱신: 맵 밖으로 못 나가게 자르고, "움직였음" 표시(dirty)를 남김 (y는 점프 높이)
function updatePosition(roomId, socketId, x, z, r, y = 0) {
  const p = rooms.get(roomId).get(socketId);
  if (!p) return;
  p.x = clamp(x, -MAP_LIMIT, MAP_LIMIT);
  p.z = clamp(z, -MAP_LIMIT, MAP_LIMIT);
  p.r = r;
  p.y = clamp(y, 0, MAX_JUMP_HEIGHT);
  p.dirty = true;
}

// 이번 전송 주기에 움직인 플레이어만 모아서 돌려주고 표시를 지움
function takeMoved(roomId) {
  const moved = [];
  for (const [id, p] of rooms.get(roomId)) {
    if (p.dirty) {
      moved.push({ id, x: round2(p.x), y: round2(p.y), z: round2(p.z), r: round2(p.r) });
      p.dirty = false;
    }
  }
  return moved;
}

// 서버별 현재 인원 수 (서버 선택 화면에 표시)
function getCounts() {
  const counts = {};
  for (const [id, room] of rooms) counts[id] = room.size;
  return counts;
}

// 같은 유저(DB id)가 이미 어딘가 접속해 있으면 그 소켓 id를 찾음 (중복 접속 방지용)
function findSocketByUser(userId) {
  for (const [roomId, room] of rooms) {
    for (const [socketId, p] of room) {
      if (p.userId === userId) return { roomId, socketId };
    }
  }
  return null;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
function round2(v) {
  return Math.round(v * 100) / 100;
}

module.exports = {
  ROOM_IDS, MAP_LIMIT, isValidRoom, addPlayer, removePlayer, listPlayers, listPlayersRaw,
  publicInfo, updatePosition, takeMoved, getCounts, findSocketByUser,
};
