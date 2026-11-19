import {
  AVATAR_FILL_VOID_MAX_RGB,
  avatarFillGridSize,
  avatarUvPartMapForScene,
  fillAvatarAlbedo,
  maskUnfilledAvatarAlbedo,
  type AvatarFillInput,
  type AvatarUvPartMap,
} from '@/features/viewer3d/people/avatarAppearanceFill';
import {
  AVATAR_FILL_MIRROR_ENABLED,
  avatarUvMirrorMapForScene,
  type AvatarUvMirrorMap,
} from '@/features/viewer3d/people/avatarAppearanceMirror';
import {
  createAvatarAssetCache,
  type AvatarCacheEntry,
} from '@/features/viewer3d/people/avatarAssetCache';
import type { AvatarAssetView, AvatarPoseView } from '@/features/viewer3d/people/avatarFrame';
import { AVATAR_ASSET_RETRY_MS, type AvatarMeshFetch } from '@/features/viewer3d/people/avatarMesh';
import type { PersonTone } from '@/features/viewer3d/people/personMotion';
import { useThree } from '@react-three/fiber';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import {
  AmbientLight,
  BackSide,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DirectionalLight,
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  NoColorSpace,
  PMREMGenerator,
  RGBAFormat,
  SphereGeometry,
  SRGBColorSpace,
  Scene as ThreeScene,
  UnsignedByteType,
  Vector2,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from 'three';

// HMR 외형 텍스처(albedo.png)와 표면 출처 지도(surface_source.png)를 읽고 아바타 재질 셰이더에 입힌다(S15P31A101-359).
// 설계: docs/design/hmr-appearance-texture.md, docs/design/avatar-pose-stream.md.
// 표시(S15P31A101-742): 보간(1)은 원색, 미관측(0)·얼굴 미관측(128)은 CPU 에서 채운 표시용 albedo 로 그린다
// (docs/design/S15P31A101-742-avatar-fill-display.md). surface_source 데이터는 바꾸지 않는다.
// 빈 픽셀·밉맵(S15P31A101-755): 관측인데 RGB 가 거의 0 인 텍셀(워커가 지운 영상 칸을 관측으로 적은 것)도 채우고,
// 표시 albedo 는 밉맵으로 축소 표본의 점묘 깜빡임을 없앤다(docs/design/S15P31A101-755-avatar-sparse-fill.md).

export type AvatarFacePolicy = AvatarAssetView['facePolicy'];

/** surface_source.png 바이트 부호(docs/design/hmr-appearance-texture.md). */
export const AVATAR_SOURCE_UNOBSERVED = 0;
export const AVATAR_SOURCE_INTERPOLATED = 1;
export const AVATAR_SOURCE_OBSERVED = 2;
export const AVATAR_SOURCE_FACE_BIT = 0x80;
export const AVATAR_SOURCE_FACE_UNOBSERVED = 128;
export const AVATAR_SOURCE_FACE_INVALID_INTERPOLATED = 129;
export const AVATAR_SOURCE_FACE_OBSERVED = 130;

/**
 * 얼굴 BLURRED(130 + face_policy='BLURRED') 상수.
 * UV 공간에서 ±6 텍셀 간격의 3×3 가우시안 커널로 같은 얼굴 관측(130) 텍셀만 평균 내어 이목구비 고주파를 뭉개고,
 * 채도(85%)·명도(96%)를 부드럽게 완화한다.
 */
export const AVATAR_FACE_BLUR_STEP_TEXELS = 6;
export const AVATAR_FACE_BLUR_SATURATION = 0.85;
export const AVATAR_FACE_BLUR_BRIGHTNESS = 0.96;

/** 바인드 자세 기준 상·하의 경계 높이(m). 캡슐 아바타 허리 높이와 같다. */
export const AVATAR_WAIST_REST_Y = 0.88;
/** 별도 하의 대표색이 없을 때 상의 대표색 대비 하의 명도 비율. */
export const AVATAR_LOWER_COLOR_FACTOR = 0.58;

/** 아바타 전용 PBR 및 PMREM 환경맵 반사 세기. 장면 전역 조명이나 scene.environment 는 건드리지 않는다. */
export const AVATAR_PBR_ROUGHNESS = 0.55;
export const AVATAR_PBR_METALNESS = 0.08;
export const AVATAR_ENV_MAP_INTENSITY = 0.65;

export type AvatarSourceClassification =
  'OBSERVED' | 'INTERPOLATED' | 'UNOBSERVED' | 'FACE_UNOBSERVED' | 'FACE_OBSERVED' | 'UNKNOWN';

/** surface_source 부호(0~255)를 뜻에 따라 나눈다. 129(얼굴 보간)와 정의 밖 값은 UNKNOWN 으로 본다. */
export function classifyAvatarSurfaceCode(code: number): AvatarSourceClassification {
  if (!Number.isInteger(code) || code < 0 || code > 255) return 'UNKNOWN';
  if (code === AVATAR_SOURCE_UNOBSERVED) return 'UNOBSERVED';
  if (code === AVATAR_SOURCE_INTERPOLATED) return 'INTERPOLATED';
  if (code === AVATAR_SOURCE_OBSERVED) return 'OBSERVED';
  if (code === AVATAR_SOURCE_FACE_UNOBSERVED) return 'FACE_UNOBSERVED';
  if (code === AVATAR_SOURCE_FACE_OBSERVED) return 'FACE_OBSERVED';
  return 'UNKNOWN';
}

export type RgbTuple = readonly [number, number, number];

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function luma709([r, g, b]: RgbTuple): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function adjustSaturationAndBrightness(
  rgb: RgbTuple,
  saturation: number,
  brightness: number,
): RgbTuple {
  const y = luma709(rgb);
  return [
    clamp01((y + (rgb[0] - y) * saturation) * brightness),
    clamp01((y + (rgb[1] - y) * saturation) * brightness),
    clamp01((y + (rgb[2] - y) * saturation) * brightness),
  ];
}

/** 바인드 자세 높이(restY)에 따른 기본 재질 색(상·하의 대표색). */
export function avatarBaseColorAtHeight(
  restY: number,
  upperRgb: RgbTuple,
  lowerRgb?: RgbTuple,
): RgbTuple {
  if (restY >= AVATAR_WAIST_REST_Y) return upperRgb;
  if (lowerRgb) return lowerRgb;
  return [
    clamp01(upperRgb[0] * AVATAR_LOWER_COLOR_FACTOR),
    clamp01(upperRgb[1] * AVATAR_LOWER_COLOR_FACTOR),
    clamp01(upperRgb[2] * AVATAR_LOWER_COLOR_FACTOR),
  ];
}

export interface AvatarCpuSampleInput {
  /** surface_source 부호(0~255). */
  code: number;
  /** 현재 텍셀의 관측 텍스처 색(0~1). */
  texRgb: RgbTuple;
  /** 기본 재질 색(상·하의 대표색, 0~1). */
  baseRgb: RgbTuple;
  /** 표시용 채운 albedo 의 이 텍셀 색(알파 0 이면 null). 미관측·얼굴 미관측·모르는 값에 쓴다. */
  fillRgb?: RgbTuple | null;
  /** 얼굴 표시 정책. */
  facePolicy: AvatarFacePolicy;
  /**
   * BLURRED 정책일 때 주변 텍셀 표본(선택).
   * 제공하지 않으면 현재 텍셀에 채도·명도 완화를 적용한다.
   */
  neighborhood?: readonly { code: number; texRgb: RgbTuple; weight?: number }[];
}

/** 관측 텍스처 색(0~1)이 빈 픽셀(세 채널 모두 AVATAR_FILL_VOID_MAX_RGB/255 이하, -755)인가. */
function isVoidRgb(rgb: RgbTuple): boolean {
  const limit = (AVATAR_FILL_VOID_MAX_RGB + 0.5) / 255;
  return rgb[0] < limit && rgb[1] < limit && rgb[2] < limit;
}

/**
 * 셰이더와 같은 규칙으로 표면 출처 부호와 face_policy 에 따른 최종 색(0~1)을 계산한다.
 * - 2(OBSERVED)·1(INTERPOLATED): 텍스처 색 그대로(-742, 보간 감쇠 없음). 빈 픽셀(-755)이면 채운 색, 없으면 기본 재질 색
 * - 0(UNOBSERVED)·128(얼굴 미관측)·모르는 값(129 포함): 채운 색(fillRgb), 없으면 기본 재질 색(baseRgb)
 * - 130(얼굴 관측): OBSERVED → 관측 텍스처 색, BLURRED → 주변 130 텍셀 가중 평균 + 채도·명도 완화, EXCLUDED → 기본 재질 색
 */
export function evaluateAvatarSurfaceColor(input: AvatarCpuSampleInput): RgbTuple {
  const kind = classifyAvatarSurfaceCode(input.code);
  switch (kind) {
    case 'OBSERVED':
    case 'INTERPOLATED':
      return isVoidRgb(input.texRgb) ? (input.fillRgb ?? input.baseRgb) : input.texRgb;
    case 'FACE_OBSERVED': {
      if (input.facePolicy === 'OBSERVED') {
        return isVoidRgb(input.texRgb) ? (input.fillRgb ?? input.baseRgb) : input.texRgb;
      }
      if (input.facePolicy === 'EXCLUDED') return input.baseRgb;
      // BLURRED: 주변 표본 중 얼굴 관측(130)인 텍셀만 가중 평균해 배경(0)·미관측(128) 색 번짐을 막는다.
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let totalWeight = 0;
      const samples = input.neighborhood ?? [{ code: input.code, texRgb: input.texRgb, weight: 1 }];
      for (const s of samples) {
        if (s.code !== AVATAR_SOURCE_FACE_OBSERVED) continue;
        const w = s.weight ?? 1;
        sumR += s.texRgb[0] * w;
        sumG += s.texRgb[1] * w;
        sumB += s.texRgb[2] * w;
        totalWeight += w;
      }
      const avg: RgbTuple =
        totalWeight > 0
          ? [sumR / totalWeight, sumG / totalWeight, sumB / totalWeight]
          : input.texRgb;
      return adjustSaturationAndBrightness(
        avg,
        AVATAR_FACE_BLUR_SATURATION,
        AVATAR_FACE_BLUR_BRIGHTNESS,
      );
    }
    case 'FACE_UNOBSERVED':
    case 'UNOBSERVED':
    case 'UNKNOWN':
    default:
      return input.fillRgb ?? input.baseRgb;
  }
}

// ---- PNG 인코더·디코더 (외부 패키지 없이 브라우저·Vitest 공용) ----

export interface AvatarPngImage {
  width: number;
  height: number;
  /** 원본 채널 수(1: Grayscale, 3: RGB, 4: RGBA). */
  channels: 1 | 3 | 4;
  /** 항상 RGBA 4채널(width * height * 4)로 펼친 바이트. */
  data: Uint8Array;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(type: Uint8Array, data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < type.length; i++) {
    c = CRC_TABLE[(c ^ type[i]!) & 0xff]! ^ (c >>> 8);
  }
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function writeU32BE(out: Uint8Array, offset: number, value: number) {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function makeChunk(typeStr: string, payload: Uint8Array): Uint8Array {
  const type = new Uint8Array(4);
  for (let i = 0; i < 4; i++) type[i] = typeStr.charCodeAt(i);
  const out = new Uint8Array(12 + payload.length);
  writeU32BE(out, 0, payload.length);
  out.set(type, 4);
  out.set(payload, 8);
  writeU32BE(out, 8 + payload.length, crc32(type, payload));
  return out;
}

/**
 * 8-bit 픽셀 배열을 표준 PNG 바이트로 인코딩한다(시험·dev-harness 합성 텍스처용).
 * colorType: 0(Grayscale, 1채널), 2(RGB, 3채널), 6(RGBA, 4채널).
 */
export function encodeAvatarPng(
  width: number,
  height: number,
  pixels: Uint8Array,
  colorType: 0 | 2 | 6 = 6,
): Uint8Array {
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 4;
  if (width <= 0 || height <= 0 || pixels.length !== width * height * channels) {
    throw new Error('PNG 픽셀 크기가 맞지 않음');
  }
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter 0 (None)
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }

  // zlib non-compressed blocks (CMF=0x78, FLG=0x01)
  const maxBlock = 65535;
  const numBlocks = Math.max(1, Math.ceil(raw.length / maxBlock));
  const zlib = new Uint8Array(2 + numBlocks * 5 + raw.length + 4);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  let pos = 2;
  for (let b = 0; b < numBlocks; b++) {
    const start = b * maxBlock;
    const end = Math.min(raw.length, start + maxBlock);
    const len = end - start;
    const last = b === numBlocks - 1 ? 1 : 0;
    zlib[pos++] = last;
    zlib[pos++] = len & 0xff;
    zlib[pos++] = (len >>> 8) & 0xff;
    const nlen = ~len & 0xffff;
    zlib[pos++] = nlen & 0xff;
    zlib[pos++] = (nlen >>> 8) & 0xff;
    zlib.set(raw.subarray(start, end), pos);
    pos += len;
  }
  writeU32BE(zlib, pos, adler32(raw));

  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, width);
  writeU32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', zlib);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(
    PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let offset = 0;
  out.set(PNG_SIGNATURE, offset);
  offset += PNG_SIGNATURE.length;
  out.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  out.set(idatChunk, offset);
  offset += idatChunk.length;
  out.set(iendChunk, offset);
  return out;
}

function tryInflateStoredZlib(zlib: Uint8Array, expectedLength: number): Uint8Array | null {
  if (zlib.length < 6) return null;
  const cmf = zlib[0]!;
  const flg = zlib[1]!;
  if ((cmf & 0x0f) !== 8 || ((cmf << 8) + flg) % 31 !== 0 || (flg & 0x20) !== 0) return null;
  let pos = 2;
  const out = new Uint8Array(expectedLength);
  let outPos = 0;
  while (pos < zlib.length - 4) {
    const header = zlib[pos++]!;
    const bfinal = header & 1;
    const btype = (header >>> 1) & 3;
    if (btype !== 0) return null; // 압축 블록이면 DecompressionStream 경로로 넘긴다.
    if (pos + 4 > zlib.length - 4) return null;
    const len = zlib[pos]! | (zlib[pos + 1]! << 8);
    const nlen = zlib[pos + 2]! | (zlib[pos + 3]! << 8);
    pos += 4;
    if ((len ^ nlen) !== 0xffff) return null;
    if (pos + len > zlib.length - 4 || outPos + len > expectedLength) return null;
    out.set(zlib.subarray(pos, pos + len), outPos);
    pos += len;
    outPos += len;
    if (bfinal) break;
  }
  return outPos === expectedLength ? out : null;
}

async function inflateZlib(zlib: Uint8Array, expectedLength: number): Promise<Uint8Array> {
  const stored = tryInflateStoredZlib(zlib, expectedLength);
  if (stored) return stored;
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream 미지원 환경');
  }
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  void writer.write(new Uint8Array(zlib));
  void writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  if (total !== expectedLength) {
    throw new Error('PNG 압축 해제 크기 불일치');
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** PNG ArrayBuffer 를 디코딩해 RGBA 8-bit 픽셀 배열로 옮긴다. */
export async function decodeAvatarPng(buffer: ArrayBuffer): Promise<AvatarPngImage> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 33) throw new Error('PNG 바이트가 너무 짧음');
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('유효한 PNG 시그니처가 아님');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let channels: 1 | 3 | 4 = 4;
  let seenIhdr = false;
  let seenIend = false;
  const idatParts: Uint8Array[] = [];
  let idatTotal = 0;

  while (offset + 8 <= bytes.length) {
    const length = readU32BE(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error('PNG 청크 길이 손상');
    const payload = bytes.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      if (payload.length < 13) throw new Error('IHDR 길이 손상');
      width = readU32BE(payload, 0);
      height = readU32BE(payload, 4);
      const bitDepth = payload[8]!;
      const colorType = payload[9]!;
      const interlace = payload[12]!;
      if (width <= 0 || height <= 0) throw new Error('PNG 가로·세로 크기 오류');
      if (bitDepth !== 8 || interlace !== 0) throw new Error('지원하지 않는 PNG 형식');
      if (colorType === 0) channels = 1;
      else if (colorType === 2) channels = 3;
      else if (colorType === 6) channels = 4;
      else throw new Error(`지원하지 않는 PNG colorType: ${colorType}`);
      seenIhdr = true;
    } else if (type === 'IDAT') {
      idatParts.push(payload);
      idatTotal += payload.byteLength;
    } else if (type === 'IEND') {
      seenIend = true;
      break;
    }
    offset = dataEnd + 4;
  }

  if (!seenIhdr || !seenIend || idatTotal === 0) {
    throw new Error('필수 PNG 청크 누락');
  }

  const zlib = new Uint8Array(idatTotal);
  let pos = 0;
  for (const part of idatParts) {
    zlib.set(part, pos);
    pos += part.byteLength;
  }

  const stride = width * channels;
  const expectedRaw = (stride + 1) * height;
  const raw = await inflateZlib(zlib, expectedRaw);
  const unfiltered = new Uint8Array(width * height * channels);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    const prevRowOut = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rowIn + x]!;
      const a = x >= channels ? unfiltered[rowOut + x - channels]! : 0;
      const b = y > 0 ? unfiltered[prevRowOut + x]! : 0;
      const c = x >= channels && y > 0 ? unfiltered[prevRowOut + x - channels]! : 0;
      let recon = rawByte;
      if (filter === 1) recon = (rawByte + a) & 0xff;
      else if (filter === 2) recon = (rawByte + b) & 0xff;
      else if (filter === 3) recon = (rawByte + ((a + b) >>> 1)) & 0xff;
      else if (filter === 4) recon = (rawByte + paethPredictor(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error(`알 수 없는 PNG 필터: ${filter}`);
      unfiltered[rowOut + x] = recon;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  if (channels === 4) {
    rgba.set(unfiltered);
  } else if (channels === 3) {
    for (let i = 0, j = 0; i < unfiltered.length; i += 3, j += 4) {
      rgba[j] = unfiltered[i]!;
      rgba[j + 1] = unfiltered[i + 1]!;
      rgba[j + 2] = unfiltered[i + 2]!;
      rgba[j + 3] = 255;
    }
  } else {
    for (let i = 0, j = 0; i < unfiltered.length; i += 1, j += 4) {
      const v = unfiltered[i]!;
      rgba[j] = v;
      rgba[j + 1] = v;
      rgba[j + 2] = v;
      rgba[j + 3] = 255;
    }
  }

  return { width, height, channels, data: rgba };
}

/** 관측 텍스처(albedo.png): sRGB, 선형 보간, mipmap 없음, glTF 상단 원점(flipY=false). */
export function createAvatarAlbedoTexture(image: AvatarPngImage): DataTexture {
  const texture = new DataTexture(
    image.data,
    image.width,
    image.height,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.name = 'avatar-albedo';
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 셰이더에 묶는 표시용 albedo(-742 채움 결과): sRGB, 삼선형 밉맵(-755). 1024 텍스처가 화면에서 수십~수백 픽셀로 줄어들 때
 * 밉맵 없는 LinearFilter 는 텍셀 하나씩 건너 표본해 점묘처럼 반짝인다. 섬 밖 빈칸은 채우기가 넉넉히 번져 두므로 밉맵에 검정이 섞이지 않는다.
 */
export function createAvatarDisplayAlbedoTexture(image: AvatarPngImage): DataTexture {
  const texture = createAvatarAlbedoTexture(image);
  texture.name = 'avatar-albedo-display';
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

/** 표면 출처 지도(surface_source.png): NoColorSpace, NearestFilter, mipmap 없음(부호 섞임 금지). */
export function createAvatarSurfaceSourceTexture(image: AvatarPngImage): DataTexture {
  const texture = new DataTexture(
    image.data,
    image.width,
    image.height,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.name = 'avatar-surface-source';
  texture.colorSpace = NoColorSpace;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

// ---- 재질 셰이더(onBeforeCompile) ----

const FALLBACK_WHITE_PIXEL = new Uint8Array([255, 255, 255, 255]);
const FALLBACK_ZERO_PIXEL = new Uint8Array([0, 0, 0, 255]);

const EMPTY_ALBEDO_TEXTURE = createAvatarAlbedoTexture({
  width: 1,
  height: 1,
  channels: 4,
  data: FALLBACK_WHITE_PIXEL,
});

const EMPTY_SURFACE_SOURCE_TEXTURE = createAvatarSurfaceSourceTexture({
  width: 1,
  height: 1,
  channels: 1,
  data: FALLBACK_ZERO_PIXEL,
});

export interface AvatarMaterialUniforms {
  uAvatarHasAppearance: { value: number };
  uAvatarFacePolicy: { value: number };
  uAvatarAlbedoMap: { value: DataTexture };
  uAvatarSurfaceSourceMap: { value: DataTexture };
  uAvatarTexSize: { value: Vector2 };
  uAvatarLowerColor: { value: Color };
  uAvatarWaistY: { value: number };
}

export interface AvatarAppearanceTextures {
  key: string;
  worldId: string;
  streamEpoch: number;
  appearanceVersion: number;
  textureUrl: string;
  surfaceSourceUrl: string;
  albedoTexture: DataTexture;
  surfaceSourceTexture: DataTexture;
  width: number;
  height: number;
  /**
   * 셰이더에 넘길 표시용 albedo(미관측·얼굴 미관측을 채운 것, -742). 같은 부위 지도·대칭 대응표(-790)·얼굴 정책이면 다시 계산하지 않고,
   * 바뀌면 이전 것을 해제하고 새로 만든다. dispose() 때 함께 해제한다.
   */
  displayAlbedo(
    facePolicy: AvatarFacePolicy,
    partMap: AvatarUvPartMap | null,
    mirror?: AvatarUvMirrorMap | null,
  ): DataTexture;
  dispose(): void;
}

export function facePolicyCode(policy: AvatarFacePolicy): 0 | 1 | 2 {
  if (policy === 'OBSERVED') return 2;
  if (policy === 'BLURRED') return 1;
  return 0;
}

function createAvatarUniforms(): AvatarMaterialUniforms {
  return {
    uAvatarHasAppearance: { value: 0 },
    uAvatarFacePolicy: { value: 0 },
    uAvatarAlbedoMap: { value: EMPTY_ALBEDO_TEXTURE },
    uAvatarSurfaceSourceMap: { value: EMPTY_SURFACE_SOURCE_TEXTURE },
    uAvatarTexSize: { value: new Vector2(256, 256) },
    uAvatarLowerColor: { value: new Color(0x5a6478) },
    uAvatarWaistY: { value: AVATAR_WAIST_REST_Y },
  };
}

export function getAvatarMaterialUniforms(material: Material): AvatarMaterialUniforms | null {
  return (
    (material.userData?.avatarAppearanceUniforms as AvatarMaterialUniforms | undefined) ?? null
  );
}

/**
 * 아바타 MeshStandardMaterial 에 표면 출처 기반 텍스처 합성 셰이더(onBeforeCompile)와 PBR 값을 붙인다.
 * - 관절(Joints) 재질은 대상에서 제외한다.
 * - 셰이더 프로그램 캐시 키를 고정하고 uniform 만 갱신해 appearance_version 교체 시 재컴파일 깜빡임을 막는다.
 */
export function attachAvatarAppearanceShader(material: Material): void {
  const m = material as MeshStandardMaterial;
  if (/joints/i.test(m.name)) return;
  const uniforms = createAvatarUniforms();
  m.userData = {
    ...m.userData,
    avatarAppearanceUniforms: uniforms,
  };
  if ('roughness' in m) m.roughness = AVATAR_PBR_ROUGHNESS;
  if ('metalness' in m) m.metalness = AVATAR_PBR_METALNESS;
  if ('envMapIntensity' in m) m.envMapIntensity = AVATAR_ENV_MAP_INTENSITY;

  m.customProgramCacheKey = () => 'simai-avatar-appearance-v1';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vAvatarUv;
varying float vAvatarRestY;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vAvatarUv = uv;
vAvatarRestY = position.y;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform int uAvatarHasAppearance;
uniform int uAvatarFacePolicy;
uniform sampler2D uAvatarAlbedoMap;
uniform sampler2D uAvatarSurfaceSourceMap;
uniform vec2 uAvatarTexSize;
uniform vec3 uAvatarLowerColor;
uniform float uAvatarWaistY;
varying vec2 vAvatarUv;
varying float vAvatarRestY;

vec3 simaiAdjustSatBright(vec3 rgb, float sat, float bright) {
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  return clamp(mix(vec3(luma), rgb, sat) * bright, 0.0, 1.0);
}

int simaiReadSurfaceCode(vec2 uvCoord) {
  vec4 raw = texture2D(uAvatarSurfaceSourceMap, clamp(uvCoord, 0.0, 1.0));
  return int(floor(raw.r * 255.0 + 0.5));
}

vec3 simaiSampleBlurredFace(vec2 uvCoord, vec3 centerRgb) {
  vec2 stepUv = vec2(${AVATAR_FACE_BLUR_STEP_TEXELS.toFixed(1)}) / max(uAvatarTexSize, vec2(1.0));
  vec3 acc = vec3(0.0);
  float wSum = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 tapUv = clamp(uvCoord + vec2(float(dx), float(dy)) * stepUv, 0.0, 1.0);
      int tapCode = simaiReadSurfaceCode(tapUv);
      if (tapCode == 130) {
        float w = (dx == 0 && dy == 0) ? 4.0 : ((dx == 0 || dy == 0) ? 2.0 : 1.0);
        acc += texture2D(uAvatarAlbedoMap, tapUv).rgb * w;
        wSum += w;
      }
    }
  }
  vec3 avg = (wSum > 0.0) ? (acc / wSum) : centerRgb;
  return simaiAdjustSatBright(avg, ${AVATAR_FACE_BLUR_SATURATION.toFixed(2)}, ${AVATAR_FACE_BLUR_BRIGHTNESS.toFixed(2)});
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 simaiBaseColor = (vAvatarRestY >= uAvatarWaistY) ? diffuseColor.rgb : uAvatarLowerColor;
if (uAvatarHasAppearance == 1) {
  int simaiCode = simaiReadSurfaceCode(vAvatarUv);
  // 표시용 채운 albedo(-742·-755): 알파 1 은 관측·보간 원색 또는 채운 색(빈 픽셀 포함), 알파 0 은 기본 재질 색.
  vec4 simaiTex = texture2D(uAvatarAlbedoMap, vAvatarUv);
  vec3 simaiTexRgb = simaiTex.rgb;
  vec3 simaiFilled = mix(simaiBaseColor, simaiTexRgb, simaiTex.a);
  if (simaiCode == 2 || simaiCode == 1) {
    diffuseColor.rgb = simaiFilled;
  } else if (simaiCode == 130) {
    if (uAvatarFacePolicy == 2) {
      diffuseColor.rgb = simaiFilled;
    } else if (uAvatarFacePolicy == 1) {
      diffuseColor.rgb = simaiSampleBlurredFace(vAvatarUv, simaiTexRgb);
    } else {
      diffuseColor.rgb = simaiBaseColor;
    }
  } else {
    // 0(UNOBSERVED)·128(얼굴 미관측)·129·모르는 값: 같은 부위 관측 색·피부 단색으로 채운 색, 못 채웠으면 기본 재질 색
    diffuseColor.rgb = simaiFilled;
  }
} else {
  diffuseColor.rgb = simaiBaseColor;
}`,
      );
  };
}

/** 외형 텍스처 크기에 맞는 메시 UV 부위 지도(메시가 없으면 null). */
export function avatarPartMapFor(
  appearance: AvatarAppearanceTextures,
  meshScene: Object3D | null | undefined,
): AvatarUvPartMap | null {
  if (!meshScene) return null;
  const grid = avatarFillGridSize(appearance.width, appearance.height);
  return avatarUvPartMapForScene(meshScene, grid.width, grid.height, AVATAR_WAIST_REST_Y);
}

/** 외형 텍스처 크기에 맞는 메시 좌우 대칭 대응표(-790). 메시가 없거나 대칭 채움을 끄면 null. */
export function avatarMirrorMapFor(
  appearance: AvatarAppearanceTextures,
  meshScene: Object3D | null | undefined,
  enabled: boolean = AVATAR_FILL_MIRROR_ENABLED,
): AvatarUvMirrorMap | null {
  if (!meshScene || !enabled) return null;
  return avatarUvMirrorMapForScene(meshScene, appearance.width, appearance.height);
}

/**
 * 아바타 재질 목록에 현재 외형 텍스처·표면 출처 지도·얼굴 정책·환경맵을 반영한다.
 * meshScene(아바타 자산 장면)을 주면 미관측 몸 텍셀을 좌우 대칭 관측 색으로 먼저 채우고(-790),
 * 남은 곳은 그 UV 섬·상하 부위 안에서 채운다(-742).
 */
export function applyAvatarAppearanceToMaterials(
  materials: readonly Material[],
  appearance: AvatarAppearanceTextures | null,
  facePolicy: AvatarFacePolicy,
  envMap: Texture | null = null,
  meshScene: Object3D | null = null,
): void {
  const policyNum = facePolicyCode(facePolicy);
  const albedo = appearance
    ? appearance.displayAlbedo(
        facePolicy,
        avatarPartMapFor(appearance, meshScene),
        avatarMirrorMapFor(appearance, meshScene),
      )
    : null;
  for (const material of materials) {
    const m = material as MeshStandardMaterial;
    if ('envMap' in m && m.envMap !== envMap) {
      m.envMap = envMap;
      m.envMapIntensity = AVATAR_ENV_MAP_INTENSITY;
      m.needsUpdate = true;
    }
    const uniforms = getAvatarMaterialUniforms(m);
    if (!uniforms) continue;
    if (appearance && albedo) {
      uniforms.uAvatarHasAppearance.value = 1;
      uniforms.uAvatarFacePolicy.value = policyNum;
      uniforms.uAvatarAlbedoMap.value = albedo;
      uniforms.uAvatarSurfaceSourceMap.value = appearance.surfaceSourceTexture;
      uniforms.uAvatarTexSize.value.set(appearance.width, appearance.height);
    } else {
      uniforms.uAvatarHasAppearance.value = 0;
      uniforms.uAvatarFacePolicy.value = policyNum;
      uniforms.uAvatarAlbedoMap.value = EMPTY_ALBEDO_TEXTURE;
      uniforms.uAvatarSurfaceSourceMap.value = EMPTY_SURFACE_SOURCE_TEXTURE;
    }
  }
}

/** 기본 재질의 상·하의 대표색 uniform 을 갱신한다. */
export function updateAvatarBaseColors(
  materials: readonly Material[],
  upperHex: number,
  tone: PersonTone,
  selected: boolean,
): void {
  for (const material of materials) {
    const uniforms = getAvatarMaterialUniforms(material);
    if (!uniforms) continue;
    uniforms.uAvatarLowerColor.value.setHex(upperHex);
    if (!selected && tone !== 'unknown') {
      uniforms.uAvatarLowerColor.value.multiplyScalar(AVATAR_LOWER_COLOR_FACTOR);
    }
  }
}

// ---- people/ 전용 PMREM 환경맵 ----

export interface AvatarPmremHandle {
  texture: Texture;
  dispose(): void;
}

function createFallbackEnvDataTexture(): DataTexture {
  const width = 16;
  const height = 8;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const t = y / Math.max(1, height - 1);
    // 위쪽(하늘/천장)은 부드러운 밝은 청백색, 아래쪽(바닥 반사)은 차분한 슬레이트 톤
    const r = Math.round(68 + (195 - 68) * (1 - t));
    const g = Math.round(78 + (210 - 78) * (1 - t));
    const b = Math.round(98 + (232 - 98) * (1 - t));
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  tex.name = 'avatar-pmrem-fallback';
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 아바타 재질에만 넣을 소형 PMREM 환경맵을 만든다.
 * 장면 전역 조명이나 scene.environment 는 건드리지 않는다.
 * 가짜 renderer(Vitest)처럼 WebGLRenderTarget 이 없는 환경에서는 절차적 DataTexture 로 안전하게 대체한다.
 */
export function createAvatarPmremEnvMap(
  gl: Partial<WebGLRenderer> | null | undefined,
): AvatarPmremHandle {
  if (
    gl &&
    typeof gl.getRenderTarget === 'function' &&
    typeof gl.setRenderTarget === 'function' &&
    typeof gl.getContext === 'function'
  ) {
    try {
      const envScene = new ThreeScene();
      const skyGeo = new SphereGeometry(10, 16, 12);
      const skyMat = new MeshBasicMaterial({ color: 0x9fb3d9, side: BackSide });
      const skyDome = new Mesh(skyGeo, skyMat);
      envScene.add(skyDome);
      envScene.add(new HemisphereLight(0xdbeafe, 0x334155, 1.4));
      envScene.add(new AmbientLight(0xffffff, 0.6));
      const keyLight = new DirectionalLight(0xffffff, 1.2);
      keyLight.position.set(3, 6, 4);
      envScene.add(keyLight);

      const generator = new PMREMGenerator(gl as WebGLRenderer);
      const target = generator.fromScene(envScene, 0.04);
      skyGeo.dispose();
      skyMat.dispose();
      generator.dispose();
      target.texture.name = 'avatar-pmrem-env';
      return {
        texture: target.texture,
        dispose() {
          target.dispose();
        },
      };
    } catch {
      // 헤드리스·가짜 WebGL 문맥에서는 아래 절차적 환경 텍스처로 이어간다.
    }
  }
  const fallback = createFallbackEnvDataTexture();
  return {
    texture: fallback,
    dispose() {
      fallback.dispose();
    },
  };
}

/** PersonLayer 안에서 아바타 전용 환경맵을 한 번 만들고 언마운트 때 해제한다. */
export function useAvatarPmremEnvMap(): Texture {
  const gl = useThree((s) => s.gl);
  const handle = useMemo(() => createAvatarPmremEnvMap(gl), [gl]);
  useEffect(() => {
    return () => {
      handle.dispose();
    };
  }, [handle]);
  return handle.texture;
}

// ---- 사람별 외형 자산 로더와 생명주기(appearance_version 교체·실패 재시도·해제) ----

export interface AvatarAppearanceRequest {
  worldId: string;
  streamEpoch: number;
  appearanceVersion: number;
  textureUrl: string;
  surfaceSourceUrl: string;
}

export function avatarAppearanceRequestOf(
  worldId: string,
  avatar: AvatarPoseView | undefined,
): AvatarAppearanceRequest | null {
  const asset = avatar?.asset;
  if (!avatar || !asset || !asset.textureUrl || !asset.surfaceSourceUrl) return null;
  return {
    worldId,
    streamEpoch: asset.streamEpoch,
    appearanceVersion: avatar.appearanceVersion,
    textureUrl: asset.textureUrl,
    surfaceSourceUrl: asset.surfaceSourceUrl,
  };
}

/** 외형 요청의 정체(사람·세대·판·두 파일 주소). 판이 key 에 들어가 옛 판을 새 판으로 잘못 다시 쓰지 않는다. */
const appearanceRequestKey = (req: AvatarAppearanceRequest) =>
  `${req.worldId}|${req.streamEpoch}|${req.appearanceVersion}|${req.textureUrl}|${req.surfaceSourceUrl}`;

export function avatarAppearanceKey(
  worldId: string,
  avatar: AvatarPoseView | undefined,
): string | null {
  const req = avatarAppearanceRequestOf(worldId, avatar);
  return req ? appearanceRequestKey(req) : null;
}

/**
 * 표시용 albedo 바이트를 만든다. 좌우 대칭 채움(-790)이 실패하면 경고를 남기고 대칭 없이 다시 채운다.
 * 그것도 실패하면 관측·보간·얼굴 관측만 남기고 나머지는 기본 재질 색으로 그린다.
 */
export function buildAvatarDisplayAlbedo(
  albedoImg: AvatarPngImage,
  sourceImg: AvatarPngImage,
  facePolicy: AvatarFacePolicy,
  partMap: AvatarUvPartMap | null,
  req: Pick<AvatarAppearanceRequest, 'worldId' | 'appearanceVersion'>,
  mirror: AvatarUvMirrorMap | null = null,
  fill: (input: AvatarFillInput) => { data: Uint8Array } = fillAvatarAlbedo,
): Uint8Array {
  const input: AvatarFillInput = {
    width: albedoImg.width,
    height: albedoImg.height,
    albedo: albedoImg.data,
    source: sourceImg.data,
    sourceWidth: sourceImg.width,
    sourceHeight: sourceImg.height,
    facePolicy,
    partMap,
    mirror,
  };
  const warn = (what: string, err: unknown) =>
    console.warn(
      `[viewer3d] 아바타 외형 ${what} (${req.worldId} v${req.appearanceVersion}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  if (mirror) {
    try {
      return fill(input).data;
    } catch (err) {
      warn('좌우 대칭 채우기 실패, 대칭 없이 채움', err);
    }
  }
  try {
    return fill({ ...input, mirror: null }).data;
  } catch (err) {
    warn('채우기 실패', err);
    return maskUnfilledAvatarAlbedo(input);
  }
}

/** texture_url 과 surface_source_url 두 파일을 받아 DataTexture 쌍으로 만든다. 하나라도 실패하면 부분 자원을 정리하고 예외를 던진다. */
export async function loadAvatarAppearanceTextures(
  req: AvatarAppearanceRequest,
  fetcher: AvatarMeshFetch,
): Promise<AvatarAppearanceTextures> {
  const [albedoBytes, sourceBytes] = await Promise.all([
    fetcher(req.textureUrl),
    fetcher(req.surfaceSourceUrl),
  ]);
  const [albedoImg, sourceImg] = await Promise.all([
    decodeAvatarPng(albedoBytes),
    decodeAvatarPng(sourceBytes),
  ]);
  const albedoTexture = createAvatarAlbedoTexture(albedoImg);
  let surfaceSourceTexture: DataTexture | null = null;
  try {
    surfaceSourceTexture = createAvatarSurfaceSourceTexture(sourceImg);
  } catch (err) {
    albedoTexture.dispose();
    throw err;
  }
  const key = appearanceRequestKey(req);
  let disposed = false;
  let display: {
    facePolicy: AvatarFacePolicy;
    partMap: AvatarUvPartMap | null;
    mirror: AvatarUvMirrorMap | null;
    texture: DataTexture;
  } | null = null;
  return {
    key,
    worldId: req.worldId,
    streamEpoch: req.streamEpoch,
    appearanceVersion: req.appearanceVersion,
    textureUrl: req.textureUrl,
    surfaceSourceUrl: req.surfaceSourceUrl,
    albedoTexture,
    surfaceSourceTexture,
    width: albedoImg.width,
    height: albedoImg.height,
    displayAlbedo(facePolicy, partMap, mirror = null) {
      if (
        display &&
        display.facePolicy === facePolicy &&
        display.partMap === partMap &&
        display.mirror === mirror
      ) {
        return display.texture;
      }
      const texture = createAvatarDisplayAlbedoTexture({
        width: albedoImg.width,
        height: albedoImg.height,
        channels: 4,
        data: buildAvatarDisplayAlbedo(albedoImg, sourceImg, facePolicy, partMap, req, mirror),
      });
      display?.texture.dispose();
      display = { facePolicy, partMap, mirror, texture };
      return texture;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      albedoTexture.dispose();
      surfaceSourceTexture?.dispose();
      display?.texture.dispose();
      display = null;
    },
  };
}

// ---- 외형 자산 캐시(-797): 요청 정체별로 한 번만 받고, 아무도 쓰지 않은 뒤 AVATAR_ASSET_RELEASE_MS 동안 남긴다 ----

interface AppearanceEntry extends AvatarCacheEntry {
  loaded: Promise<AvatarAppearanceTextures>;
  appearance: AvatarAppearanceTextures | null;
  /** 읽기가 끝나기 전에 캐시에서 빠졌다. 늦게 끝난 자산은 받자마자 해제한다. */
  evicted: boolean;
}

const appearanceCache = createAvatarAssetCache<AppearanceEntry>((entry) => {
  entry.evicted = true;
  entry.appearance?.dispose();
  entry.appearance = null;
});

/** 캐시에서 빌린 외형 자산. release 는 여러 번 불러도 한 번만 놓는다. */
export interface AvatarAppearanceLease {
  key: string;
  loaded: Promise<AvatarAppearanceTextures>;
  release(): void;
}

/**
 * 같은 요청 정체의 외형 자산을 빌린다. 읽는 중이면 그 읽기를 함께 기다린다(두 화면이 같은 자산을 동시에 열어도 한 번만 받는다).
 * 실패한 읽기는 캐시에 남기지 않아 다음 시도가 다시 받는다. GPU 텍스처는 캐시에서 빠질 때만 해제한다.
 */
export function acquireAvatarAppearance(
  req: AvatarAppearanceRequest,
  fetcher: AvatarMeshFetch,
): AvatarAppearanceLease {
  const key = appearanceRequestKey(req);
  let entry = appearanceCache.map.get(key);
  if (!entry) {
    const created: AppearanceEntry = {
      refs: 0,
      timer: null,
      idleSeq: 0,
      appearance: null,
      evicted: false,
      loaded: Promise.resolve(null as never),
    };
    created.loaded = loadAvatarAppearanceTextures(req, fetcher).then(
      (appearance) => {
        if (created.evicted) appearance.dispose();
        else created.appearance = appearance;
        return appearance;
      },
      (err: unknown) => {
        if (appearanceCache.map.get(key) === created) appearanceCache.map.delete(key);
        throw err;
      },
    );
    // 빌린 쪽이 모두 떠난 뒤 실패해도 처리되지 않은 거부로 남지 않게 한다.
    created.loaded.catch(() => {});
    appearanceCache.map.set(key, created);
    entry = created;
  }
  appearanceCache.retain(key);
  const held = entry;
  let released = false;
  return {
    key,
    loaded: held.loaded,
    release() {
      if (released) return;
      released = true;
      if (appearanceCache.map.get(key) === held) appearanceCache.release(key);
    },
  };
}

/** 시험용: 외형 캐시를 비우고 모든 텍스처를 해제한다. */
export function clearAvatarAppearanceCache() {
  appearanceCache.clear();
}

interface HeldAppearance {
  appearance: AvatarAppearanceTextures;
  release(): void;
}

export type AvatarAppearanceStatus = 'NONE' | 'LOADING' | 'READY' | 'ERROR';

export interface UseAvatarAppearanceResult {
  status: AvatarAppearanceStatus;
  appearance: AvatarAppearanceTextures | null;
}

/**
 * 사람(worldId)별 외형 텍스처를 읽고 관리한다.
 * - 같은 사람의 같은 appearance_version 은 한 번만 받는다.
 * - 다른 world_id 와 텍스처를 절대 공유하지 않는다(사람별 외형 자산).
 * - appearance_version 이 바뀌면 새 텍스처를 다 읽을 때까지 이전 텍스처를 유지해 깜빡임을 막고, 새 텍스처가 재질에 들어간 커밋 뒤에
 *   이전 텍스처를 캐시에 돌려준다(-755: 그 전에 해제하면 사이 프레임이 해제된 텍스처를 GPU 에 다시 올려 남긴다).
 * - 텍스처는 화면이 사라져도 바로 해제하지 않고 캐시에 돌려준다(-797). 작업 시작으로 3D 가 다시 마운트되면 다시 받지 않고 그대로 쓴다.
 * - 둘 중 하나라도 실패하면 기본 재질(appearance = null)로 그리고 AVATAR_ASSET_RETRY_MS 뒤 다시 시도한다.
 */
export function useAvatarAppearance(
  worldId: string,
  appearanceKey: string | null,
  getAvatar: () => AvatarPoseView | undefined,
  fetcher: AvatarMeshFetch,
): UseAvatarAppearanceResult {
  const [retry, setRetry] = useState(0);
  const [viewState, setViewState] = useState<{
    worldId: string;
    status: AvatarAppearanceStatus;
    appearance: AvatarAppearanceTextures | null;
  }>({
    worldId,
    status: 'NONE',
    appearance: null,
  });
  const readAvatar = useEffectEvent(getAvatar);
  const activeRef = useRef<HeldAppearance | null>(null);
  // 교체·실패로 물러났지만 아직 재질에 묶여 있을 수 있는 자산. 다음 커밋(자식 MeshBody 가 새 텍스처를 묶은 뒤)에 캐시에 돌려준다.
  const retiredRef = useRef<HeldAppearance[]>([]);

  // worldId 가 바뀌거나 언마운트되면 이전 사람의 외형 자산을 놓는다. 캐시 key 에 worldId 가 있어 다른 ID 가 이어받지 않는다(ID 분리 시 유산 금지).
  useEffect(() => {
    return () => {
      activeRef.current?.release();
      activeRef.current = null;
      for (const old of retiredRef.current) old.release();
      retiredRef.current = [];
    };
  }, [worldId]);

  // 부모 효과는 자식 효과 뒤에 돈다: 이 커밋에서 MeshBody 가 새 외형(또는 기본 재질)을 묶은 다음 물러난 자산을 놓는다.
  useEffect(() => {
    if (retiredRef.current.length === 0) return;
    const retired = retiredRef.current;
    retiredRef.current = [];
    for (const old of retired) {
      if (old.appearance !== viewState.appearance) old.release();
      else retiredRef.current.push(old);
    }
  }, [viewState]);

  useEffect(() => {
    const avatar = readAvatar();
    const req = avatarAppearanceRequestOf(worldId, avatar);
    if (!appearanceKey || !req) {
      activeRef.current?.release();
      activeRef.current = null;
      return;
    }

    // 같은 worldId·streamEpoch·appearanceVersion 이 이미 준비되어 있으면 다시 받지 않는다.
    if (activeRef.current?.appearance.key === appearanceKey) {
      return;
    }

    // streamEpoch 가 바뀌었으면 이전 세대 텍스처는 유지하지 않는다(새 텍스처가 묶인 뒤 놓음).
    if (activeRef.current && activeRef.current.appearance.streamEpoch !== req.streamEpoch) {
      retiredRef.current.push(activeRef.current);
      activeRef.current = null;
    }

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const lease = acquireAvatarAppearance(req, fetcher);
    void lease.loaded
      .then((loaded) => {
        if (!alive) {
          lease.release();
          return;
        }
        const prev = activeRef.current;
        activeRef.current = { appearance: loaded, release: lease.release };
        if (prev && prev.appearance !== loaded) retiredRef.current.push(prev);
        else prev?.release();
        setViewState({
          worldId,
          status: 'READY',
          appearance: loaded,
        });
      })
      .catch((err: unknown) => {
        lease.release();
        if (!alive) return;
        console.warn(
          `[viewer3d] 아바타 외형 텍스처 읽기 실패 (${req.worldId} v${req.appearanceVersion}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        // 읽기 실패 시 기본 재질(상·하의 대표색)로 그리고 일정 간격 뒤 다시 시도한다.
        if (activeRef.current) {
          retiredRef.current.push(activeRef.current);
          activeRef.current = null;
        }
        setViewState({
          worldId,
          status: 'ERROR',
          appearance: null,
        });
        timer = setTimeout(() => setRetry((n) => n + 1), AVATAR_ASSET_RETRY_MS);
      });

    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [worldId, appearanceKey, fetcher, retry]);

  if (!appearanceKey || viewState.worldId !== worldId) {
    return { status: 'NONE', appearance: null };
  }
  return {
    status: viewState.status,
    appearance: viewState.appearance,
  };
}
