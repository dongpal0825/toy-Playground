// game3d.js: 3D 놀이터 화면. 장면/조명, 내 캐릭터 이동(WASD), 로블록스식 카메라, 다른 유저 표시, 닉네임/말풍선
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadGLB } from './loader.js';
import { createMap } from './map.js';
import { createCharacter, CHARACTER_HEIGHT } from './characters.js';
import { createRides, RIDE_NAMES } from './rides.js';

const MOVE_SPEED = 5;        // 초당 이동 거리 (m)
const MAP_LIMIT = 28;        // 서버의 rooms.js와 같은 값
const PLAYER_RADIUS = 0.45;  // 캐릭터 충돌 반지름
const SEND_INTERVAL = 1 / 15; // 위치 보내는 간격 (1초에 15번)
const BUBBLE_MS = 5000;      // 말풍선이 떠 있는 시간
const JUMP_SPEED = 7.5;      // 점프할 때 위로 튀어 오르는 속도
const GRAVITY = 24;          // 중력 (클수록 빨리 떨어짐)
const EMOTE_MS = 2200;       // 이모티콘이 떠 있는 시간 (CSS 애니메이션 길이와 같음)
// 게시판 오브젝트: 입구 길 옆에 세우고 앞면이 길(-x 방향)을 보게 함. 앞에 서서 Shift를 누르면 게시판 창이 열림
const BOARD = { x: 7.5, z: 15, yaw: -Math.PI / 2, zone: { x: 6.2, z: 15, r: 2.2 } };

