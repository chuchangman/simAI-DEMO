import {
  AVATAR_SOURCE_FACE_OBSERVED,
  AVATAR_SOURCE_FACE_UNOBSERVED,
  AVATAR_SOURCE_INTERPOLATED,
  AVATAR_SOURCE_OBSERVED,
  AVATAR_SOURCE_UNOBSERVED,
  encodeAvatarPng,
  type AvatarFacePolicy,
} from '@/features/viewer3d/people/avatarAppearance';
import { Quaternion, Vector3 } from 'three';

// 개발 화면 EXP-02 아바타(-65·-359) 시험 자료. 자산은 fixtures/synthetic-mhr.glb(합성 127관절 리그, make_synthetic_mhr.py 가
// AI -88 내보내기로 만든 것)다. 실제 MHR 체형·관절 순서가 아니다. 포즈는 걷기 흉내이고 HMR 추정이 아니다.

/** fixtures/synthetic-mhr.glb 의 값. 파일을 다시 만들면 함께 고친다(avatarMesh 시험이 파일과 대조한다). */
export const SYNTHETIC_MHR = {
  meshSha256: 'sha256:9559301e4745dd758d1735c838a3a7b51f72eb41c7c6ec9596c7e931ef12fcb3',
  jointParentsSha256: 'sha256:d22c16506c652947a7d06e166145f6ee40f7b2e648b853ccdffd1eb733274bb2',
  jointCount: 127,
  pelvisJointIndex: 1,
} as const;

/**
 * fixtures/synthetic-mhr-dense.glb(make_synthetic_mhr.py --dense). 관절은 같고 메시만 실제 MHR 크기(정점 21,168·삼각형 36,504,
 * 관절 근처 2개 가중치)다. 다인원 성능 시험(avatar-crowd-*)용. 실제 체형·외형이 아니다.
 */
export const SYNTHETIC_MHR_DENSE = {
  ...SYNTHETIC_MHR,
  meshSha256: 'sha256:4b8b9d405753d7113e7cf999e83f96e7fe4e9055ad95271ba488efb4748216fc',
} as const;
/** MSW 가 dense 자산으로 주는 자산 버전(0 은 기본 합성 리그, 그 밖은 404). */
export const DENSE_ASSET_VERSION = 1;

/** 합성 리그 관절 번호(make_synthetic_mhr.py 의 BODY 순서). */
const J = {
  lShoulder: 8,
  lElbow: 9,
  rShoulder: 12,
  rElbow: 13,
  lHip: 15,
  lKnee: 16,
  rHip: 19,
  rKnee: 20,
} as const;

/** MHR 손가락 범위처럼 body 모드에서 null 로 오는 관절. */
const isFinger = (i: number) => (i >= 43 && i <= 64) || (i >= 79 && i <= 100);

export const avatarMeshUrl = (worldId: string, epoch: number, version: number) =>
  `/api/avatars/${worldId}/epochs/${epoch}/versions/${version}/mesh.glb`;

export const avatarTextureUrl = (worldId: string, epoch: number, version: number) =>
  `/api/avatars/${worldId}/epochs/${epoch}/versions/${version}/albedo.png`;

export const avatarSurfaceSourceUrl = (worldId: string, epoch: number, version: number) =>
  `/api/avatars/${worldId}/epochs/${epoch}/versions/${version}/surface_source.png`;

export type AvatarTextureDevMode = 'off' | 'observed' | 'blurred' | 'excluded';

/**
 * 개발 화면 주소(?avatarTex=observed|blurred|excluded|off|on)에서 합성 텍스처 모드를 읽는다.
 * 지정하지 않으면 'off'(기존 단위 시험과 동일한 기본 재질).
 */
export function readAvatarTextureMode(
  search: string = globalThis.location?.search ?? '',
): AvatarTextureDevMode {
  const raw = new URLSearchParams(search).get('avatarTex')?.toLowerCase();
  if (raw === 'on' || raw === 'observed') return 'observed';
  if (raw === 'blurred') return 'blurred';
  if (raw === 'excluded') return 'excluded';
  return 'off';
}

