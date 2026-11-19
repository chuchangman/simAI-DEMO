import { avatarSurfaceGeometries } from '@/features/viewer3d/people/avatarAppearanceFill';
import type { BufferAttribute, BufferGeometry, Object3D } from 'three';

// 아바타 외형 좌우 대칭 채움의 텍셀 대응표(S15P31A101-790). 설계: docs/design/S15P31A101-790-avatar-mirror-fill.md.
// 천장 카메라는 한쪽 팔·다리 면 전체를 못 보는 일이 많다. 작업복·조끼는 대부분 좌우 대칭이라, 미관측 몸 텍셀은
// 몸 좌우 반대편의 같은 자리가 관측이면 그 색을 먼저 쓴다(표시만, surface_source 출처 데이터는 그대로).
// 대응은 메시에서 계산한다(하드코딩 없음).
// 1. 바인드 자세 정점(위치가 같은 정점은 하나로 묶음)을 좌우 축 기준으로 뒤집고 가장 가까운 정점을 짝으로 둔다(허용 거리 안만).
//    좌우 축은 위 축(glTF Y-up 의 y)을 뺀 x·z 중 짝이 더 많이 맞는 쪽이다(실제 MHR 은 x).
// 2. 삼각형 단위로 짝을 찾는다: 세 정점의 짝으로 이루어진 삼각형. 그 삼각형의 UV 로 무게중심 좌표를 옮긴다(삼각형마다 아핀 대응).
// 3. 텍스처 해상도에서 삼각형을 래스터화해 텍셀 → 대칭 텍셀 번호표를 만든다. 장면·텍스처 크기별로 한 번만 만든다.

/** 좌우 대칭 채움을 쓸지(시연 범위 기본 켬). false 면 -742/-755 채움만 쓴다. */
export const AVATAR_FILL_MIRROR_ENABLED = true;
/** 뒤집은 정점과 짝 정점 사이 허용 거리(m). 이보다 멀면 대응 없음(실자산 측정은 설계 문서). */
export const AVATAR_MIRROR_MAX_DIST_M = 0.01;
/** 몸 중앙선에서 이 거리(m) 안의 삼각형은 자기 자신 근처와 대응하므로 쓰지 않는다. */
export const AVATAR_MIRROR_CENTER_BAND_M = 0.01;
/** 정점 짝 비율이 이보다 낮으면 대칭 메시가 아니라고 보고 대응표를 만들지 않는다. */
export const AVATAR_MIRROR_MIN_MATCH_RATIO = 0.5;
/** x 축 정점 짝 비율이 이 이상이면 z 축은 재지 않는다(계산 절약). */
const AVATAR_MIRROR_SKIP_OTHER_AXIS_RATIO = 0.9;

export interface AvatarUvMirrorMap {
  width: number;
  height: number;
  /** 텍셀별 대칭 텍셀 번호(y × width + x, glTF 상단 원점). -1 은 대응 없음. */
  target: Int32Array;
  /** 좌우 축(0: x, 2: z)과 대칭면 위치(m). */
  axis: 0 | 2;
  center: number;
  stats: {
    /** 위치로 묶은 정점 수와 허용 거리 안에 짝이 있는 정점 수. */
    vertices: number;
    matchedVertices: number;
    /** 짝 정점까지 거리 중앙값·95%·최댓값(m, 짝이 있는 정점만). */
    medianDistM: number;
    p95DistM: number;
    maxDistM: number;
    /** 전체 삼각형, 대칭 삼각형을 찾은 삼각형, 중앙선이라 뺀 삼각형. */
    triangles: number;
    matchedTriangles: number;
    centerTriangles: number;
    /** 대응이 있는 텍셀 수. */
    mappedTexels: number;
    ms: number;
  };
}

