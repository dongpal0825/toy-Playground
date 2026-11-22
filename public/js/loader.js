// loader.js: 3D 모델(GLB) 불러오기 공통 설정. Draco 압축 해제기 연결 + 로딩 진행률 표시
// 놀이터 맵과 캐릭터 파일은 Blender에서 Draco로 압축해서 내보내므로, 이 로더로 불러와야 함
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// Draco 압축 해제기 (three.js에 들어 있는 파일을 /vendor/three에서 제공, 외부 CDN 사용 안 함)
const draco = new DRACOLoader();
draco.setDecoderPath('/vendor/three/examples/jsm/libs/draco/gltf/');

export const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(draco);

// 모델 파일 주소: 서버가 알려 준 버전 번호를 붙여서, 모델이 바뀌었을 때만 새로 받게 함 (브라우저 캐시 활용)
let assetVersion = '';
export function setAssetVersion(v) {
  assetVersion = v;
}
export function modelUrl(file) {
  return '/models/' + file + (assetVersion ? '?v=' + assetVersion : '');
}

// ===== 로딩 진행률 (화면의 #loading 표시) =====
const progress = new Map(); // 파일 주소 -> { loaded, total }
let onChange = null;
export function onLoadingProgress(fn) {
  onChange = fn;
}
function report() {
  let loaded = 0, total = 0;
  for (const p of progress.values()) {
    loaded += p.loaded;
    total += p.total || p.loaded;
  }
  if (onChange) onChange(total ? loaded / total : 0);
}

// GLB 하나를 불러오는 함수 (받은 크기를 진행률에 반영)
export function loadGLB(file) {
  const url = modelUrl(file);
  progress.set(url, { loaded: 0, total: 0 });
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf) => {
        const p = progress.get(url);
        p.loaded = p.total = Math.max(p.total, p.loaded, 1);
        report();
        resolve(gltf);
      },
      (e) => {
        progress.set(url, { loaded: e.loaded, total: e.lengthComputable ? e.total : 0 });
        report();
      },
      (err) => {
        progress.delete(url);
        report();
        reject(err);
      }
    );
  });
}
