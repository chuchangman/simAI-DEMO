import {
  AVATAR_SOURCE_FACE_OBSERVED,
  AVATAR_SOURCE_FACE_UNOBSERVED,
  AVATAR_SOURCE_OBSERVED,
  AVATAR_WAIST_REST_Y,
  avatarMirrorMapFor,
  buildAvatarDisplayAlbedo,
  type AvatarAppearanceTextures,
} from '@/features/viewer3d/people/avatarAppearance';
import {
  avatarFillGridSize,
  buildAvatarUvPartMap,
  fillAvatarAlbedo,
  type AvatarFillInput,
  type AvatarUvPartMap,
} from '@/features/viewer3d/people/avatarAppearanceFill';
import {
  avatarUvMirrorMapForScene,
  buildAvatarUvMirrorMap,
  type AvatarUvMirrorMap,
} from '@/features/viewer3d/people/avatarAppearanceMirror';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 좌우 대칭 채움(S15P31A101-790). 합성 대칭 사각형·합성 대칭 격자 메시만 쓴다(사람 사진·실제 MHR 자산 아님).

type Rgb = readonly [number, number, number];
const RED: Rgb = [200, 40, 30];
const BLUE: Rgb = [30, 60, 190];
const GREEN: Rgb = [40, 180, 70];

type Uv4 = [number, number, number, number];

/**
 * 몸 왼쪽 사각형(x0 < x1 < 0)과 그 x 반전 사각형을 같은 정점 순서로 만든다(삼각형도 서로 대칭). 섬은 따로다.
 * 두 섬 모두 u 가 x 와 함께 커지므로, 텍셀 u 는 반대편에서 뒤집힌다.
 */
function mirroredPair(
  x: [number, number],
  y: [number, number],
  leftUv: Uv4,
  rightUv: Uv4,
  options: { rightYOffset?: number; axis?: 'x' | 'z' } = {},
): THREE.BufferGeometry {
  const [x0, x1] = x;
  const [y0, y1] = y;
  const dy = options.rightYOffset ?? 0;
  const pos: number[] = [];
  const left: [number, number][] = [
    [x0, y1],
    [x1, y1],
    [x1, y0],
    [x0, y0],
  ];
  const put = (a: number, h: number) => {
    // axis z: 좌우가 z 이고 x 는 높이를 따라 기울어 x 반전으로는 짝이 맞지 않는다.
    if (options.axis === 'z') pos.push(0.5 * h, h, a);
    else pos.push(a, h, 0);
  };
  for (const [a, h] of left) put(a, h);
  for (const [a, h] of left) put(-a, h + dy);
  const [lu0, lv0, lu1, lv1] = leftUv;
  const [ru0, rv0, ru1, rv1] = rightUv;
  const uv = [lu0, lv0, lu1, lv0, lu1, lv1, lu0, lv1, ru1, rv0, ru0, rv0, ru0, rv1, ru1, rv1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

const SIZE = 64;
// 왼쪽 섬 u 0.02~0.48, 오른쪽 섬 u 0.52~0.98 → 텍셀 x 는 반대편 63 - x 에 대응한다. 둘 다 허리(0.88 m) 위.
const pairGeometry = () =>
  mirroredPair([-1, -0.2], [1.0, 1.6], [0.02, 0.02, 0.48, 0.48], [0.52, 0.02, 0.98, 0.48]);

function blankImage(size = SIZE) {
  return { albedo: new Uint8Array(size * size * 4), source: new Uint8Array(size * size * 4) };
}

function rect(
  img: { albedo: Uint8Array; source: Uint8Array },
  size: number,
  [x0, y0, x1, y1]: [number, number, number, number],
  code: number,
  rgb: Rgb | ((x: number, y: number) => Rgb) = [0, 0, 0],
) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * size + x) * 4;
      const c = typeof rgb === 'function' ? rgb(x, y) : rgb;
      img.albedo.set([c[0], c[1], c[2], 255], o);
      img.source.set([code, code, code, 255], o);
    }
  }
}

