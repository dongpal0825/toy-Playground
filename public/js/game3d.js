// game3d.js: 3D 놀이터 화면. 장면/조명, 내 캐릭터 이동(WASD), 로블록스식 카메라, 다른 유저 표시, 닉네임/말풍선
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createMap } from './map.js';
import { createCharacter, CHARACTER_HEIGHT } from './characters.js';

const MOVE_SPEED = 5;        // 초당 이동 거리 (m)
const MAP_LIMIT = 28;        // 서버의 rooms.js와 같은 값
const PLAYER_RADIUS = 0.45;  // 캐릭터 충돌 반지름
const SEND_INTERVAL = 1 / 15; // 위치 보내는 간격 (1초에 15번)
const BUBBLE_MS = 5000;      // 말풍선이 떠 있는 시간

export async function createGame({ container, me, toys, isTyping, onMove }) {
  // WebGL을 쓸 수 없으면 에러를 던져서 play.js가 "채팅만 모드"로 전환하게 함
  const testCanvas = document.createElement('canvas');
  if (!testCanvas.getContext('webgl2') && !testCanvas.getContext('webgl')) {
    throw new Error('WebGL을 지원하지 않는 브라우저');
  }

  // ===== 렌더러, 장면, 카메라 =====
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // 닉네임/말풍선용 HTML 레이어 (3D 위치를 따라다니는 div)
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8fd3ff');
  scene.fog = new THREE.Fog('#8fd3ff', 45, 90);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);

  // 조명: 하늘빛 + 햇빛(그림자)
  scene.add(new THREE.HemisphereLight('#ffffff', '#7ccf6b', 1.4));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(15, 25, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 80 });
  scene.add(sun);

  // 놀이터 맵
  const map = createMap();
  scene.add(map.group);

  const toyById = new Map(toys.map((t) => [t.id, t]));

  // ===== 캐릭터 관리 =====
  // 소켓 id -> { root, body, label, bubbleEl, target, speed, walkTime }
  const characters = new Map();
  let selfId = null;
  let self = null; // 내 캐릭터 (characters 안에도 들어 있음)

  // 캐릭터 1명 만들기: 모델 + 머리 위 라벨(말풍선 자리 + 닉네임)
  async function spawn(p, isMe) {
    const { root, body } = await createCharacter(toyById.get(p.toyId), p.color);
    root.position.set(p.x, 0, p.z);
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
             target: { x: p.x, z: p.z, r: p.r || 0 }, speed: 0, walkTime: 0 };
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
  let lastSent = { x: NaN, z: NaN, r: NaN };

  function updateSelf(dt) {
    if (!self) return;
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

    // 1초에 15번, 실제로 움직였을 때만 서버로 위치 전송
    sendTimer += dt;
    if (sendTimer >= SEND_INTERVAL) {
      sendTimer = 0;
      const r = self.root.rotation.y;
      if (Math.abs(pos.x - lastSent.x) > 0.01 || Math.abs(pos.z - lastSent.z) > 0.01 || Math.abs(r - lastSent.r) > 0.02) {
        lastSent = { x: pos.x, z: pos.z, r };
        onMove(pos.x, pos.z, r);
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
      if (id === selfId) continue;
      const p = c.root.position;
      const dx = c.target.x - p.x, dz = c.target.z - p.z;
      // 너무 멀리 떨어져 있으면 바로 이동 (순간이동/재접속 등)
      if (dx * dx + dz * dz > 100) p.set(c.target.x, 0, c.target.z);
      else { p.x += dx * k; p.z += dz * k; }
      c.root.rotation.y = lerpAngle(c.root.rotation.y, c.target.r, k);
      c.speed = Math.hypot(dx, dz) > 0.05 ? MOVE_SPEED : 0;
    }
  }

  // 걷는 동안 통통 튀고 좌우로 뒤뚱거리는 장난감 느낌 애니메이션
  function animateWalk(dt) {
    for (const c of characters.values()) {
      if (c.speed > 0) c.walkTime += dt * 12;
      else c.walkTime = 0;
      const bob = c.speed > 0 ? Math.abs(Math.sin(c.walkTime)) * 0.12 : 0;
      c.body.position.y = THREE.MathUtils.lerp(c.body.position.y, bob, 0.5);
      c.body.rotation.z = c.speed > 0 ? Math.sin(c.walkTime) * 0.12 : c.body.rotation.z * 0.8;
    }
  }

  // 카메라를 내 캐릭터 뒤쪽 위에 두고 바라보게 함
  function updateCamera() {
    const t = self ? self.root.position : new THREE.Vector3(0, 0, 18);
    const cx = t.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist;
    const cz = t.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist;
    const cy = 1.2 + Math.sin(cam.pitch) * cam.dist;
    camera.position.set(cx, Math.max(cy, 0.5), cz);
    camera.lookAt(t.x, 1.2, t.z);
  }

  // ===== 매 프레임 실행되는 게임 루프 =====
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    updateSelf(dt);
    updateOthers(dt);
    animateWalk(dt);
    updateCamera();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  });

  // ===== play.js가 호출하는 함수들 =====
  return {
    // 입장 직후: 방에 있는 모든 사람 만들기 (나 포함)
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
        if (c) c.target = { x: m.x, z: m.z, r: m.r };
      }
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
