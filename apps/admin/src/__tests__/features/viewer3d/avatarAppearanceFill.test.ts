import {
  AVATAR_SOURCE_FACE_OBSERVED,
  AVATAR_SOURCE_FACE_UNOBSERVED,
  AVATAR_SOURCE_INTERPOLATED,
  AVATAR_SOURCE_OBSERVED,
  AVATAR_SOURCE_UNOBSERVED,
  AVATAR_WAIST_REST_Y,
} from '@/features/viewer3d/people/avatarAppearance';
import {
  avatarFillGridSize,
  avatarUvPartMapForScene,
  buildAvatarUvPartMap,
  fillAvatarAlbedo,
  maskUnfilledAvatarAlbedo,
  type AvatarFillFacePolicy,
  type AvatarUvPartMap,
} from '@/features/viewer3d/people/avatarAppearanceFill';
import { ensureAvatarMeshUv } from '@/features/viewer3d/people/avatarMesh';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';

// 미관측 표시 채우기(S15P31A101-742). 합성 사각형 UV 섬과 합성 dense 리그만 쓴다(사람 사진·실제 MHR 자산 아님).

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
  readFileSync(path: string): Uint8Array;
};
const cwd = (Reflect.get(globalThis, 'process') as { cwd(): string }).cwd();

type Rgb = readonly [number, number, number];
const RED: Rgb = [200, 40, 30];
const BLUE: Rgb = [30, 60, 190];
const GREEN: Rgb = [40, 180, 70];

interface Quad {
  uv: [number, number, number, number]; // u0, v0, u1, v1 (glTF 상단 원점)
  x: [number, number];
  y: [number, number];
}

/** 사각형마다 정점 4개(다른 사각형과 인덱스·UV 를 나누지 않음 → 섬 하나씩). 위치가 같은 정점은 이음매로 이어진다. */
function quadGeometry(quads: readonly Quad[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  quads.forEach((q, i) => {
    const [u0, v0, u1, v1] = q.uv;
    const [x0, x1] = q.x;
    const [y0, y1] = q.y;
    // v 가 작을수록 위(높은 y).
    pos.push(x0, y1, 0, x1, y1, 0, x1, y0, 0, x0, y0, 0);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    const b = i * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

// A: 상체(허리 위), B: 팔(허리 위, A 와 x=1 이음매 공유), C: 다리(허리 아래), D: 떨어진 허리 아래 조각.
// 실제 아틀라스처럼 섬 사이에 빈칸(0.01)을 둔다.
const QUADS: Quad[] = [
  { uv: [0.01, 0.01, 0.49, 0.49], x: [0, 1], y: [1.0, 1.6] },
  { uv: [0.51, 0.01, 0.99, 0.49], x: [1, 2], y: [1.0, 1.6] },
  { uv: [0.01, 0.51, 0.49, 0.99], x: [0, 1], y: [0.1, 0.7] },
  { uv: [0.51, 0.51, 0.99, 0.99], x: [5, 6], y: [0.1, 0.7] },
];

const SIZE = 64;

function blankImage(size = SIZE) {
  return {
    albedo: new Uint8Array(size * size * 4),
    source: new Uint8Array(size * size * 4),
  };
}

function put(
  img: { albedo: Uint8Array; source: Uint8Array },
  size: number,
  x: number,
  y: number,
  code: number,
  rgb: Rgb = [0, 0, 0],
) {
  const o = (y * size + x) * 4;
  img.albedo[o] = rgb[0];
  img.albedo[o + 1] = rgb[1];
  img.albedo[o + 2] = rgb[2];
  img.albedo[o + 3] = 255;
  img.source[o] = code;
  img.source[o + 1] = code;
  img.source[o + 2] = code;
  img.source[o + 3] = 255;
}

function rect(
  img: { albedo: Uint8Array; source: Uint8Array },
  size: number,
  [x0, y0, x1, y1]: [number, number, number, number],
  code: number | ((x: number, y: number) => number),
  rgb: Rgb | ((x: number, y: number) => Rgb) = [0, 0, 0],
) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      put(
        img,
        size,
        x,
        y,
        typeof code === 'number' ? code : code(x, y),
        typeof rgb === 'function' ? rgb(x, y) : rgb,
      );
    }
  }
}

function fill(
  img: { albedo: Uint8Array; source: Uint8Array },
  partMap: AvatarUvPartMap | null,
  facePolicy: AvatarFillFacePolicy = 'OBSERVED',
  size = SIZE,
) {
  return fillAvatarAlbedo({
    width: size,
    height: size,
    albedo: img.albedo,
    source: img.source,
    sourceWidth: size,
    sourceHeight: size,
    facePolicy,
    partMap,
  });
}

function rgbaAt(data: Uint8Array, size: number, x: number, y: number) {
  const o = (y * size + x) * 4;
  return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!] as const;
}