function fillInput(
  img: { albedo: Uint8Array; source: Uint8Array },
  partMap: AvatarUvPartMap | null,
  mirror: AvatarUvMirrorMap | null,
  size = SIZE,
): AvatarFillInput {
  return {
    width: size,
    height: size,
    albedo: img.albedo,
    source: img.source,
    sourceWidth: size,
    sourceHeight: size,
    facePolicy: 'OBSERVED',
    partMap,
    mirror,
  };
}

function rgbaAt(data: Uint8Array, size: number, x: number, y: number) {
  const o = (y * size + x) * 4;
  return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!] as const;
}

function maps(g = pairGeometry()) {
  const partMap = buildAvatarUvPartMap([g], SIZE, SIZE, AVATAR_WAIST_REST_Y);
  const mirror = buildAvatarUvMirrorMap([g], SIZE, SIZE);
  return { partMap, mirror };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('좌우 대칭 대응표(메시 바인드 자세·UV)', () => {
  it('x 반전 정점 짝과 삼각형 단위 UV 대응으로 텍셀을 반대편 같은 자리에 잇는다', () => {
    const { mirror } = maps();
    expect(mirror).not.toBeNull();
    expect(mirror!.axis).toBe(0);
    expect(mirror!.stats.matchedVertices).toBe(mirror!.stats.vertices);
    expect(mirror!.stats.matchedTriangles).toBe(4);
    // 왼쪽 섬 안쪽 텍셀 (5, 10) ↔ 오른쪽 섬 (58, 10), 왕복하면 제자리.
    const at = (x: number, y: number) => mirror!.target[y * SIZE + x]!;
    expect(at(5, 10)).toBe(10 * SIZE + 58);
    expect(at(58, 10)).toBe(10 * SIZE + 5);
    // 섬 밖 빈칸은 대응 없음.
    expect(at(32, 10)).toBe(-1);
    expect(at(10, 50)).toBe(-1);
  });

  it('좌우 축은 메시에서 고른다(x 반전으로 짝이 안 맞고 z 반전으로 맞으면 z)', () => {
    const g = mirroredPair(
      [-1, -0.2],
      [1.0, 1.6],
      [0.02, 0.02, 0.48, 0.48],
      [0.52, 0.02, 0.98, 0.48],
      { axis: 'z' },
    );
    const mirror = buildAvatarUvMirrorMap([g], SIZE, SIZE);
    expect(mirror?.axis).toBe(2);
    expect(mirror!.target[10 * SIZE + 5]).toBe(10 * SIZE + 58);
  });

  it('대칭 짝이 허용 거리(1 cm)보다 멀면 대응이 없다', () => {
    const shifted = mirroredPair(
      [-1, -0.2],
      [1.0, 1.6],
      [0.02, 0.02, 0.48, 0.48],
      [0.52, 0.02, 0.98, 0.48],
      { rightYOffset: 0.03 },
    );
    // 정점 짝이 하나도 없으니 대칭 메시가 아니다.
    expect(buildAvatarUvMirrorMap([shifted], SIZE, SIZE)).toBeNull();
    // 허용 거리를 넓히면 같은 메시도 잇는다(거리 기준이 실제로 쓰인다).
    const loose = buildAvatarUvMirrorMap([shifted], SIZE, SIZE, { maxDistM: 0.05 });
    expect(loose?.stats.mappedTexels).toBeGreaterThan(0);
  });

  it('몸 중앙선 근처 삼각형은 자기 근처와 대응하므로 쓰지 않는다', () => {
    const center = mirroredPair(
      [-0.004, -0.001],
      [1.0, 1.6],
      [0.02, 0.02, 0.48, 0.48],
      [0.52, 0.02, 0.98, 0.48],
    );
    const mirror = buildAvatarUvMirrorMap([center], SIZE, SIZE);
    expect(mirror).not.toBeNull();
    expect(mirror!.stats.centerTriangles).toBe(4);
    expect(mirror!.stats.mappedTexels).toBe(0);
    expect(mirror!.target.every((t) => t === -1)).toBe(true);
  });

  it('장면·텍스처 크기별로 한 번만 만들고, 만들다 실패하면 경고 후 null(기존 채움만)', () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(pairGeometry(), new THREE.MeshStandardMaterial()));
    const first = avatarUvMirrorMapForScene(scene, SIZE, SIZE);
    expect(first).not.toBeNull();
    expect(avatarUvMirrorMapForScene(scene, SIZE, SIZE)).toBe(first);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = new THREE.Group();
    const g = pairGeometry();
    g.getAttribute = () => {
      throw new Error('깨진 형상');
    };
    broken.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()));
    expect(avatarUvMirrorMapForScene(broken, SIZE, SIZE)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('좌우 대칭 대응표 실패'));
    expect(avatarUvMirrorMapForScene(broken, SIZE, SIZE)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('좌우 대칭 채움(-790)', () => {
  it('미관측 몸 텍셀은 대칭 텍셀이 관측이면 그 색을 그대로 쓴다(무늬 좌우 반전)', () => {
    const { partMap, mirror } = maps();
    const img = blankImage();
    // 왼쪽 섬: 바깥(x<16) 빨강, 안쪽(x≥16) 파랑 관측. 오른쪽 섬 전체 미관측.
    rect(img, SIZE, [0, 0, 16, 32], AVATAR_SOURCE_OBSERVED, RED);
    rect(img, SIZE, [16, 0, 32, 32], AVATAR_SOURCE_OBSERVED, BLUE);
    const withMirror = fillAvatarAlbedo(fillInput(img, partMap, mirror));
    // 오른쪽 섬 바깥(x=58 ↔ 5)은 빨강, 안쪽(x=36 ↔ 27)은 파랑. 텍셀 복사라 정확히 같다.
    expect(rgbaAt(withMirror.data, SIZE, 58, 10)).toEqual([...RED, 255]);
    expect(rgbaAt(withMirror.data, SIZE, 36, 20)).toEqual([...BLUE, 255]);
    expect(withMirror.stats.mirroredTexels).toBeGreaterThan(500);
    // 대칭 없이는 오른쪽 섬이 한 색(같은 상하 관측 중앙값)이라 무늬가 없다.
    const without = fillAvatarAlbedo(fillInput(img, partMap, null));
    expect(rgbaAt(without.data, SIZE, 58, 10)).toEqual(rgbaAt(without.data, SIZE, 36, 20));
    expect(without.stats.mirroredTexels).toBe(0);
  });

  it('대칭 텍셀도 미관측이면 기존 채움 그대로다', () => {
    const { partMap, mirror } = maps();
    const img = blankImage();
    // 왼쪽 x<16 ↔ 오른쪽 x≥48 만 관측. 남은 미관측(왼쪽 16~31 ↔ 오른쪽 32~47)은 서로 미관측이다.
    rect(img, SIZE, [0, 0, 16, 32], AVATAR_SOURCE_OBSERVED, RED);
    rect(img, SIZE, [48, 0, 64, 32], AVATAR_SOURCE_OBSERVED, GREEN);
    const withMirror = fillAvatarAlbedo(fillInput(img, partMap, mirror));
    const without = fillAvatarAlbedo(fillInput(img, partMap, null));
    expect(withMirror.stats.mirroredTexels).toBe(0);
    expect(withMirror.data).toEqual(without.data);
  });

  it('빈 픽셀(관측인데 RGB≈0)은 대칭으로 받기만 하고 대칭 색으로 주지 않는다', () => {
    const { partMap, mirror } = maps();
    const img = blankImage();
    // 왼쪽 섬은 관측이지만 빈 픽셀(RGB 0), 오른쪽 섬은 미관측.
    rect(img, SIZE, [0, 0, 32, 32], AVATAR_SOURCE_OBSERVED, [0, 0, 0]);
    const res = fillAvatarAlbedo(fillInput(img, partMap, mirror));
    expect(res.stats.mirroredTexels).toBe(0);
    // 반대로 왼쪽이 정상 관측이면 오른쪽 빈 픽셀(관측 RGB 0)도 대칭 색을 받는다.
    const img2 = blankImage();
    rect(img2, SIZE, [0, 0, 32, 32], AVATAR_SOURCE_OBSERVED, GREEN);
    rect(img2, SIZE, [32, 0, 64, 32], AVATAR_SOURCE_OBSERVED, [0, 0, 0]);
    const res2 = fillAvatarAlbedo(fillInput(img2, partMap, mirror));
    expect(rgbaAt(res2.data, SIZE, 50, 10)).toEqual([...GREEN, 255]);
    expect(res2.stats.mirroredTexels).toBeGreaterThan(500);
  });

  it('얼굴 텍셀은 대칭 복사를 받지도 주지도 않는다(얼굴 미관측은 단색, 이목구비 없음)', () => {
    const { partMap, mirror } = maps();
    const SKIN_A: Rgb = [220, 170, 140];
    const SKIN_B: Rgb = [120, 80, 60];
    // 왼쪽 섬 위쪽: 관측 얼굴 체커, 오른쪽 섬 위쪽: 얼굴 미관측(128).
    const img = blankImage();
    rect(img, SIZE, [0, 0, 32, 12], AVATAR_SOURCE_FACE_OBSERVED, (x, y) =>
      (x + y) % 2 ? SKIN_A : SKIN_B,
    );
    rect(img, SIZE, [32, 0, 64, 12], AVATAR_SOURCE_FACE_UNOBSERVED);
    // 아래쪽: 왼쪽 관측 얼굴(130) ↔ 오른쪽 몸 미관측(0). 얼굴 색이 몸으로 복사되면 안 된다.
    rect(img, SIZE, [0, 12, 32, 20], AVATAR_SOURCE_FACE_OBSERVED, SKIN_A);
    rect(img, SIZE, [0, 20, 32, 32], AVATAR_SOURCE_OBSERVED, RED);
    const res = fillAvatarAlbedo(fillInput(img, partMap, mirror));
    // 얼굴 미관측은 관측 얼굴 평균 단색 하나.
    const first = rgbaAt(res.data, SIZE, 34, 2);
    for (let y = 1; y < 12; y++) {
      for (let x = 34; x < 62; x++) expect(rgbaAt(res.data, SIZE, x, y)).toEqual(first);
    }
    expect(first.slice(0, 3)).toEqual(res.skinRgb);
    // 몸 미관측(오른쪽 12~19행)은 얼굴 색을 대칭으로 받지 않고, 몸 관측(빨강)만 대칭으로 받는다.
    expect(rgbaAt(res.data, SIZE, 50, 25)).toEqual([...RED, 255]);
    expect(rgbaAt(res.data, SIZE, 50, 15).slice(0, 3)).not.toEqual(SKIN_A);
    let mirroredRows = 0;
    for (let y = 12; y < 20; y++) {
      if (rgbaAt(res.data, SIZE, 50, y).slice(0, 3).join() === SKIN_A.join()) mirroredRows++;
    }
    expect(mirroredRows).toBe(0);
  });

  it('대응표 크기가 albedo 와 다르면 대칭 없이 기존 채움만 한다', () => {
    const { partMap } = maps();
    const small = buildAvatarUvMirrorMap([pairGeometry()], 32, 32);
    const img = blankImage();
    rect(img, SIZE, [0, 0, 32, 32], AVATAR_SOURCE_OBSERVED, RED);
    const res = fillAvatarAlbedo(fillInput(img, partMap, small));
    expect(res.stats.mirroredTexels).toBe(0);
  });
});

describe('표시 albedo 연결과 실패 폴백', () => {
  const png = (img: { albedo: Uint8Array; source: Uint8Array }) => ({
    albedo: { width: SIZE, height: SIZE, channels: 4 as const, data: img.albedo },
    source: { width: SIZE, height: SIZE, channels: 4 as const, data: img.source },
  });

  it('대칭 채움이 실패하면 경고를 남기고 대칭 없이 다시 채운다', () => {
    const { partMap, mirror } = maps();
    const img = blankImage();
    rect(img, SIZE, [0, 0, 32, 32], AVATAR_SOURCE_OBSERVED, RED);
    const { albedo, source } = png(img);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = (input: AvatarFillInput) => {
      if (input.mirror) throw new Error('대칭 오류');
      return fillAvatarAlbedo(input);
    };
    const data = buildAvatarDisplayAlbedo(
      albedo,
      source,
      'OBSERVED',
      partMap,
      { worldId: 'w-1', appearanceVersion: 3 },
      mirror,
      failing,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('좌우 대칭 채우기 실패'));
    expect(data).toEqual(fillAvatarAlbedo(fillInput(img, partMap, null)).data);
  });

  it('대칭 채움을 끄거나 메시가 없으면 대응표를 쓰지 않는다', () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(pairGeometry(), new THREE.MeshStandardMaterial()));
    const appearance = { width: SIZE, height: SIZE } as AvatarAppearanceTextures;
    expect(avatarMirrorMapFor(appearance, scene)).not.toBeNull();
    expect(avatarMirrorMapFor(appearance, scene, false)).toBeNull();
    expect(avatarMirrorMapFor(appearance, null)).toBeNull();
  });
});