export async function createGame({ container, me, toys, isTyping, onMove, onPrompt }) {
  // WebGL을 쓸 수 없으면 에러를 던져서 play.js가 "채팅만 모드"로 전환하게 함
  const testCanvas = document.createElement('canvas');
  if (!testCanvas.getContext('webgl2') && !testCanvas.getContext('webgl')) {
    throw new Error('WebGL을 지원하지 않는 브라우저');
  }

  // ===== 렌더러, 장면, 카메라 =====
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 고해상도 화면에서 너무 무거워지지 않게 1.5배까지만
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // 부드러운 그림자 (radius로 가장자리를 흐리게)
  renderer.toneMapping = THREE.NeutralToneMapping; // 장난감 색이 탁해지지 않게 색을 살리는 톤 매핑
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  // 닉네임/말풍선용 HTML 레이어 (3D 위치를 따라다니는 div)
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = makeSkyGradient(); // 위는 진한 하늘색, 아래는 연한 하늘색
  scene.fog = new THREE.Fog('#bfe6ff', 50, 110);

  // 은은한 주변 반사광: 플라스틱 장난감에 하이라이트가 생기도록 (three.js 내장 RoomEnvironment 사용)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.12;

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);

  // 조명: 하늘빛 + 햇빛(그림자)
  scene.add(new THREE.HemisphereLight('#e8f6ff', '#86c96f', 0.55));
  const sun = new THREE.DirectionalLight('#fff3e0', 3.2); // 살짝 따뜻한 햇빛
  const SUN_OFFSET = new THREE.Vector3(14, 26, 10);      // 내 캐릭터 기준 햇빛 방향
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // 그림자는 내 캐릭터 주변 44m 범위만 계산해서 더 선명하게 (캐릭터를 따라다님)
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
  sun.shadow.normalBias = 0.03; // 곡면에 생기는 줄무늬 그림자(shadow acne) 방지
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);
  if (location.search.includes('debug')) window.__dbg = { renderer, scene, sun, camera }; // 개발용 (주소에 ?debug)

  // 놀이터 맵: Blender로 만든 playground.glb를 먼저 불러오고, 실패하면 코드로 만든 맵(map.js)을 사용
  const map = await loadMap();
  scene.add(map.group);
  await addBoard(scene, map.colliders);
  // 놀이기구 (맵에 RIDE_/SEAT_/ZONE_ 표시가 있을 때만 동작, 예비 맵에서는 비활성)
  const rides = createRides(map.group);
  if (window.__dbg) Object.assign(window.__dbg, { rides, getChars: () => characters, getSelf: () => self }); // 개발용 (?debug)

  const toyById = new Map(toys.map((t) => [t.id, t]));

  // ===== 캐릭터 관리 =====
  // 소켓 id -> { root, body, label, bubbleEl, target, speed, walkTime }
  const characters = new Map();
  let selfId = null;
  let self = null; // 내 캐릭터 (characters 안에도 들어 있음)

  // 캐릭터 1명 만들기: 모델 + 머리 위 라벨(말풍선 자리 + 닉네임)
  async function spawn(p, isMe) {
    const { root, body } = await createCharacter(toyById.get(p.toyId), p.color);
    root.position.set(p.x, p.y || 0, p.z);
    root.rotation.y = p.r || 0;

    // (display는 CSS2DRenderer가 매 프레임 덮어쓰므로 inline style 대신 CSS 클래스로 배치)
    const labelEl = document.createElement('div');
    labelEl.className = 'label-stack';
    const name = document.createElement('div');
    name.className = 'nameplate' + (isMe ? ' me' : '');
    name.textContent = p.nickname; // textContent: 닉네임에 HTML이 들어 있어도 글자로만 보임
    labelEl.appendChild(name);
    const label = new CSS2DObject(labelEl);
    label.center.set(0.5, 1); // 라벨의 아래쪽 가운데를 머리 위 점에 맞춤
    label.position.set(0, CHARACTER_HEIGHT + 0.25, 0);
    root.add(label);

    scene.add(root);
    return { root, body, labelEl, nameEl: name, bubbleEl: null, bubbleTimer: null,
             target: { x: p.x, y: p.y || 0, z: p.z, r: p.r || 0 }, speed: 0, walkTime: 0, vy: 0 };
  }

  // 캐릭터 지우기 (모델 + 라벨)
  function despawn(id) {
    const c = characters.get(id);
    if (!c) return;
    c.labelEl.remove();
    scene.remove(c.root);
    characters.delete(id);
  }

  // 같은 사람이 동시에 두 번 만들어지지 않게, 만드는 중인 id를 기억
  const spawning = new Map();
  function ensureCharacter(p) {
    if (characters.has(p.id) || spawning.has(p.id)) return;
    const isMe = p.id === selfId;
    const job = spawn(p, isMe).then((c) => {
      spawning.delete(p.id);
      if (!job.cancelled) {
        characters.set(p.id, c);
        if (isMe) self = c;
      } else {
        scene.remove(c.root);
        c.labelEl.remove();
      }
    });
    spawning.set(p.id, job);
  }

  // ===== 키보드 입력 (WASD / 방향키) =====
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (isTyping()) return;
    if (e.code === 'Space') e.preventDefault(); // 스페이스바로 화면이 스크롤되거나 버튼이 눌리지 않게
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // ===== 로블록스식 카메라: 우클릭 드래그 회전, 휠 확대/축소 =====
  const cam = { yaw: 0, pitch: 0.45, dist: 10 };
  const canvas = renderer.domElement;
  let dragging = false;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
    }
    if (isTyping()) document.activeElement.blur(); // 화면을 클릭하면 채팅 입력에서 빠져나옴
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    cam.yaw -= e.movementX * 0.005;
    cam.pitch = THREE.MathUtils.clamp(cam.pitch + e.movementY * 0.005, 0.05, 1.35);
  });
  const stopDrag = (e) => {
    if (e.button === 2 || e.type === 'pointercancel') dragging = false;
  };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = THREE.MathUtils.clamp(cam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 3, 25);
  }, { passive: false });

  // 창 크기가 바뀌면 화면 크기 맞추기
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ===== 내 캐릭터 이동 =====
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();
  let sendTimer = 0;
  let lastSent = null; // 마지막으로 서버에 보낸 위치 (null이면 아직 안 보냄 → 바로 보냄)

  function updateSelf(dt) {
    if (!self || self.riding) return; // 놀이기구를 타는 동안에는 직접 움직이지 않음
    // 카메라가 보는 방향 기준으로 앞/오른쪽 방향 계산 (높이는 무시)
    forward.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    right.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    move.set(0, 0, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(forward);
    if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(forward);
    if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);

    const pos = self.root.position;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(MOVE_SPEED * dt);
      pos.x += move.x;
      pos.z += move.z;
      resolveCollisions(pos);
      // 가는 방향을 바라보도록 부드럽게 회전
      const targetR = Math.atan2(move.x, move.z);
      self.root.rotation.y = lerpAngle(self.root.rotation.y, targetR, 1 - Math.exp(-15 * dt));
      self.speed = MOVE_SPEED;
    } else {
      self.speed = 0;
    }

    // 점프: 땅에 있을 때 스페이스바를 누르면 위로 튀어 오르고, 중력으로 다시 떨어짐
    const onGround = pos.y <= 0;
    if (onGround && keys.has('Space')) self.vy = JUMP_SPEED;
    if (!onGround || self.vy > 0) {
      self.vy -= GRAVITY * dt;
      pos.y = Math.max(0, pos.y + self.vy * dt);
      if (pos.y === 0) self.vy = 0;
    }

    // 1초에 15번, 실제로 움직였을 때만 서버로 위치 전송
    sendTimer += dt;
    if (sendTimer >= SEND_INTERVAL) {
      sendTimer = 0;
      const r = self.root.rotation.y;
      // (주의: 처음 값을 NaN으로 두면 비교가 항상 false가 되어 위치가 영영 전송되지 않음 → null로 시작)
      if (!lastSent || Math.abs(pos.x - lastSent.x) > 0.01 || Math.abs(pos.z - lastSent.z) > 0.01 ||
          Math.abs(pos.y - lastSent.y) > 0.01 || Math.abs(r - lastSent.r) > 0.02) {
        lastSent = { x: pos.x, y: pos.y, z: pos.z, r };
        onMove(pos.x, pos.z, r, pos.y);
      }
    }
  }

  // 맵 끝과 물체(원형 충돌 영역)를 통과하지 못하게 밀어냄
  function resolveCollisions(pos) {
    for (const c of map.colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const minD = c.r + PLAYER_RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 < minD * minD && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = c.x + (dx / d) * minD;
        pos.z = c.z + (dz / d) * minD;
      }
    }
    pos.x = THREE.MathUtils.clamp(pos.x, -MAP_LIMIT, MAP_LIMIT);
    pos.z = THREE.MathUtils.clamp(pos.z, -MAP_LIMIT, MAP_LIMIT);
  }

  // ===== 다른 유저: 받은 위치로 부드럽게 따라가기 (보간) =====
  function updateOthers(dt) {
    const k = 1 - Math.exp(-12 * dt);
    for (const [id, c] of characters) {
      if (id === selfId || c.riding) continue; // 탄 사람은 rides.js가 좌석에 붙여 줌
      const p = c.root.position;
      const dx = c.target.x - p.x, dz = c.target.z - p.z;
      // 너무 멀리 떨어져 있으면 바로 이동 (순간이동/재접속 등)
      if (dx * dx + dz * dz > 100) p.set(c.target.x, c.target.y, c.target.z);
      else { p.x += dx * k; p.z += dz * k; }
      p.y += (c.target.y - p.y) * Math.min(1, k * 1.6); // 점프 높이는 조금 더 빨리 따라감
      c.root.rotation.y = lerpAngle(c.root.rotation.y, c.target.r, k);
      c.speed = Math.hypot(dx, dz) > 0.05 ? MOVE_SPEED : 0;
    }
  }

  // 걷는 동안 통통 튀고 좌우로 뒤뚱거리는 장난감 느낌 애니메이션
  function animateWalk(dt) {
    for (const c of characters.values()) {
      const walking = c.speed > 0 && c.root.position.y < 0.01; // 공중에서는 걷기 흔들림 없음
      if (walking) c.walkTime += dt * 12;
      else c.walkTime = 0;
      const bob = walking ? Math.abs(Math.sin(c.walkTime)) * 0.12 : 0;
      c.body.position.y = THREE.MathUtils.lerp(c.body.position.y, bob, 0.5);
      c.body.rotation.z = walking ? Math.sin(c.walkTime) * 0.12 : c.body.rotation.z * 0.8;
    }
  }

  // 카메라를 내 캐릭터 뒤쪽 위에 두고 바라보게 함
  function updateCamera() {
    const t = self ? self.root.position : new THREE.Vector3(0, 0, 18);
    const cx = t.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist;
    const cz = t.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist;
    const cy = 1.2 + t.y * 0.5 + Math.sin(cam.pitch) * cam.dist; // 점프하면 카메라도 살짝 따라 올라감
    camera.position.set(cx, Math.max(cy, 0.5), cz);
    camera.lookAt(t.x, 1.2 + t.y * 0.5, t.z);
    // 햇빛(그림자 범위)도 내 캐릭터를 따라 이동
    sun.target.position.set(t.x, 0, t.z);
    sun.position.set(t.x + SUN_OFFSET.x, SUN_OFFSET.y, t.z + SUN_OFFSET.z);
  }

  // ===== 느린 컴퓨터 자동 대응 =====
  // 시작 후 몇 초 동안 FPS를 재서 너무 낮으면 1단계: 해상도 낮추기, 2단계: 그림자 끄기
  const perf = { frames: 0, time: 0, level: 0 };
  function autoQuality(dt) {
    if (perf.level >= 2) return;
    perf.frames++;
    perf.time += dt;
    if (perf.time < 4) return;
    const fps = perf.frames / perf.time;
    perf.frames = 0;
    perf.time = 0;
    if (fps >= 32) { perf.level = 2; return; } // 충분히 빠르면 더 이상 검사하지 않음
    perf.level++;
    if (perf.level === 1) {
      renderer.setPixelRatio(1);
    } else {
      renderer.shadowMap.enabled = false;
      scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    }
    console.info(`FPS ${fps.toFixed(0)} → 그래픽 품질 ${perf.level}단계 낮춤`);
  }

  // ===== 매 프레임 실행되는 게임 루프 =====
  const timer = new THREE.Timer(); // 프레임 사이 시간 계산용
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    autoQuality(dt);
    updateSelf(dt);
    updateOthers(dt);
    rides.update(characters, dt, handleDismount);
    animateWalk(dt);
    updatePrompt();
    updateCamera();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  });

  // 놀이기구에서 내렸을 때: 나라면 내린 위치를 바로 서버에 알림, 다른 사람이면 목표 위치도 맞춰 둠
  function handleDismount(id, c) {
    const p = c.root.position, r = c.root.rotation.y;
    if (id === selfId) {
      lastSent = { x: p.x, y: 0, z: p.z, r };
      onMove(p.x, p.z, r, 0);
    } else {
      c.target = { x: p.x, y: 0, z: p.z, r };
    }
  }

  // 내 캐릭터가 게시판 앞 구역 안에 있는지
  function nearBoard() {
    const p = self.root.position;
    return Math.hypot(p.x - BOARD.zone.x, p.z - BOARD.zone.z) < BOARD.zone.r;
  }

  // 화면 아래 안내 문구: 놀이기구 근처면 "Shift: 타기", 타는 중이면 "Shift: 내리기"
  let lastPrompt = null;
  function updatePrompt() {
    let text = null;
    if (self && nearBoard() && !(rides.available && rides.rideOf(selfId))) text = 'Shift: 게시판 보기';
    else if (self && rides.available) {
      const mine = rides.rideOf(selfId);
      if (mine) {
        if (mine.ride === 'slide') text = '슝~ 미끄럼틀 타는 중!';
        else if (mine.ride === 'seesaw' && rides.occupancy('seesaw').used < 2) text = '반대편에 친구가 타면 움직여요 · Shift: 내리기';
        else text = `${RIDE_NAMES[mine.ride]} 타는 중 · Shift: 내리기`;
      } else {
        const near = rides.nearestZone(self.root.position);
        if (near) {
          const o = rides.occupancy(near);
          text = o && o.used >= o.total
            ? `${RIDE_NAMES[near]}: 자리가 없어요 (${o.used}/${o.total})`
            : `Shift: ${RIDE_NAMES[near]} 타기${o ? ` (${o.used}/${o.total})` : ''}`;
        }
      }
    }
    if (text !== lastPrompt) {
      lastPrompt = text;
      if (onPrompt) onPrompt(text);
    }
  }

  // ===== play.js가 호출하는 함수들 =====
  return {
    // 입장 직후: 방에 있는 모든 사람 만들기 (나 포함)
    // 서버가 보낸 놀이기구 좌석 상태 반영
    setRides(state, serverNow) {
      rides.setState(state, serverNow);
    },
    // Shift를 눌렀을 때 할 일: 타고 있으면 내리기, 놀이기구 근처면 타기
    interact() {
      if (!self) return null;
      if (nearBoard() && !(rides.available && rides.rideOf(selfId))) return { type: 'board' };
      if (!rides.available) return null;
      if (rides.rideOf(selfId)) return { type: 'leave' };
      const near = rides.nearestZone(self.root.position);
      return near ? { type: 'join', ride: near } : null;
    },
    isRiding() {
      return !!(rides.available && rides.rideOf(selfId));
    },
    clearKey(code) {
      keys.delete(code);
    },
    // 게시판 창을 열 때: 누르고 있던 이동 키를 모두 뗀 것으로 처리 (창이 열린 채로 계속 걸어가지 않게)
    releaseKeys() {
      keys.clear();
    },
    setPlayers(list, myId) {
      selfId = myId;
      for (const p of list) ensureCharacter(p);
    },
    addPlayer(p) {
      ensureCharacter(p);
    },
    removePlayer(id) {
      const job = spawning.get(id);
      if (job) job.cancelled = true;
      despawn(id);
    },
    // 서버에서 받은 위치를 목표 위치로 저장 (내 위치는 내가 직접 움직이므로 무시)
    applyMoves(list, myId) {
      for (const m of list) {
        if (m.id === myId) continue;
        const c = characters.get(m.id);
        if (c) c.target = { x: m.x, y: m.y || 0, z: m.z, r: m.r };
      }
    },
    // 이모티콘 띄우기: 머리 위에 크게 떠올랐다가 사라짐 (말풍선과 같은 라벨 묶음 맨 위)
    showEmote(id, emoji) {
      const c = characters.get(id);
      if (!c) return;
      const el = document.createElement('div');
      el.className = 'emote';
      el.textContent = emoji;
      c.labelEl.insertBefore(el, c.labelEl.firstChild);
      setTimeout(() => el.remove(), EMOTE_MS);
    },
    // 말풍선 띄우기: 몇 초 뒤 사라짐. 새 채팅이 오면 이전 말풍선은 바꿈
    showBubble(id, text) {
      const c = characters.get(id);
      if (!c) return;
      if (c.bubbleEl) c.bubbleEl.remove();
      clearTimeout(c.bubbleTimer);
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text; // XSS 방지: 글자로만 표시
      c.labelEl.insertBefore(bubble, c.nameEl);
      c.bubbleEl = bubble;
      c.bubbleTimer = setTimeout(() => {
        bubble.classList.add('fade');
        setTimeout(() => {
          bubble.remove();
          if (c.bubbleEl === bubble) c.bubbleEl = null;
        }, 400);
      }, BUBBLE_MS);
    },
  };
}