function expectNear(actual: readonly number[], expected: Rgb, tol = 3) {
  for (let c = 0; c < 3; c++) expect(Math.abs(actual[c]! - expected[c])).toBeLessThanOrEqual(tol);
}

const partMapOf = () =>
  buildAvatarUvPartMap([quadGeometry(QUADS)], SIZE, SIZE, AVATAR_WAIST_REST_Y);

describe('UV 부위 지도(메시 TEXCOORD_0·바인드 높이)', () => {
  it('사각형 섬마다 부위를 나누고, 위치가 같은 정점으로 이어진 섬만 인접으로 본다', () => {
    const map = partMapOf();
    const at = (u: number, v: number) =>
      map.part[Math.floor(v * SIZE) * SIZE + Math.floor(u * SIZE)]!;
    const a = at(0.25, 0.25);
    const b = at(0.75, 0.25);
    const c = at(0.25, 0.75);
    const d = at(0.75, 0.75);
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect([a, b, c, d].every((p) => p >= 0)).toBe(true);
    expect(map.partBand[a]).toBe(0);
    expect(map.partBand[b]).toBe(0);
    expect(map.partBand[c]).toBe(1);
    expect(map.partBand[d]).toBe(1);
    expect(map.adjacency[a]).toContain(b);
    expect(map.adjacency[b]).toContain(a);
    expect(map.adjacency[c]).not.toContain(a);
    expect(map.adjacency[d]).toEqual([]);
  });
});