interface MergedSurface {
  /** 정점(형상별 이어 붙인 번호)의 위치 묶음 번호. */
  weld: Int32Array;
  /** 묶음별 위치(x, y, z). */
  wpos: Float64Array;
  weldCount: number;
  /** 0.1 mm 반올림 위치 키 → 묶음 번호. */
  keyToWeld: Map<number, number>;
  uv: Float64Array;
  /** 삼각형 정점 번호(이어 붙인 번호). */
  tris: Int32Array;
}

/** 정수 격자 좌표(각 ±2^16 안, 0.1 mm 단위면 ±6.5 m) 셋을 Map 키 하나(2^51 미만)로 묶는다. 문자열 키보다 빠르다. */
function gridKey(ix: number, iy: number, iz: number): number {
  const o = 1 << 16;
  const m = 1 << 17;
  return ((ix + o) * m + (iy + o)) * m + (iz + o);
}

function mergeSurface(geometries: readonly BufferGeometry[]): MergedSurface {
  let vertexTotal = 0;
  let triTotal = 0;
  const parts: {
    pos: BufferAttribute;
    uv: BufferAttribute;
    index: ArrayLike<number> | null;
  }[] = [];
  for (const g of geometries) {
    const pos = g.getAttribute('position') as BufferAttribute | undefined;
    const uv = g.getAttribute('uv') as BufferAttribute | undefined;
    if (!pos || !uv || pos.count === 0 || uv.count !== pos.count) continue;
    const index = g.getIndex()?.array ?? null;
    parts.push({ pos, uv, index });
    vertexTotal += pos.count;
    triTotal += Math.floor((index ? index.length : pos.count) / 3);
  }
  const weld = new Int32Array(vertexTotal);
  const wposList: number[] = [];
  const uvArr = new Float64Array(vertexTotal * 2);
  const tris = new Int32Array(triTotal * 3);
  const keyToWeld = new Map<number, number>();
  let vBase = 0;
  let tOut = 0;
  for (const { pos, uv, index } of parts) {
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const y = pos.getY(v);
      const z = pos.getZ(v);
      // glTF 가 UV 이음매에서 가른 정점은 위치를 그대로 복사하므로 0.1 mm 반올림으로 다시 묶는다(-742 이음매 판정과 같음).
      const key = gridKey(Math.round(x * 1e4), Math.round(y * 1e4), Math.round(z * 1e4));
      let w = keyToWeld.get(key);
      if (w === undefined) {
        w = keyToWeld.size;
        keyToWeld.set(key, w);
        wposList.push(x, y, z);
      }
      weld[vBase + v] = w;
      uvArr[(vBase + v) * 2] = uv.getX(v);
      uvArr[(vBase + v) * 2 + 1] = uv.getY(v);
    }
    const n = index ? index.length - (index.length % 3) : pos.count - (pos.count % 3);
    for (let i = 0; i < n; i++) tris[tOut++] = vBase + (index ? index[i]! : i);
    vBase += pos.count;
  }
  return {
    weld,
    wpos: Float64Array.from(wposList),
    weldCount: keyToWeld.size,
    keyToWeld,
    uv: uvArr,
    tris,
  };
}

/**
 * 묶은 정점을 axis 기준으로 뒤집어 허용 거리 안 가장 가까운 묶음을 짝으로 둔다.
 * 대칭 메시는 뒤집은 위치가 다른 정점과 0.1 mm 반올림까지 같으므로 위치 키로 먼저 찾고, 없을 때만 공간 해시로 찾는다.
 */