// 각도를 가장 짧은 방향으로 보간 (359도 -> 1도로 갈 때 한 바퀴 돌지 않게)
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Blender로 만든 놀이터(playground.glb) 불러오기
// 충돌 영역: GLB 안에서 이름이 "COL_"로 시작하는 빈 물체(Empty)의 위치와 크기(scale.x = 반지름)를 사용
async function loadMap() {
  try {
    const gltf = await loadGLB('playground.glb');
    const group = gltf.scene;
    const colliders = [];
    group.updateMatrixWorld(true);
    const wp = new THREE.Vector3(), ws = new THREE.Vector3();
    // 맨 위 물체 이름(Ground, Playground, Cloud, COL_...)을 기준으로 처리
    for (const top of group.children) {
      if (top.name.startsWith('COL_')) {
        top.getWorldPosition(wp);
        top.getWorldScale(ws);
        colliders.push({ x: wp.x, z: wp.z, r: ws.x });
        continue;
      }
      const isGround = top.name.startsWith('Ground');
      const isCloud = top.name.startsWith('Cloud');
      top.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = !isGround && !isCloud; // 바닥은 그림자를 받기만, 구름은 그림자 없음
        o.receiveShadow = !isCloud;
      });
    }
    return { group, colliders };
  } catch (err) {
    console.warn('playground.glb를 불러오지 못해서 기본 맵을 사용해요:', err.message);
    return createMap();
  }
}

