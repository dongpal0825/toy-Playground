// rides.js: 놀이기구 동작 (그네 흔들기, 시소 오르내리기, 뺑뺑이 돌기, 미끄럼틀 내려오기)
// 서버는 "누가 몇 시에 탔는지"만 알려 주고, 움직임은 모든 화면이 서버 시각을 기준으로 똑같이 계산함
// playground.glb 안의 이름 규칙: RIDE_(움직이는 부품) / SEAT_(좌석, 부품의 자식) / PATH_slide_00..(미끄럼틀 경로)
//                                 ZONE_(탈 수 있는 구역, scale = 반지름) / EXIT_(내린 뒤 서는 자리)
import * as THREE from 'three';

export const RIDE_NAMES = { slide: '미끄럼틀', swing: '그네', seesaw: '시소', merry: '뺑뺑이' };
const SLIDE_MS = 3000;       // 미끄럼틀 내려오는 시간 (서버 game/rides.js와 같아야 함)
const MERRY_SPEED = 0.9;     // 뺑뺑이 회전 속도 (서버와 같아야 함)
const SEESAW_TILT = 0.14;    // 시소 기울기 (Blender에서 이 각도로 만들어 둠)
const SEESAW_PIVOT_Z = 0.76; // 시소 회전축 높이

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const tmpQ = new THREE.Quaternion();

