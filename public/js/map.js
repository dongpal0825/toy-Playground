// map.js: 놀이터 맵을 Three.js 기본 도형으로 만드는 파일 (잔디, 모래밭, 미끄럼틀, 그네, 시소, 나무, 울타리, 장난감 블록)
// colliders: 캐릭터가 통과하지 못하는 원형 영역 목록 { x, z, r }
import * as THREE from 'three';

// 자주 쓰는 재질(색) 만들기 함수
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

// 그림자를 드리우고 받도록 설정해서 그룹에 넣는 함수
function add(group, mesh, x = 0, y = 0, z = 0) {
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

export function createMap() {
  const group = new THREE.Group();
  const colliders = [];

  // ----- 바닥: 잔디 + 가운데 고무 바닥 + 산책길 -----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mat('#7ccf6b'));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const play = new THREE.Mesh(new THREE.CircleGeometry(16, 48), mat('#f2a65a'));
  play.rotation.x = -Math.PI / 2;
  play.position.y = 0.01;
  play.receiveShadow = true;
  group.add(play);

  const path = new THREE.Mesh(new THREE.PlaneGeometry(4, 14), mat('#e8dcc0'));
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.02, 22);
  path.receiveShadow = true;
  group.add(path);

  // ----- 모래밭 (나무 테두리) -----
  const sand = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.2, 32), mat('#f4dc9a'));
  add(group, sand, -9, 0.1, -6);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(4, 0.25, 8, 32), mat('#a0703c'));
  rim.rotation.x = -Math.PI / 2;
  add(group, rim, -9, 0.2, -6);
  // 모래성 (원뿔 + 원기둥)
  add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 0.8, 12), mat('#e9c97a')), -9, 0.6, -6);
  add(group, new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.7, 12), mat('#e9c97a')), -9, 1.35, -6);
  colliders.push({ x: -9, z: -6, r: 1 });

  // ----- 미끄럼틀 -----
  const slide = new THREE.Group();
  const red = mat('#ff5a5f'), yellow = mat('#ffd23f'), blue = mat('#3a86ff');
  for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
    add(slide, new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3, 8), blue), lx, 1.5, lz);
  }
  add(slide, new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 2.2), yellow), 0, 3, 0);           // 꼭대기 발판
  add(slide, new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.2, 4), red), 0, 4.2, 0).rotation.y = Math.PI / 4; // 지붕
  const chute = add(slide, new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 5), red), 0, 1.6, 3.2); // 미끄러지는 판
  chute.rotation.x = 0.62;
  for (let i = 0; i < 6; i++) {                                                                // 사다리
    add(slide, new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.2), yellow), 0, 0.45 + i * 0.45, -1.4);
  }
  slide.position.set(8, 0, -7);
  slide.rotation.y = -0.5;
  group.add(slide);
  colliders.push({ x: 8, z: -7, r: 1.8 });

  // ----- 그네 -----
  const swing = new THREE.Group();
  const frame = mat('#3a86ff');
  for (const sx of [-2.5, 2.5]) {
    add(swing, new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.6, 8), frame), sx, 1.7, -0.8).rotation.x = 0.25;
    add(swing, new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.6, 8), frame), sx, 1.7, 0.8).rotation.x = -0.25;
  }
  add(swing, new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5.2, 8), frame), 0, 3.4, 0).rotation.z = Math.PI / 2;
  for (const seatX of [-1.2, 1.2]) {
    for (const rx of [-0.35, 0.35]) {
      add(swing, new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 6), mat('#555')), seatX + rx, 2.1, 0);
    }
    add(swing, new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.45), mat('#ff9f1c')), seatX, 0.8, 0);
  }
  swing.position.set(9, 0, 7);
  swing.rotation.y = 0.4;
  group.add(swing);
  colliders.push({ x: 9 - 2.3, z: 7 + 1, r: 0.6 }, { x: 9 + 2.3, z: 7 - 1, r: 0.6 });

  // ----- 시소 -----
  const seesaw = new THREE.Group();
  add(seesaw, new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.7, 12), mat('#b388ff')), 0, 0.35, 0);
  const board = add(seesaw, new THREE.Mesh(new THREE.BoxGeometry(5, 0.15, 0.5), mat('#4caf50')), 0, 0.8, 0);
  board.rotation.z = 0.15;
  seesaw.position.set(-8, 0, 7);
  seesaw.rotation.y = -0.3;
  group.add(seesaw);
  colliders.push({ x: -8, z: 7, r: 0.7 });

  // ----- 큰 장난감 블록 (쌓아 놓은 모양) -----
  const blocks = [
    ['#ff5a5f', 0, 0.75, 0, 1.5], ['#3a86ff', 1.6, 0.75, 0.2, 1.5], ['#ffd23f', 0.8, 2.15, 0.1, 1.3],
  ];
  for (const [c, bx, by, bz, s] of blocks) {
    const b = add(group, new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat(c)), bx - 1, by, bz - 12);
    b.rotation.y = bx * 0.3;
  }
  colliders.push({ x: -1, z: -12, r: 1.2 }, { x: 0.6, z: -11.8, r: 1.2 });

  // ----- 벤치 -----
  for (const [bx, bz, ry] of [[-4, 18, 0], [4, 18, 0]]) {
    const bench = new THREE.Group();
    add(bench, new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.6), mat('#a0703c')), 0, 0.5, 0);
    add(bench, new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.1), mat('#a0703c')), 0, 0.85, -0.3);
    for (const lx of [-1, 1]) add(bench, new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), mat('#555')), lx, 0.25, 0);
    bench.position.set(bx, 0, bz);
    bench.rotation.y = ry;
    group.add(bench);
    colliders.push({ x: bx - 0.7, z: bz, r: 0.5 }, { x: bx + 0.7, z: bz, r: 0.5 });
  }

  // ----- 나무 (맵 가장자리에 빙 둘러서) -----
  const trunk = mat('#8d6e63');
  const leaves = [mat('#3f9b4f'), mat('#58b368'), mat('#2e7d32')];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.2;
    const d = 22 + (i % 3) * 2.2;
    const tx = Math.cos(a) * d, tz = Math.sin(a) * d;
    if (Math.abs(tx) < 4 && tz > 0) continue; // 입구 길은 비워 둠
    const h = 1.6 + (i % 4) * 0.3;
    add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, h, 8), trunk), tx, h / 2, tz);
    if (i % 2 === 0) {
      add(group, new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 10), leaves[i % 3]), tx, h + 1, tz);
    } else {
      add(group, new THREE.Mesh(new THREE.ConeGeometry(1.4, 3, 10), leaves[i % 3]), tx, h + 1.3, tz);
    }
    colliders.push({ x: tx, z: tz, r: 0.6 });
  }

  // ----- 울타리 (맵 끝을 알려 주는 낮은 말뚝) -----
  const fence = mat('#ffffff');
  for (let i = -29; i <= 29; i += 2) {
    for (const [fx, fz] of [[i, -29.5], [i, 29.5], [-29.5, i], [29.5, i]]) {
      if (fz === 29.5 && Math.abs(fx) < 3) continue; // 입구
      add(group, new THREE.Mesh(new THREE.BoxGeometry(0.25, 1, 0.25), fence), fx, 0.5, fz);
    }
  }

  return { group, colliders };
}