// 게시판 오브젝트(Blender로 만든 board.glb)를 놓고 충돌 영역을 추가
// 판이 옆으로 넓어서(약 2.6m) 동그란 충돌 영역 3개를 판 방향으로 나란히 놓음
async function addBoard(scene, colliders) {
  let obj;
  try {
    obj = (await loadGLB('board.glb')).scene;
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  } catch (err) {
    // 모델을 못 불러오면 갈색 판자로 대신 표시
    console.warn('board.glb를 불러오지 못해서 기본 판자로 표시해요:', err.message);
    obj = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 0.15), new THREE.MeshStandardMaterial({ color: 0xa0673a }));
    obj.position.y = 1.4;
    const g = new THREE.Group();
    g.add(obj);
    obj = g;
  }
  obj.position.set(BOARD.x, 0, BOARD.z);
  obj.rotation.y = BOARD.yaw;
  scene.add(obj);
  // 판의 가로 방향 = 모델의 x축을 yaw만큼 돌린 방향
  const ax = Math.cos(BOARD.yaw), az = -Math.sin(BOARD.yaw);
  for (const d of [-0.9, 0, 0.9]) colliders.push({ x: BOARD.x + ax * d, z: BOARD.z + az * d, r: 0.45 });
}

// 하늘 배경: 위에서 아래로 색이 옅어지는 그라데이션 (작은 캔버스 이미지로 만듦)
function makeSkyGradient() {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5fb4ff');
  grad.addColorStop(0.55, '#a6dcff');
  grad.addColorStop(1, '#e3f5ff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
