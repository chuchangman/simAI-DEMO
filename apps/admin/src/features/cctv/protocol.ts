import {
  frameHeaderSchema,
  previewTextSchema,
  type FrameHeader,
  type PreviewText,
} from '@/features/cctv/types';
import { NAL, NAL_TYPE_MASK } from '@/features/clips/constants';

// 미리보기 메시지 해석과 H.264 Annex B 다루기. 디코더·소켓 없이 시험한다.

/** 텍스트 메시지(JSON). 계약에 맞지 않으면 null(그 메시지만 버린다). */
export function parseText(data: string): PreviewText | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  const result = previewTextSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export interface PreviewFrame {
  header: FrameHeader;
  /** H.264 접근 단위(Annex B, 중계가 받은 그대로). */
  data: Uint8Array;
}

const decoder = new TextDecoder();

/** 이진 메시지 맨 앞의 헤더 길이 칸(u32 BE)의 바이트 수. */
const LENGTH_PREFIX_BYTES = 4;

/** 이진 메시지 = 헤더 길이(u32 BE) | I0 frame_header JSON | 접근 단위. 틀리면 null. */
export function parseFrame(buffer: ArrayBuffer): PreviewFrame | null {
  if (buffer.byteLength < LENGTH_PREFIX_BYTES) return null;
  const length = new DataView(buffer).getUint32(0);
  if (length === 0 || LENGTH_PREFIX_BYTES + length > buffer.byteLength) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(new Uint8Array(buffer, LENGTH_PREFIX_BYTES, length)));
  } catch {
    return null;
  }
  const header = frameHeaderSchema.safeParse(raw);
  if (!header.success) return null;
  return { header: header.data, data: new Uint8Array(buffer, LENGTH_PREFIX_BYTES + length) };
}

export function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/** Annex B 접근 단위 안의 NAL 종류들(3·4바이트 시작 코드). */
export function nalTypes(data: Uint8Array): number[] {
  const types: number[] = [];
  for (let i = 0; i + 3 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      types.push(data[i + 3] & NAL_TYPE_MASK);
      i += 2;
    }
  }
  return types;
}

const START = Uint8Array.of(0, 0, 0, 1);

/**
 * 키프레임에 SPS·PPS 가 없으면 codec 의 것을 앞에 붙인다. description(avcC) 없이 Annex B 로 넣는 디코더는
 * 키프레임 안의 SPS·PPS 로 설정을 읽는다. 이미 있으면 그대로 돌려준다.
 */
export function withParameterSets(data: Uint8Array, sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const types = nalTypes(data);
  if (types.includes(NAL.SPS) && types.includes(NAL.PPS)) return data;
  const out = new Uint8Array(START.length * 2 + sps.length + pps.length + data.length);
  let at = 0;
  for (const part of [START, sps, START, pps, data]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** 마지막으로 그린 프레임의 나이(초). 노트북의 중계와 브라우저가 같은 기계라 벽시계로 비교한다. */
export function frameAgeSec(lastCaptureMs: number | undefined, now: number): number | undefined {
  return lastCaptureMs === undefined || now < lastCaptureMs
    ? undefined
    : (now - lastCaptureMs) / 1000;
}