describe('표시용 albedo 채우기(-742)', () => {
  it('관측(2)·보간(1) 텍셀은 원래 색 그대로(감쇠 없음) 알파 255 로 둔다', () => {
    const img = blankImage();
    rect(img, SIZE, [0, 0, 16, 32], AVATAR_SOURCE_OBSERVED, RED);
    rect(img, SIZE, [16, 0, 24, 32], AVATAR_SOURCE_INTERPOLATED, GREEN);
    const { data } = fill(img, partMapOf());
    expect(rgbaAt(data, SIZE, 3, 3)).toEqual([...RED, 255]);
    expect(rgbaAt(data, SIZE, 20, 10)).toEqual([...GREEN, 255]);
  });

  it('미관측(0)은 같은 섬의 관측 색으로 채우고 다른 섬 색은 섞지 않는다', () => {
    const img = blankImage();
    // A 왼쪽 절반만 빨강 관측, C 왼쪽 절반만 파랑 관측. 나머지는 미관측(0, 검정).
    rect(img, SIZE, [0, 0, 16, 32], AVATAR_SOURCE_OBSERVED, RED);
    rect(img, SIZE, [0, 32, 16, 64], AVATAR_SOURCE_OBSERVED, BLUE);
    const { data, stats } = fill(img, partMapOf());
    // A 의 미관측 오른쪽 끝(섬 경계 바로 안)도 빨강이고, 바로 아래 C 의 파랑이 섞이지 않는다.
    expectNear(rgbaAt(data, SIZE, 30, 30), RED);
    expect(rgbaAt(data, SIZE, 30, 30)[3]).toBe(255);
    expectNear(rgbaAt(data, SIZE, 30, 33), BLUE);
    expect(stats.seededParts).toBe(2);
  });

  it('관측이 없는 부위는 이음매로 붙은 인접 부위 색, 그것도 없으면 같은 상하 관측 색으로 채운다', () => {
    const img = blankImage();
    rect(img, SIZE, [0, 0, 16, 32], AVATAR_SOURCE_OBSERVED, RED);
    rect(img, SIZE, [0, 32, 16, 64], AVATAR_SOURCE_OBSERVED, BLUE);
    const { data, stats } = fill(img, partMapOf());
    // B(팔): 관측 0 → 이음매로 붙은 A(빨강). 다른 섬 C(파랑)가 아니다.
    expectNear(rgbaAt(data, SIZE, 48, 16), RED);
    // D(떨어진 허리 아래 조각): 인접 없음 → 허리 아래 관측 색(파랑).
    expectNear(rgbaAt(data, SIZE, 48, 48), BLUE);
    expect(stats.borrowedParts).toBe(2);
    expect(stats.emptyParts).toBe(0);
  });

  it('관측이 하나도 없으면 알파 0 으로 두어 셰이더가 기본 재질 색을 쓴다', () => {
    const img = blankImage();
    const { data, stats } = fill(img, partMapOf());
    expect(rgbaAt(data, SIZE, 10, 10)[3]).toBe(0);
    expect(rgbaAt(data, SIZE, 48, 48)[3]).toBe(0);
    expect(stats.emptyParts).toBeGreaterThan(0);
  });

  it('부위 지도가 없으면 텍스처 전체를 한 부위로 보고 관측 색으로 채운다', () => {
    const img = blankImage();
    rect(img, SIZE, [0, 0, 16, 16], AVATAR_SOURCE_OBSERVED, GREEN);
    const { data } = fill(img, null);
    expectNear(rgbaAt(data, SIZE, 60, 60), GREEN);
    expect(rgbaAt(data, SIZE, 60, 60)[3]).toBe(255);
  });

  it('얼굴 미관측(128)은 관측 얼굴(130) 평균 단색으로 채우고 얼굴 관측 텍셀은 바꾸지 않는다', () => {
    const img = blankImage();
    const SKIN_A: Rgb = [220, 170, 140];
    const SKIN_B: Rgb = [120, 80, 60];
    // A 안 위쪽: 130 체커(이목구비 흉내), 그 옆 128, 아래쪽 몸 관측 빨강.
    rect(img, SIZE, [2, 2, 12, 12], AVATAR_SOURCE_FACE_OBSERVED, (x, y) =>
      (x + y) % 2 ? SKIN_A : SKIN_B,
    );
    rect(img, SIZE, [12, 2, 30, 12], AVATAR_SOURCE_FACE_UNOBSERVED);
    rect(img, SIZE, [0, 16, 32, 32], AVATAR_SOURCE_OBSERVED, RED);
    const { data, skinRgb } = fill(img, partMapOf(), 'OBSERVED');
    const mean: Rgb = [170, 125, 100];
    expect(skinRgb).toEqual(mean);
    // 128 텍셀은 모두 같은 색(단색, 이목구비 없음).
    const first = rgbaAt(data, SIZE, 12, 2);
    for (let y = 2; y < 12; y++) {
      for (let x = 12; x < 30; x++) expect(rgbaAt(data, SIZE, x, y)).toEqual(first);
    }
    expect(first).toEqual([...mean, 255]);
    // 130 텍셀은 원래 색(face_policy 처리는 셰이더 몫).
    expect(rgbaAt(data, SIZE, 3, 2)).toEqual([...SKIN_A, 255]);
    expect(rgbaAt(data, SIZE, 2, 2)).toEqual([...SKIN_B, 255]);
  });

  it('EXCLUDED 이거나 관측 얼굴이 없으면 같은 섬의 목(얼굴 경계 근처 몸 관측) 단색, 그것도 없으면 알파 0', () => {
    const img = blankImage();
    const NECK: Rgb = [190, 150, 120];
    rect(img, SIZE, [2, 2, 12, 12], AVATAR_SOURCE_FACE_OBSERVED, [250, 0, 250]);
    rect(img, SIZE, [12, 2, 30, 12], AVATAR_SOURCE_FACE_UNOBSERVED);
    rect(img, SIZE, [0, 12, 32, 14], AVATAR_SOURCE_OBSERVED, NECK);
    rect(img, SIZE, [0, 14, 32, 32], AVATAR_SOURCE_OBSERVED, RED);
    const excluded = fill(img, partMapOf(), 'EXCLUDED');
    // 130 색(자홍)은 쓰지 않는다. 얼굴 경계 2칸 안 몸 관측(목 2줄)의 평균이다.
    expect(excluded.skinRgb).toEqual(NECK);
    expect(rgbaAt(excluded.data, SIZE, 20, 5)).toEqual([...NECK, 255]);

    const noBody = blankImage();
    rect(noBody, SIZE, [12, 2, 30, 12], AVATAR_SOURCE_FACE_UNOBSERVED);
    expect(rgbaAt(fill(noBody, partMapOf(), 'OBSERVED').data, SIZE, 20, 5)[3]).toBe(0);
  });

  it('채우기 실패 대비 마스크는 관측·보간·얼굴 관측만 알파 255 로 둔다', () => {
    const img = blankImage(4);
    put(img, 4, 0, 0, AVATAR_SOURCE_OBSERVED, RED);
    put(img, 4, 1, 0, AVATAR_SOURCE_INTERPOLATED, RED);
    put(img, 4, 2, 0, AVATAR_SOURCE_FACE_OBSERVED, RED);
    put(img, 4, 3, 0, AVATAR_SOURCE_FACE_UNOBSERVED, RED);
    put(img, 4, 0, 1, AVATAR_SOURCE_UNOBSERVED, RED);
    const data = maskUnfilledAvatarAlbedo({
      width: 4,
      height: 4,
      albedo: img.albedo,
      source: img.source,
      sourceWidth: 4,
      sourceHeight: 4,
      facePolicy: 'OBSERVED',
      partMap: null,
    });
    expect([0, 1, 2, 3, 4].map((i) => data[i * 4 + 3])).toEqual([255, 255, 255, 0, 0]);
  });
});