function mirrorWelds(
  surf: MergedSurface,
  axis: 0 | 2,
  maxDist: number,
): { center: number; mate: Int32Array; dist: Float64Array; matched: number; paired: number } {
  const { wpos, weldCount: count, keyToWeld } = surf;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < count; i++) {
    const a = wpos[i * 3 + axis]!;
    if (a < lo) lo = a;
    if (a > hi) hi = a;
  }
  const center = (lo + hi) / 2;
  const cell = Math.max(maxDist, 1e-6);
  let buckets: Map<number, number[]> | null = null;
  const bucketsOf = (): Map<number, number[]> => {
    if (buckets) return buckets;
    const made = new Map<number, number[]>();
    for (let i = 0; i < count; i++) {
      const k = gridKey(
        Math.floor(wpos[i * 3]! / cell),
        Math.floor(wpos[i * 3 + 1]! / cell),
        Math.floor(wpos[i * 3 + 2]! / cell),
      );
      const b = made.get(k);
      if (b) b.push(i);
      else made.set(k, [i]);
    }
    buckets = made;
    return made;
  };
  const mate = new Int32Array(count).fill(-1);
  const dist = new Float64Array(count).fill(Infinity);
  let matched = 0;
  let paired = 0;
  const max2 = maxDist * maxDist;
  for (let i = 0; i < count; i++) {
    let px = wpos[i * 3]!;
    const py = wpos[i * 3 + 1]!;
    let pz = wpos[i * 3 + 2]!;
    if (axis === 0) px = 2 * center - px;
    else pz = 2 * center - pz;
    let best = -1;
    let bestD2 = max2;
    const exact = keyToWeld.get(
      gridKey(Math.round(px * 1e4), Math.round(py * 1e4), Math.round(pz * 1e4)),
    );
    if (exact !== undefined) {
      const ex = wpos[exact * 3]! - px;
      const ey = wpos[exact * 3 + 1]! - py;
      const ez = wpos[exact * 3 + 2]! - pz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = exact;
      }
    }
    if (best < 0) {
      const grid = bucketsOf();
      const cx = Math.floor(px / cell);
      const cy = Math.floor(py / cell);
      const cz = Math.floor(pz / cell);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const b = grid.get(gridKey(cx + dx, cy + dy, cz + dz));
            if (!b) continue;
            for (let k = 0; k < b.length; k++) {
              const j = b[k]!;
              const ex = wpos[j * 3]! - px;
              const ey = wpos[j * 3 + 1]! - py;
              const ez = wpos[j * 3 + 2]! - pz;
              const d2 = ex * ex + ey * ey + ez * ez;
              if (d2 <= bestD2) {
                bestD2 = d2;
                best = j;
              }
            }
          }
        }
      }
    }
    if (best >= 0) {
      mate[i] = best;
      dist[i] = Math.sqrt(bestD2);
      matched++;
      if (best !== i) paired++;
    }
  }
  return { center, mate, dist, matched, paired };
}

function percentile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))]!;
}

export interface AvatarUvMirrorOptions {
  maxDistM?: number;
  centerBandM?: number;
  minMatchRatio?: number;
}

/**
 * 메시들의 바인드 자세와 UV(glTF 상단 원점, flipY=false)로 width×height 텍셀의 좌우 대칭 대응표를 만든다.
 * 대칭 메시가 아니면(정점 짝 비율 < minMatchRatio) null.
 */
