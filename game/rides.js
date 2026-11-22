// game/rides.js: 놀이기구(미끄럼틀, 그네, 시소, 뺑뺑이) 좌석을 서버 메모리에서 관리하는 파일
// 누가 어느 자리에 앉았는지와 탄 시각만 저장하고, 실제 움직임은 각 화면이 "서버 시각" 기준으로 똑같이 계산함
// (그래서 타는 동안에는 위치를 계속 주고받지 않아도 모두의 화면에서 같은 동작이 보임)

const ROOM_IDS = [1, 2, 3];

// 놀이기구 정의: 좌석 수, 탈 수 있는 구역(놀이터 좌표 x, z와 반지름 r)
// 구역 좌표는 Blender의 ZONE_ 물체와 같음 (Blender (x, y) -> 게임 (x, -y))
const RIDES = {
  slide:  { seats: 1, zone: { x: 9, z: -9.6, r: 1.8 }, durationMs: 3000 }, // 미끄럼틀: 1명, 3초 뒤 자동으로 내림
  swing:  { seats: 2, zone: { x: 10.5, z: 6.5, r: 3.6 } },                 // 그네: 의자 2개
  seesaw: { seats: 2, zone: { x: -10, z: 6, r: 3.4 } },                    // 시소: 2명이 타야 움직임
  merry:  { seats: 4, zone: { x: 0, z: -11, r: 3.3 } },                    // 뺑뺑이: 최대 4명, 1명만 타도 돎
};
const ZONE_MARGIN = 1.5;          // 구역 판정 여유 (위치 전송 지연 고려)
const MERRY_SPEED = 0.9;          // 뺑뺑이 회전 속도 (라디안/초, 화면 쪽과 같아야 함)

// 방마다 놀이기구 상태: { slide: { seats: [ {id, since} | null ] }, ..., merry에는 회전 각도 정보 추가 }
const state = new Map(ROOM_IDS.map((id) => [id, createRoomState()]));
const slideTimers = new Map(); // 미끄럼틀 자동 하차 타이머 (방번호 -> timeout)

function createRoomState() {
  const s = {};
  for (const [name, def] of Object.entries(RIDES)) {
    s[name] = { seats: Array(def.seats).fill(null) };
  }
  s.merry.angleBase = 0;   // 멈춰 있을 때의 각도
  s.merry.spinSince = null; // 돌기 시작한 서버 시각 (안 돌면 null)
  s.seesaw.activeSince = null; // 두 명이 다 앉은 시각 (움직이기 시작)
  return s;
}

// 이 소켓이 지금 타고 있는 놀이기구와 자리 찾기
function findRider(roomId, socketId) {
  const s = state.get(roomId);
  for (const name of Object.keys(RIDES)) {
    const i = s[name].seats.findIndex((seat) => seat && seat.id === socketId);
    if (i >= 0) return { ride: name, seat: i };
  }
  return null;
}

// 타기: 구역 안인지, 빈자리가 있는지 확인하고 앉힘. 결과 { ok, seat } 또는 { ok: false, reason }
function join(roomId, socketId, rideName, playerPos) {
  const def = RIDES[rideName];
  if (!def) return { ok: false, reason: '없는 놀이기구예요.' };
  if (findRider(roomId, socketId)) return { ok: false, reason: '이미 타고 있어요.' };

  const dx = playerPos.x - def.zone.x, dz = playerPos.z - def.zone.z;
  if (Math.hypot(dx, dz) > def.zone.r + ZONE_MARGIN) return { ok: false, reason: '놀이기구에 더 가까이 가 주세요.' };

  const ride = state.get(roomId)[rideName];
  const seat = ride.seats.findIndex((x) => x === null);
  if (seat < 0) {
    return { ok: false, reason: rideName === 'slide' ? '다른 친구가 미끄럼틀을 타고 있어요.' : '자리가 꽉 찼어요.' };
  }

  const now = Date.now();
  ride.seats[seat] = { id: socketId, since: now };
  afterChange(roomId, rideName, now);
  return { ok: true, seat };
}

// 내리기: 타고 있던 자리를 비움. 내린 놀이기구 정보를 돌려줌 (없으면 null)
function leave(roomId, socketId) {
  const found = findRider(roomId, socketId);
  if (!found) return null;
  const now = Date.now();
  state.get(roomId)[found.ride].seats[found.seat] = null;
  afterChange(roomId, found.ride, now);
  return found;
}

// 자리 변화 뒤 처리: 시소 시작/정지, 뺑뺑이 회전 각도 이어 붙이기
function afterChange(roomId, rideName, now) {
  const s = state.get(roomId);
  if (rideName === 'seesaw') {
    const full = s.seesaw.seats.every((x) => x !== null);
    if (full && s.seesaw.activeSince === null) s.seesaw.activeSince = now;
    if (!full) s.seesaw.activeSince = null;
  }
  if (rideName === 'merry') {
    const anyone = s.merry.seats.some((x) => x !== null);
    if (anyone && s.merry.spinSince === null) {
      s.merry.spinSince = now; // 한 명이라도 타면 돌기 시작
    } else if (!anyone && s.merry.spinSince !== null) {
      // 모두 내리면 지금까지 돈 각도를 저장하고 멈춤 (다시 돌 때 이어서 돎)
      s.merry.angleBase += MERRY_SPEED * (now - s.merry.spinSince) / 1000;
      s.merry.spinSince = null;
    }
  }
}

// 화면에 보낼 놀이기구 상태 (방 하나)
function getState(roomId) {
  return state.get(roomId);
}

// 미끄럼틀 자동 하차 예약 (탄 지 durationMs 뒤에 onDone 호출)
function scheduleSlideEnd(roomId, socketId, onDone) {
  clearTimeout(slideTimers.get(roomId));
  slideTimers.set(roomId, setTimeout(() => {
    const found = findRider(roomId, socketId);
    if (found && found.ride === 'slide') onDone();
  }, RIDES.slide.durationMs));
}

module.exports = { RIDES, join, leave, findRider, getState, scheduleSlideEnd };