export function facePolicyForDevMode(mode: AvatarTextureDevMode): AvatarFacePolicy {
  if (mode === 'observed') return 'OBSERVED';
  if (mode === 'blurred') return 'BLURRED';
  return 'EXCLUDED';
}

const JACKET_PALETTE: readonly [number, number, number][] = [
  [34, 197, 94], // 에메랄드 작업복
  [249, 115, 22], // 오렌지 안전복
  [14, 165, 233], // 스카이 블루 셔츠
  [234, 179, 8], // 앰버 조끼
];

const PANTS_PALETTE: readonly [number, number, number][] = [
  [37, 99, 235], // 코발트 하의
  [79, 70, 229], // 인디고 하의
  [15, 118, 110], // 틸 하의
  [180, 83, 9], // 브라운 하의
];

const syntheticTextureCache = new Map<
  string,
  { albedoPng: Uint8Array; surfaceSourcePng: Uint8Array }
>();

/**
 * 실제 사람 사진을 저장소에 넣지 않고 코드로 만드는 합성 외형 텍스처(albedo.png)와 표면 출처 지도(surface_source.png).
 * - 상단 얼굴 영역(v < 0.18, u < 0.5): 가운데는 130(얼굴 관측, 눈·입 고주파 격자 포함), 가장자리는 128(얼굴 미관측)
 * - 상의 영역(0.18 <= v < 0.49): 앞면(u < 0.5)은 2(OBSERVED), 옆·뒷면 일부(0.5 <= u < 0.76)는 1(INTERPOLATED), 나머지 뒷면은 0(UNOBSERVED)
 * - 하의 영역(v >= 0.49): 허벅지 앞면은 2(OBSERVED), 무릎은 1(INTERPOLATED), 정강이·뒷면은 0(UNOBSERVED)
 */