export function createRides(mapGroup) {
  // ===== 맵에서 놀이기구 부품/표시 찾기 =====
  const parts = {}, seats = {}, zones = {}, exits = {}, path = [];
  mapGroup.traverse((o) => {
    const n = o.name;
    if (n.startsWith('RIDE_')) { parts[n.slice(5)] = o; o.userData.q0 = o.quaternion.clone(); }
    else if (n.startsWith('SEAT_')) seats[n.slice(5)] = o;
    else if (n.startsWith('ZONE_')) zones[n.slice(5)] = o;
    else if (n.startsWith('EXIT_')) exits[n.slice(5)] = o;
    else if (n.startsWith('PATH_slide_')) path.push(o);
  });
  const available = Object.keys(zones).length > 0;

  // 미끄럼틀 경로: 이름 순서대로 정렬하고 구간 길이를 미리 계산
  path.sort((a, b) => a.name.localeCompare(b.name));
  const pathPts = path.map((o) => o.getWorldPosition(new THREE.Vector3()));
  const pathLen = [0];
  for (let i = 1; i < pathPts.length; i++) pathLen.push(pathLen[i - 1] + pathPts[i].distanceTo(pathPts[i - 1]));

  // 구역 정보 (중심, 반지름)
  const zoneInfo = {};
  for (const [name, o] of Object.entries(zones)) {
    const p = o.getWorldPosition(new THREE.Vector3());
    zoneInfo[name] = { x: p.x, z: p.z, r: o.getWorldScale(new THREE.Vector3()).x };
  }

  let state = null;     // 서버가 보낸 좌석 상태
  let clockOffset = 0;  // 서버 시각 - 내 컴퓨터 시각
  const cur = { swing: [0, 0], seesaw: SEESAW_TILT }; // 부드럽게 따라가는 현재 각도
  const lastRide = new Map(); // 캐릭터 id -> 지난 프레임에 타고 있던 {ride, seat}

  // ===== 상태 받기 =====
  function setState(s, serverNow) {
    state = s;
    clockOffset = serverNow - Date.now();
  }
  const serverTime = () => Date.now() + clockOffset;

  // 이 캐릭터가 지금 타고 있는 놀이기구 (없으면 null)
  function rideOf(id) {
    if (!state) return null;
    for (const ride of Object.keys(RIDE_NAMES)) {
      const i = state[ride].seats.findIndex((s) => s && s.id === id);
      if (i >= 0) return { ride, seat: i, since: state[ride].seats[i].since };
    }
    return null;
  }

  // 내 위치에서 가장 가까운 탈 수 있는 놀이기구
  function nearestZone(pos) {
    let best = null, bestD = Infinity;
    for (const [name, z] of Object.entries(zoneInfo)) {
      const d = Math.hypot(pos.x - z.x, pos.z - z.z);
      if (d < z.r && d < bestD) { best = name; bestD = d; }
    }
    return best;
  }

  // 놀이기구 이용 현황 (안내 문구용): { used, total }
  function occupancy(ride) {
    if (!state) return null;
    const s = state[ride].seats;
    return { used: s.filter(Boolean).length, total: s.length };
  }

  // ===== 매 프레임: 부품 움직이기 + 탄 캐릭터를 좌석에 붙이기 =====
  function update(characters, dt, onDismount) {
    if (!available || !state) return;
    const t = serverTime();
    const k = 1 - Math.exp(-8 * dt); // 부드럽게 따라가는 비율

    // 그네: 탄 사람이 있으면 점점 크게 흔들림, 비면 서서히 멈춤
    for (let i = 0; i < 2; i++) {
      const part = parts[`swing_${i + 1}`];
      if (!part) continue;
      const occ = state.swing.seats[i];
      let target = 0;
      if (occ) {
        const el = (t - occ.since) / 1000;
        target = 0.55 * Math.min(1, el / 2.5) * Math.sin((2 * Math.PI * el) / 2.6);
        cur.swing[i] = target;
      } else {
        cur.swing[i] += (0 - cur.swing[i]) * (1 - Math.exp(-1.5 * dt));
      }
      part.quaternion.copy(part.userData.q0).multiply(tmpQ.setFromAxisAngle(X, cur.swing[i]));
    }

    // 시소: 두 명이 타면 오르내림, 한 명이면 그 사람 쪽으로 내려가 대기
    if (parts.seesaw) {
      const [a, b] = state.seesaw.seats;
      let target = SEESAW_TILT; // 아무도 없으면 원래 모양 (1번 좌석 쪽이 내려감)
      if (a && b && state.seesaw.activeSince) {
        target = SEESAW_TILT * Math.cos((2 * Math.PI * (t - state.seesaw.activeSince)) / 1000 / 2.4);
      } else if (b && !a) {
        target = -SEESAW_TILT;
      }
      cur.seesaw += (target - cur.seesaw) * k;
      const delta = cur.seesaw - SEESAW_TILT;
      parts.seesaw.quaternion.copy(parts.seesaw.userData.q0).multiply(tmpQ.setFromAxisAngle(Z, -delta));
      // 스프링: 판 끝 높이에 맞춰 늘었다 줄었다 (판 끝 밑면 높이를 회전 공식으로 계산)
      const ends = [{ part: parts.seesaw_spring_1, d: 2.35, h: 0.422 }, { part: parts.seesaw_spring_2, d: -2.35, h: 1.078 }];
      for (const e of ends) {
        if (!e.part) continue;
        const relZ = e.h - SEESAW_PIVOT_Z;
        const bottom = -e.d * Math.sin(delta) + relZ * Math.cos(delta) + SEESAW_PIVOT_Z;
        e.part.scale.y = Math.max(0.2, (bottom - 0.08) / (e.h - 0.08));
      }
    }

    // 뺑뺑이: 한 명이라도 타면 일정한 속도로 돎 (멈췄던 각도에서 이어서)
    if (parts.merry) {
      const m = state.merry;
      const angle = m.angleBase + (m.spinSince ? (MERRY_SPEED * (t - m.spinSince)) / 1000 : 0);
      parts.merry.quaternion.copy(parts.merry.userData.q0).multiply(tmpQ.setFromAxisAngle(Y, angle));
    }
    mapGroup.updateMatrixWorld(true);

    // 탄 캐릭터 위치/방향 정하기
    const riding = new Set();
    for (const [id, c] of characters) {
      const r = rideOf(id);
      if (r) {
        riding.add(id);
        lastRide.set(id, r);
        c.riding = true;
        c.speed = 0;
        if (r.ride === 'slide') placeOnSlide(c, (t - r.since) / SLIDE_MS);
        else {
          const seat = seats[`${r.ride}_${r.seat + 1}`];
          if (seat) {
            seat.getWorldPosition(c.root.position);
            seat.getWorldQuaternion(c.root.quaternion);
          }
        }
      } else if (c.riding) {
        // 방금 내림: 내리는 자리로 옮기고 똑바로 세움
        c.riding = false;
        const prev = lastRide.get(id);
        lastRide.delete(id);
        const p = exitPoint(prev, c.root.position);
        const yaw = new THREE.Euler().setFromQuaternion(c.root.quaternion, 'YXZ').y;
        c.root.position.set(p.x, 0, p.z);
        c.root.rotation.set(0, yaw, 0);
        if (onDismount) onDismount(id, c);
      }
    }
  }

  // 미끄럼틀 경로 위의 위치 (p: 0~1). 점점 빨라지게 p를 제곱에 가깝게 변환
  function placeOnSlide(c, p) {
    if (pathPts.length < 2) return;
    const s = Math.min(1, Math.max(0, p)) ** 1.35 * pathLen[pathLen.length - 1];
    let i = 1;
    while (i < pathLen.length - 1 && pathLen[i] < s) i++;
    const a = pathPts[i - 1], b = pathPts[i];
    const f = (s - pathLen[i - 1]) / Math.max(1e-6, pathLen[i] - pathLen[i - 1]);
    c.root.position.lerpVectors(a, b, Math.min(1, f));
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    c.root.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
  }

  // 내린 뒤 설 자리 (뺑뺑이는 앉아 있던 자리에서 바깥쪽으로)
  function exitPoint(prev, curPos) {
    if (prev) {
      if (prev.ride === 'merry') {
        const z = zoneInfo.merry;
        const dx = curPos.x - z.x, dz = curPos.z - z.z, d = Math.hypot(dx, dz) || 1;
        return { x: z.x + (dx / d) * 3.0, z: z.z + (dz / d) * 3.0 };
      }
      const e = exits[prev.ride === 'slide' ? 'slide' : `${prev.ride}_${prev.seat + 1}`];
      if (e) {
        const p = e.getWorldPosition(new THREE.Vector3());
        return { x: p.x, z: p.z };
      }
    }
    return { x: curPos.x, z: curPos.z };
  }

  return { available, setState, rideOf, nearestZone, occupancy, update };
}