describe('빈 픽셀·희소 관측(-755)', () => {
  it('관측·보간인데 RGB 가 모두 3 이하인 텍셀은 빈 픽셀로 보고 같은 부위 관측 색으로 채운다(검정 점 없음)', () => {
    const img = blankImage();
    // A 전체가 관측(2)이지만 격자 선(4칸마다 한 줄)만 빨강이고 나머지는 워커가 적은 RGB 0(실자산의 철망 무늬).
    rect(img, SIZE, [0, 0, 32, 32], AVATAR_SOURCE_OBSERVED, (x, y) =>
      x % 4 === 0 || y % 4 === 0 ? RED : [0, 0, 0],
    );
    rect(img, SIZE, [0, 32, 32, 64], AVATAR_SOURCE_INTERPOLATED, (x, y) =>
      (x + y) % 3 === 0 ? BLUE : [2, 1, 3],
    );
    const { data, stats } = fill(img, partMapOf());
    for (let y = 1; y < 31; y++) {
      for (let x = 1; x < 31; x++) {
        expectNear(rgbaAt(data, SIZE, x, y), RED);
        expect(rgbaAt(data, SIZE, x, y)[3]).toBe(255);
      }
    }
    expectNear(rgbaAt(data, SIZE, 10, 41), BLUE);
    let expectedVoid = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (!(x % 4 === 0 || y % 4 === 0)) expectedVoid++;
        if ((x + y + 32) % 3 !== 0) expectedVoid++;
      }
    }
    expect(stats.voidTexels).toBe(expectedVoid);
  });

  it('빈 얼굴 관측(130) 텍셀은 이웃 관측 얼굴 평균으로, 이웃이 없으면 피부 단색으로 채우고 이목구비를 만들지 않는다', () => {
    const img = blankImage();
    const SKIN: Rgb = [200, 160, 130];
    rect(img, SIZE, [2, 2, 10, 10], AVATAR_SOURCE_FACE_OBSERVED, (x, y) =>
      (x + y) % 2 ? SKIN : [0, 0, 0],
    );
    rect(img, SIZE, [20, 2, 28, 10], AVATAR_SOURCE_FACE_OBSERVED, [0, 0, 0]);
    rect(img, SIZE, [0, 16, 32, 32], AVATAR_SOURCE_OBSERVED, RED);
    const { data, skinRgb } = fill(img, partMapOf(), 'OBSERVED');
    expect(skinRgb).toEqual(SKIN);
    // 빈 130 은 이웃 관측 얼굴 평균(SKIN), 관측 130 은 원래 색 그대로.
    expect(rgbaAt(data, SIZE, 4, 4)).toEqual([...SKIN, 255]);
    expect(rgbaAt(data, SIZE, 3, 4)).toEqual([...SKIN, 255]);
    // 이웃에 관측 얼굴이 없는 빈 130 은 피부 단색.
    expect(rgbaAt(data, SIZE, 24, 5)).toEqual([...SKIN, 255]);
  });

  it('밉맵 표본에 검정이 섞이지 않게 섬 밖 빈칸으로 넉넉히 번진다', () => {
    const N = 1024;
    const grid = avatarFillGridSize(N, N);
    const g = new THREE.BufferGeometry();
    // 가운데 작은 섬 하나(나머지 아틀라스는 빈칸).
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 1.6, 0, 1, 1.6, 0, 1, 1.0, 0, 0, 1.0, 0], 3),
    );
    g.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute([0.4, 0.4, 0.6, 0.4, 0.6, 0.6, 0.4, 0.6], 2),
    );
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const map = buildAvatarUvPartMap([g], grid.width, grid.height, AVATAR_WAIST_REST_Y);
    const img = blankImage(N);
    rect(img, N, [412, 412, 612, 612], AVATAR_SOURCE_OBSERVED, GREEN);
    const { data } = fill(img, map, 'OBSERVED', N);
    // 섬 가장자리(0.4·1024 ≈ 410)에서 밖으로 24 텍셀 떨어진 빈칸도 섬 색이다(밉맵 3~4단계 표본 반경).
    expectNear(rgbaAt(data, N, 386, 512), GREEN);
    expect(rgbaAt(data, N, 386, 512)[3]).toBe(255);
  });

  it('채우기 실패 대비 마스크도 빈 픽셀은 알파 0 으로 둔다', () => {
    const img = blankImage(4);
    put(img, 4, 0, 0, AVATAR_SOURCE_OBSERVED, [0, 0, 0]);
    put(img, 4, 1, 0, AVATAR_SOURCE_OBSERVED, [3, 3, 3]);
    put(img, 4, 2, 0, AVATAR_SOURCE_OBSERVED, [4, 0, 0]);
    put(img, 4, 3, 0, AVATAR_SOURCE_FACE_OBSERVED, [1, 2, 0]);
    const data = maskUnfilledAvatarAlbedo({
      width: 4,
      height: 4,
      albedo: img.albedo,
      source: img.source,
      sourceWidth: 4,
      sourceHeight: 4,
      facePolicy: 'OBSERVED',
      partMap: null,
    });
    expect([0, 1, 2, 3].map((i) => data[i * 4 + 3])).toEqual([0, 0, 255, 0]);
  });
});

