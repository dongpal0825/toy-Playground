// characters.js: 장난감 캐릭터 3D 모델을 만드는 파일
// public/models/ 의 GLB(Blender로 제작)를 먼저 불러오고, 없으면 기본 도형으로 만든 임시 모델을 사용
// 색상 변형: GLB 안에서 이름이 "Body"로 시작하는 재질만 유저가 고른 색으로 바꿈
import * as THREE from 'three';
import { loadGLB } from './loader.js';

export const CHARACTER_HEIGHT = 1.7; // 닉네임/말풍선을 띄울 높이

const gltfCache = new Map(); // 파일 이름 -> Promise<gltf 또는 null> (같은 모델을 여러 번 받지 않게)

// GLB 파일을 한 번만 불러오고 결과를 저장
function loadModel(file) {
  if (!gltfCache.has(file)) {
    gltfCache.set(file, loadGLB(file).catch(() => null));
  }
  return gltfCache.get(file);
}

// 캐릭터 만들기: { root, body } 를 돌려줌. root는 위치/회전용, body는 걷기 흔들림용
export async function createCharacter(toy, color) {
  const root = new THREE.Group();
  let body = null;

  const gltf = toy && toy.model ? await loadModel(toy.model) : null;
  if (gltf) {
    body = gltf.scene.clone(true);
    body.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      // 재질은 복사해서 바꿈 (다른 유저 캐릭터 색이 같이 바뀌지 않게)
      if (o.material && o.material.name && o.material.name.startsWith('Body')) {
        o.material = o.material.clone();
        o.material.color.set(color);
      }
    });
  } else {
    body = buildPlaceholder(toy ? toy.id : 1, color);
  }

  root.add(body);
  return { root, body };
}

// ===== GLB가 없을 때 쓰는 임시 모델 (기본 도형 조합) =====
// 모든 모델은 +Z 방향이 앞쪽
function buildPlaceholder(toyId, color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ color: '#222222', roughness: 0.4 });
  const orange = new THREE.MeshStandardMaterial({ color: '#ff9f1c', roughness: 0.5 });
  const gray = new THREE.MeshStandardMaterial({ color: '#9e9e9e', roughness: 0.4, metalness: 0.3 });

  const part = (geo, m, x, y, z) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const eyes = (y, z, spread = 0.13, size = 0.06) => {
    part(new THREE.SphereGeometry(size, 8, 8), black, -spread, y, z);
    part(new THREE.SphereGeometry(size, 8, 8), black, spread, y, z);
  };

  switch (toyId) {
    case 1: { // 공룡: 통통한 몸통 + 큰 머리 + 꼬리 + 등 가시
      part(new THREE.CapsuleGeometry(0.42, 0.5, 4, 12), bodyMat, 0, 0.75, 0);
      part(new THREE.BoxGeometry(0.6, 0.5, 0.7), bodyMat, 0, 1.4, 0.2);
      eyes(1.52, 0.56);
      const tail = part(new THREE.ConeGeometry(0.28, 0.9, 10), bodyMat, 0, 0.55, -0.6);
      tail.rotation.x = -Math.PI / 2 - 0.4;
      for (let i = 0; i < 4; i++) part(new THREE.ConeGeometry(0.1, 0.22, 4), white, 0, 1.25 - i * 0.2, -0.32 - i * 0.08);
      for (const fx of [-0.2, 0.2]) part(new THREE.CylinderGeometry(0.13, 0.15, 0.3, 8), bodyMat, fx, 0.15, 0.05);
      break;
    }
    case 2: { // 곰인형: 동그란 몸 + 동그란 머리 + 귀 + 주둥이
      part(new THREE.SphereGeometry(0.48, 16, 12), bodyMat, 0, 0.6, 0);
      part(new THREE.SphereGeometry(0.38, 16, 12), bodyMat, 0, 1.3, 0);
      for (const ex of [-0.28, 0.28]) part(new THREE.SphereGeometry(0.13, 10, 8), bodyMat, ex, 1.62, 0);
      part(new THREE.SphereGeometry(0.15, 10, 8), white, 0, 1.24, 0.32);
      part(new THREE.SphereGeometry(0.05, 8, 8), black, 0, 1.28, 0.46);
      eyes(1.4, 0.32, 0.13, 0.05);
      for (const ax of [-0.45, 0.45]) part(new THREE.SphereGeometry(0.16, 10, 8), bodyMat, ax, 0.75, 0.1);
      for (const fx of [-0.22, 0.22]) part(new THREE.SphereGeometry(0.17, 10, 8), bodyMat, fx, 0.15, 0.12);
      break;
    }
    case 3: { // 로봇: 네모난 몸 + 네모 머리 + 안테나 + 팔
      part(new THREE.BoxGeometry(0.75, 0.75, 0.5), bodyMat, 0, 0.75, 0);
      part(new THREE.BoxGeometry(0.55, 0.45, 0.45), gray, 0, 1.38, 0);
      part(new THREE.BoxGeometry(0.4, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: '#00e5ff', emissive: '#00bcd4' }), 0, 1.42, 0.23);
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), gray, 0, 1.75, 0);
      part(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshStandardMaterial({ color: '#ff5a5f', emissive: '#ff1744' }), 0, 1.92, 0);
      for (const ax of [-0.48, 0.48]) part(new THREE.BoxGeometry(0.16, 0.55, 0.16), gray, ax, 0.75, 0);
      for (const fx of [-0.2, 0.2]) part(new THREE.BoxGeometry(0.2, 0.38, 0.22), gray, fx, 0.19, 0);
      part(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 12), gray, 0, 0.85, 0.27).rotation.x = Math.PI / 2; // 가슴 태엽
      break;
    }
    case 4: { // 고무 오리: 동그란 몸 + 머리 + 주황 부리
      part(new THREE.SphereGeometry(0.5, 16, 12), bodyMat, 0, 0.5, 0).scale.set(1, 0.8, 1.2);
      part(new THREE.SphereGeometry(0.32, 16, 12), bodyMat, 0, 1.05, 0.25);
      part(new THREE.BoxGeometry(0.3, 0.08, 0.22), orange, 0, 1.0, 0.6);
      eyes(1.15, 0.52, 0.13, 0.05);
      part(new THREE.ConeGeometry(0.18, 0.35, 8), bodyMat, 0, 0.75, -0.55).rotation.x = -1.2; // 꼬리
      break;
    }
    default: { // 펭귄: 길쭉한 몸 + 흰 배 + 주황 발/부리
      part(new THREE.CapsuleGeometry(0.4, 0.7, 4, 12), bodyMat, 0, 0.8, 0);
      part(new THREE.SphereGeometry(0.34, 16, 12), white, 0, 0.72, 0.14).scale.set(0.9, 1.4, 0.7);
      part(new THREE.ConeGeometry(0.08, 0.2, 8), orange, 0, 1.25, 0.44).rotation.x = Math.PI / 2;
      eyes(1.38, 0.34, 0.12, 0.05);
      for (const ax of [-0.42, 0.42]) part(new THREE.BoxGeometry(0.08, 0.5, 0.25), bodyMat, ax, 0.8, 0).rotation.z = ax > 0 ? 0.25 : -0.25;
      for (const fx of [-0.15, 0.15]) part(new THREE.BoxGeometry(0.18, 0.06, 0.28), orange, fx, 0.03, 0.12);
      break;
    }
  }
  return g;
}