export function buildAvatarUvMirrorMap(
  geometries: readonly BufferGeometry[],
  width: number,
  height: number,
  options: AvatarUvMirrorOptions = {},
): AvatarUvMirrorMap | null {
  const started = performance.now();
  const maxDist = options.maxDistM ?? AVATAR_MIRROR_MAX_DIST_M;
  const centerBand = options.centerBandM ?? AVATAR_MIRROR_CENTER_BAND_M;
  const minRatio = options.minMatchRatio ?? AVATAR_MIRROR_MIN_MATCH_RATIO;
  const surf = mergeSurface(geometries);
  if (surf.weldCount === 0 || surf.tris.length === 0) return null;

  // 좌우 축: 위 축(y)을 뺀 x·z 중 다른 정점과 짝이 더 많이 맞는 쪽(대칭면 위 정점의 자기 짝은 세지 않는다. 납작한 형상이
  // 깊이 축 반전으로 전부 자기 짝이 되는 것을 막는다). x 가 거의 다 맞으면(glTF 관례, 실제 MHR) z 는 재지 않는다.
  const byX = mirrorWelds(surf, 0, maxDist);
  const byZ =
    byX.paired >= AVATAR_MIRROR_SKIP_OTHER_AXIS_RATIO * surf.weldCount
      ? null
      : mirrorWelds(surf, 2, maxDist);
  const axis: 0 | 2 = byZ && byZ.paired > byX.paired ? 2 : 0;
  const { center, mate, dist, matched, paired } = byZ && axis === 2 ? byZ : byX;
  if (paired / surf.weldCount < minRatio) return null;

  // 묶음 세 개(정렬) → 삼각형 번호.
  const triCount = surf.tris.length / 3;
  const W = surf.weldCount;
  const triKey = (a: number, b: number, c: number) => {
    const lo = Math.min(a, b, c);
    const hi = Math.max(a, b, c);
    const mid = a + b + c - lo - hi;
    return (lo * W + mid) * W + hi;
  };
  const triOfKey = new Map<number, number>();
  for (let t = 0; t < triCount; t++) {
    const k = triKey(
      surf.weld[surf.tris[t * 3]!]!,
      surf.weld[surf.tris[t * 3 + 1]!]!,
      surf.weld[surf.tris[t * 3 + 2]!]!,
    );
    if (!triOfKey.has(k)) triOfKey.set(k, t);
  }

  const target = new Int32Array(width * height).fill(-1);
  let matchedTriangles = 0;
  let centerTriangles = 0;
  let mappedTexels = 0;
  const { uv, weld, tris, wpos } = surf;
  for (let t = 0; t < triCount; t++) {
    const va = tris[t * 3]!;
    const vb = tris[t * 3 + 1]!;
    const vc = tris[t * 3 + 2]!;
    const wa = weld[va]!;
    const wb = weld[vb]!;
    const wc = weld[vc]!;
    if (wa === wb || wb === wc || wa === wc) continue;
    const mid = (wpos[wa * 3 + axis]! + wpos[wb * 3 + axis]! + wpos[wc * 3 + axis]!) / 3;
    if (Math.abs(mid - center) < centerBand) {
      centerTriangles++;
      continue;
    }
    const ma = mate[wa]!;
    const mb = mate[wb]!;
    const mc = mate[wc]!;
    if (ma < 0 || mb < 0 || mc < 0) continue;
    const t2 = triOfKey.get(triKey(ma, mb, mc));
    if (t2 === undefined || t2 === t) continue;
    // 대칭 삼각형에서 ma·mb·mc 에 해당하는 정점(그 삼각형의 UV 섬 정점).
    const u0 = tris[t2 * 3]!;
    const u1 = tris[t2 * 3 + 1]!;
    const u2 = tris[t2 * 3 + 2]!;
    const pick = (m: number) =>
      weld[u0] === m ? u0 : weld[u1] === m ? u1 : weld[u2] === m ? u2 : -1;
    const pa = pick(ma);
    const pb = pick(mb);
    const pc = pick(mc);
    if (pa < 0 || pb < 0 || pc < 0) continue;
    matchedTriangles++;
    mappedTexels += rasterMirrorTriangle(
      target,
      width,
      height,
      uv[va * 2]! * width,
      uv[va * 2 + 1]! * height,
      uv[vb * 2]! * width,
      uv[vb * 2 + 1]! * height,
      uv[vc * 2]! * width,
      uv[vc * 2 + 1]! * height,
      uv[pa * 2]! * width,
      uv[pa * 2 + 1]! * height,
      uv[pb * 2]! * width,
      uv[pb * 2 + 1]! * height,
      uv[pc * 2]! * width,
      uv[pc * 2 + 1]! * height,
    );
  }

  const ds: number[] = [];
  for (let i = 0; i < W; i++) if (mate[i]! >= 0) ds.push(dist[i]!);
  const sorted = Float64Array.from(ds).sort();
  return {
    width,
    height,
    target,
    axis,
    center,
    stats: {
      vertices: W,
      matchedVertices: matched,
      medianDistM: percentile(sorted, 0.5),
      p95DistM: percentile(sorted, 0.95),
      maxDistM: sorted.length > 0 ? sorted[sorted.length - 1]! : NaN,
      triangles: triCount,
      matchedTriangles,
      centerTriangles,
      mappedTexels,
      ms: performance.now() - started,
    },
  };
}