/** 몸 왼쪽 반(x<0) 격자와 그 x 반전을 같은 정점 순서로 만든 대칭 격자(정점 약 2만, 실제 MHR 크기). */
function symmetricGrid(nx: number, ny: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = 0.01 + (0.6 * i) / (nx - 1); // 중앙선에서 바깥으로
        const y = 0.1 + (1.6 * j) / (ny - 1);
        pos.push(side * a, y, 0.05 * Math.sin(i * 0.3));
        // 왼쪽 섬 u 0.01~0.49(바깥이 작은 u), 오른쪽 섬 u 0.51~0.99(바깥이 큰 u). v 는 위가 작다.
        const u = side < 0 ? 0.49 - (0.48 * i) / (nx - 1) : 0.51 + (0.48 * i) / (nx - 1);
        uv.push(u, 0.01 + (0.98 * (ny - 1 - j)) / (ny - 1));
      }
    }
    for (let j = 0; j + 1 < ny; j++) {
      for (let i = 0; i + 1 < nx; i++) {
        const q = base + j * nx + i;
        index.push(q, q + 1, q + nx + 1, q, q + nx + 1, q + nx);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

describe('성능(1024², 정점 2만 대칭 격자)', () => {
  it('대응표는 메시당 한 번, 채우기 추가 시간은 수십 ms 안이다', () => {
    const g = symmetricGrid(100, 100);
    const N = 1024;
    const grid = avatarFillGridSize(N, N);
    const partMap = buildAvatarUvPartMap([g], grid.width, grid.height, AVATAR_WAIST_REST_Y);
    const t0 = performance.now();
    const mirror = buildAvatarUvMirrorMap([g], N, N);
    const mirrorMs = performance.now() - t0;
    expect(mirror).not.toBeNull();
    expect(mirror!.stats.matchedVertices).toBe(mirror!.stats.vertices);

    // 왼쪽 섬은 거의 관측(무늬), 오른쪽 섬은 위 30% 만 관측(천장 카메라가 한쪽 팔을 못 본 경우 흉내).
    const img = blankImage(N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const o = (y * N + x) * 4;
        const left = x < N / 2;
        if (left || y < N * 0.3) {
          img.albedo.set([(x * 7) & 255, (y * 3) & 255, 120, 255], o);
          img.source.set([AVATAR_SOURCE_OBSERVED, 0, 0, 255], o);
        }
      }
    }
    const input = (m: AvatarUvMirrorMap | null) => fillInput(img, partMap, m, N);
    const runsOld: number[] = [];
    const runsNew: number[] = [];
    let mirrored = 0;
    for (let i = 0; i < 3; i++) {
      let s = performance.now();
      fillAvatarAlbedo(input(null));
      runsOld.push(performance.now() - s);
      s = performance.now();
      mirrored = fillAvatarAlbedo(input(mirror)).stats.mirroredTexels;
      runsNew.push(performance.now() - s);
    }
    console.info(
      `[790 성능] 대응표 ${mirrorMs.toFixed(1)} ms, 채우기 기존 ${runsOld
        .map((r) => r.toFixed(1))
        .join(
          ' / ',
        )} ms, 대칭 ${runsNew.map((r) => r.toFixed(1)).join(' / ')} ms, 대칭 텍셀 ${mirrored}`,
    );
    expect(mirrored).toBeGreaterThan(100_000);
    // 상한은 느린 CI 를 고려한 넉넉한 값이다(노트북 측정값은 설계 문서).
    expect(mirrorMs).toBeLessThan(500);
    expect(Math.min(...runsNew) - Math.min(...runsOld)).toBeLessThan(100);
    expect(Math.min(...runsNew)).toBeLessThan(300);
  });
});
