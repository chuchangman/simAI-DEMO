import {
  frameAgeSec,
  nalTypes,
  parseFrame,
  parseText,
  withParameterSets,
} from '@/features/cctv/protocol';
import { describe, expect, it } from 'vitest';

// 계약 예시·반례(저장소 루트 contracts/examples)를 그대로 넣어 zod 해석이 계약과 어긋나지 않는지 본다.
const valid = import.meta.glob<Record<string, unknown>>(
  '../../../../../../../contracts/examples/cctv_preview*.json',
  { eager: true, import: 'default' },
);
const invalid = import.meta.glob<Record<string, unknown>>(
  '../../../../../../../contracts/examples/invalid/cctv_preview.*.json',
  { eager: true, import: 'default' },
);
const frameHeaderExample = import.meta.glob<Record<string, unknown>>(
  '../../../../../../../contracts/examples/frame_header.json',
  { eager: true, import: 'default' },
);

const withoutMeta = (doc: Record<string, unknown>) =>
  JSON.stringify(Object.fromEntries(Object.entries(doc).filter(([k]) => !k.startsWith('_'))));

function frameBuffer(header: unknown, data: Uint8Array): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + json.length + data.length);
  new DataView(out.buffer).setUint32(0, json.length);
  out.set(json, 4);
  out.set(data, 4 + json.length);
  return out.buffer;
}

describe('미리보기 텍스트 메시지', () => {
  it('계약 예시는 받고 반례는 버린다', () => {
    expect(Object.keys(valid).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(invalid).length).toBeGreaterThanOrEqual(4);
    for (const [path, doc] of Object.entries(valid)) {
      expect(parseText(withoutMeta(doc)), path).not.toBeNull();
    }
    for (const [path, doc] of Object.entries(invalid)) {
      expect(parseText(withoutMeta(doc)), path).toBeNull();
    }
  });

  it('JSON 이 아니거나 모르는 종류면 버린다', () => {
    expect(parseText('not json')).toBeNull();
    expect(parseText(JSON.stringify({ kind: 'bye', protocol: 'simai-cctv-preview/1' }))).toBeNull();
    expect(
      parseText(
        JSON.stringify({ kind: 'hello', protocol: 'simai-cctv-preview/1', cameras: ['a', 'a'] }),
      ),
    ).toBeNull();
  });
});

describe('미리보기 이진 메시지', () => {
  const header = Object.values(frameHeaderExample)[0];

  it('헤더 길이 | I0 frame_header | 접근 단위로 나눈다', () => {
    const au = Uint8Array.of(0, 0, 0, 1, 0x65, 1, 2, 3);
    const frame = parseFrame(frameBuffer(header, au));
    expect(frame?.header.camera_id).toBe('cam_A');
    expect(frame?.header.keyframe).toBe(true);
    expect(Array.from(frame!.data)).toEqual(Array.from(au));
  });

  it('길이가 넘치거나 헤더가 계약과 다르면 버린다', () => {
    expect(parseFrame(new ArrayBuffer(2))).toBeNull();
    const broken = new Uint8Array(frameBuffer(header, new Uint8Array()));
    new DataView(broken.buffer).setUint32(0, 9999);
    expect(parseFrame(broken.buffer)).toBeNull();
    expect(parseFrame(frameBuffer({ ...header, keyframe: 'yes' }, new Uint8Array()))).toBeNull();
  });
});

describe('Annex B', () => {
  const sps = Uint8Array.of(0x67, 0x64, 0x00, 0x2a);
  const pps = Uint8Array.of(0x68, 0xee);

  it('키프레임에 SPS·PPS 가 없으면 앞에 붙이고 있으면 그대로 둔다', () => {
    const idr = Uint8Array.of(0, 0, 0, 1, 0x65, 0x88);
    const fixed = withParameterSets(idr, sps, pps);
    expect(nalTypes(fixed)).toEqual([7, 8, 5]);
    expect(withParameterSets(fixed, sps, pps)).toBe(fixed);
    expect(nalTypes(Uint8Array.of(0, 0, 1, 0x67, 0, 0, 1, 0x68, 0, 0, 1, 0x65))).toEqual([7, 8, 5]);
  });
});

describe('프레임 나이', () => {
  it('촬영 시각과 지금의 차이(초), 없으면 비운다', () => {
    expect(frameAgeSec(undefined, 1000)).toBeUndefined();
    expect(frameAgeSec(1000, 1300)).toBeCloseTo(0.3);
    expect(frameAgeSec(1300, 1000)).toBeUndefined();
  });
});