/** 삼각형 a·b·c(텍셀 좌표) 안 텍셀 중심마다 무게중심 좌표를 대칭 삼각형 a'·b'·c' 로 옮겨 대응 텍셀을 적는다. 새로 적은 텍셀 수. */
function rasterMirrorTriangle(
  out: Int32Array,
  width: number,
  height: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  a2x: number,
  a2y: number,
  b2x: number,
  b2y: number,
  c2x: number,
  c2y: number,
): number {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-12) return 0;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
  const inv = 1 / area;
  const eps = -1e-6;
  // 무게중심 좌표는 (px, py) 의 1차 함수라, 대칭 텍셀 좌표도 삼각형마다 tx = k0 + kx·px + ky·py 로 미리 둔다.
  const w0x = (by - cy) * inv;
  const w0y = (cx - bx) * inv;
  const w0c = (bx * cy - by * cx) * inv;
  const w1x = (cy - ay) * inv;
  const w1y = (ax - cx) * inv;
  const w1c = (cx * ay - cy * ax) * inv;
  const tkx = w0x * a2x + w1x * b2x - (w0x + w1x) * c2x;
  const tky = w0y * a2x + w1y * b2x - (w0y + w1y) * c2x;
  const tkc = w0c * a2x + w1c * b2x + (1 - w0c - w1c) * c2x;
  const ukx = w0x * a2y + w1x * b2y - (w0x + w1x) * c2y;
  const uky = w0y * a2y + w1y * b2y - (w0y + w1y) * c2y;
  const ukc = w0c * a2y + w1c * b2y + (1 - w0c - w1c) * c2y;
  let wrote = 0;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = w0x * px + w0y * py + w0c;
      const w1 = w1x * px + w1y * py + w1c;
      if (w0 < eps || w1 < eps || 1 - w0 - w1 < eps) continue;
      const tx = Math.min(width - 1, Math.max(0, Math.floor(tkx * px + tky * py + tkc)));
      const ty = Math.min(height - 1, Math.max(0, Math.floor(ukx * px + uky * py + ukc)));
      const t = y * width + x;
      const t2 = ty * width + tx;
      if (t2 === t) continue;
      if (out[t]! < 0) wrote++;
      out[t] = t2;
    }
  }
  return wrote;
}

const mirrorMapCache = new WeakMap<Object3D, Map<string, AvatarUvMirrorMap | null>>();

/**
 * 아바타 자산 장면의 좌우 대칭 대응표를 텍스처 크기별로 한 번만 만든다. 만들다 실패하면 경고를 남기고 null(기존 채움만).
 */
export function avatarUvMirrorMapForScene(
  scene: Object3D,
  width: number,
  height: number,
): AvatarUvMirrorMap | null {
  const key = `${width}x${height}`;
  let byKey = mirrorMapCache.get(scene);
  if (!byKey) {
    byKey = new Map();
    mirrorMapCache.set(scene, byKey);
  }
  if (byKey.has(key)) return byKey.get(key)!;
  let map: AvatarUvMirrorMap | null = null;
  try {
    const geometries = avatarSurfaceGeometries(scene);
    map = geometries.length > 0 ? buildAvatarUvMirrorMap(geometries, width, height) : null;
  } catch (err) {
    console.warn(
      `[viewer3d] 아바타 좌우 대칭 대응표 실패(기존 채움만 씀): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  byKey.set(key, map);
  return map;
}