export function getSyntheticAvatarPngPair(
  worldId: string,
  version = 0,
  size = 96,
): { albedoPng: Uint8Array; surfaceSourcePng: Uint8Array } {
  const key = `${worldId}|${version}|${size}`;
  const cached = syntheticTextureCache.get(key);
  if (cached) return cached;

  const hash = [...worldId].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) + version * 7;
  const jacket = JACKET_PALETTE[hash % JACKET_PALETTE.length]!;
  const pants = PANTS_PALETTE[hash % PANTS_PALETTE.length]!;

  const rgb = new Uint8Array(size * size * 3);
  const src = new Uint8Array(size * size);

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const idx = y * size + x;
      const p = idx * 3;

      if (v < 0.18) {
        // 머리 영역
        if (u >= 0.1 && u <= 0.4 && v >= 0.02 && v <= 0.16) {
          src[idx] = AVATAR_SOURCE_FACE_OBSERVED;
          // 눈·입·볼에 고대비 특징을 넣어 OBSERVED 와 BLURRED 의 차이를 선명하게 드러낸다.
          const isEyeRow = v >= 0.06 && v <= 0.09;
          const isLeftEye = u >= 0.16 && u <= 0.21;
          const isRightEye = u >= 0.29 && u <= 0.34;
          const isMouth = v >= 0.12 && v <= 0.14 && u >= 0.2 && u <= 0.3;
          const checker = ((x >> 1) + (y >> 1)) % 2 === 0;
          if (isEyeRow && (isLeftEye || isRightEye)) {
            rgb[p] = 24;
            rgb[p + 1] = 32;
            rgb[p + 2] = 48;
          } else if (isMouth) {
            rgb[p] = 195;
            rgb[p + 1] = 58;
            rgb[p + 2] = 64;
          } else {
            rgb[p] = checker ? 242 : 224;
            rgb[p + 1] = checker ? 196 : 174;
            rgb[p + 2] = checker ? 166 : 144;
          }
        } else if (u < 0.5) {
          src[idx] = AVATAR_SOURCE_FACE_UNOBSERVED;
          rgb[p] = 180;
          rgb[p + 1] = 150;
          rgb[p + 2] = 130;
        } else {
          src[idx] = AVATAR_SOURCE_UNOBSERVED;
        }
      } else if (v < 0.49) {
        // 상의 영역
        const stripe = v >= 0.28 && v <= 0.34;
        rgb[p] = stripe ? 248 : jacket[0];
        rgb[p + 1] = stripe ? 250 : jacket[1];
        rgb[p + 2] = stripe ? 252 : jacket[2];
        if (u < 0.5) {
          src[idx] = AVATAR_SOURCE_OBSERVED;
        } else if (u < 0.76) {
          src[idx] = AVATAR_SOURCE_INTERPOLATED;
        } else {
          src[idx] = AVATAR_SOURCE_UNOBSERVED;
        }
      } else {
        // 하의 영역
        rgb[p] = pants[0];
        rgb[p + 1] = pants[1];
        rgb[p + 2] = pants[2];
        if (u < 0.5 && v < 0.72) {
          src[idx] = AVATAR_SOURCE_OBSERVED;
        } else if (u < 0.5 && v < 0.86) {
          src[idx] = AVATAR_SOURCE_INTERPOLATED;
        } else {
          src[idx] = AVATAR_SOURCE_UNOBSERVED;
        }
      }
    }
  }

  const pair = {
    albedoPng: encodeAvatarPng(size, size, rgb, 2),
    surfaceSourcePng: encodeAvatarPng(size, size, src, 0),
  };
  syntheticTextureCache.set(key, pair);
  return pair;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const toAxisAngle = (input: Quaternion): [number, number, number] => {
  // 같은 회전의 두 표현 중 회전각 ≤ π 인 쪽(w ≥ 0)을 쓴다.
  const q = input.w < 0 ? new Quaternion(-input.x, -input.y, -input.z, -input.w) : input;
  const w = Math.min(1, Math.max(-1, q.w));
  const angle = 2 * Math.acos(w);
  const s = Math.sqrt(1 - w * w);
  if (s < 1e-9) return [0, 0, 0];
  return [r4((q.x / s) * angle), r4((q.y / s) * angle), r4((q.z / s) * angle)];
};

const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);

/**
 * 리그 → World 회전. 리그는 Y-up 이고 +Z 를 본다. Rx(+π/2) 로 세우면 앞이 World −Y 라,
 * World 진행 방향 heading(rad, +X 기준)을 보려면 Rz(heading + π/2) 를 더 돌린다.
 */
export function rootRotationFor(heading: number): [number, number, number] {
  const stand = new Quaternion().setFromAxisAngle(X, Math.PI / 2);
  const turn = new Quaternion().setFromAxisAngle(Z, heading + Math.PI / 2);
  return toAxisAngle(turn.multiply(stand));
}

/** 걷기 흉내 관절 회전(127개). stride 0 이면 선 자세다. 다리·팔은 리그 X 축으로 흔든다. */
export function walkRotations(phase: number, stride: number): ([number, number, number] | null)[] {
  const s = Math.sin(phase);
  const swing: Record<number, number> = {
    [J.lHip]: -0.45 * stride * s,
    [J.rHip]: 0.45 * stride * s,
    [J.lKnee]: 0.7 * stride * Math.max(0, -Math.sin(phase - 0.6)),
    [J.rKnee]: 0.7 * stride * Math.max(0, Math.sin(phase - 0.6)),
    [J.lShoulder]: 0.35 * stride * s,
    [J.rShoulder]: -0.35 * stride * s,
    [J.lElbow]: -0.25 - 0.1 * stride,
    [J.rElbow]: -0.25 - 0.1 * stride,
  };
  return Array.from({ length: SYNTHETIC_MHR.jointCount }, (_, i) => {
    if (isFinger(i)) return null;
    const angle = swing[i];
    return angle === undefined ? [0, 0, 0] : [r4(angle), 0, 0];
  });
}