describe('성능(1024², 실제 MHR 크기 합성 dense 리그)', () => {
  it('부위 지도와 채우기가 메인 스레드를 오래 막지 않는다', async () => {
    const dense = fs.readFileSync(
      cwd + '/src/features/viewer3d/dev-harness/fixtures/synthetic-mhr-dense.glb',
    );
    const gltf = await new GLTFLoader().parseAsync(new Uint8Array(dense).buffer, '');
    gltf.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) ensureAvatarMeshUv(mesh.geometry);
    });
    const N = 1024;
    const grid = avatarFillGridSize(N, N);
    expect([grid.factor, grid.width, grid.height]).toEqual([4, 256, 256]);

    const t0 = performance.now();
    const partMap = avatarUvPartMapForScene(
      gltf.scene,
      grid.width,
      grid.height,
      AVATAR_WAIST_REST_Y,
    );
    const partMs = performance.now() - t0;
    expect(partMap).not.toBeNull();
    // 같은 장면·격자는 다시 만들지 않는다.
    expect(avatarUvPartMapForScene(gltf.scene, grid.width, grid.height, AVATAR_WAIST_REST_Y)).toBe(
      partMap,
    );

    // 천장 카메라처럼 앞·위만 보이고 뒤·아래가 비는 합성 출처 지도(관측 약 40%, 보간 5%, 얼굴 일부).
    const img = blankImage(N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / N;
        const v = y / N;
        if (v < 0.18 && u < 0.5) {
          const code = u > 0.1 && u < 0.4 && v > 0.02 && v < 0.16 ? 130 : 128;
          put(img, N, x, y, code, [210, 170, 140]);
        } else if (u < 0.5 && v < 0.72) {
          put(img, N, x, y, AVATAR_SOURCE_OBSERVED, v < 0.49 ? RED : BLUE);
        } else if (u < 0.55 && v < 0.72) {
          put(img, N, x, y, AVATAR_SOURCE_INTERPOLATED, v < 0.49 ? RED : BLUE);
        }
      }
    }
    const runs: number[] = [];
    let last: ReturnType<typeof fill> | null = null;
    for (let i = 0; i < 3; i++) {
      const s = performance.now();
      last = fill(img, partMap, 'OBSERVED', N);
      runs.push(performance.now() - s);
    }
    console.info(
      `[742 성능] 부위 지도 ${partMs.toFixed(1)} ms, 채우기 ${runs.map((r) => r.toFixed(1)).join(' / ')} ms`,
    );
    // 뒤쪽(u ≥ 0.55) 미관측이 채워졌다.
    expect(rgbaAt(last!.data, N, 800, 400)[3]).toBe(255);
    // 상한은 느린 CI 를 고려한 넉넉한 값이다(노트북 측정값은 설계 문서).
    expect(Math.min(...runs)).toBeLessThan(250);
    expect(partMs).toBeLessThan(500);
  });
});
