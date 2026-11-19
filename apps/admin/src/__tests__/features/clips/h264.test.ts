import { NAL } from '@/features/clips/constants';
import {
  buildAvcC,
  H264Error,
  nalType,
  parseAnnexB,
  parseSps,
  splitNalUnits,
  unescapeRbsp,
} from '@/features/clips/h264';
import { annexB, buildPps, buildSps, buildTestH264Stream } from '@/mocks/h264TestStream';
import { describe, expect, it } from 'vitest';

const bytes = (...values: number[]) => Uint8Array.from(values);
const hex = (text: string) =>
  Uint8Array.from(text.split(/\s+/).map((byte) => Number.parseInt(byte, 16)));

describe('splitNalUnits', () => {
  it('3바이트·4바이트 시작 코드로 나누고 시작 코드와 뒤따르는 0 은 뺀다', () => {
    const data = bytes(
      ...[0, 0, 0, 1, 0x67, 0xaa, 0xbb],
      ...[0, 0, 1, 0x68, 0xcc],
      ...[0, 0, 0, 0, 1, 0x65, 0x11, 0x22],
    );
    expect(splitNalUnits(data).map((nal) => [...nal])).toEqual([
      [0x67, 0xaa, 0xbb],
      [0x68, 0xcc],
      [0x65, 0x11, 0x22],
    ]);
  });

  it('첫 시작 코드 앞의 바이트는 버리고, 시작 코드가 없으면 비어 있다', () => {
    expect(splitNalUnits(bytes(9, 9, 0, 0, 1, 0x41, 7)).map((nal) => [...nal])).toEqual([
      [0x41, 7],
    ]);
    expect(splitNalUnits(bytes(1, 2, 3, 4, 5))).toEqual([]);
    expect(splitNalUnits(new Uint8Array())).toEqual([]);
  });

  it('NAL 안의 00 00 03 은 시작 코드가 아니고, 끝의 00 00 은 다음 시작 코드의 앞이다', () => {
    const data = bytes(0, 0, 0, 1, 0x41, 0, 0, 3, 1, 0, 0, 0, 1, 0x41, 5);
    expect(splitNalUnits(data).map((nal) => [...nal])).toEqual([
      [0x41, 0, 0, 3, 1],
      [0x41, 5],
    ]);
  });

  it('빈 NAL(시작 코드가 연달아 온 곳)은 건너뛴다', () => {
    expect(splitNalUnits(bytes(0, 0, 1, 0, 0, 1, 0x41, 1)).map((nal) => [...nal])).toEqual([
      [0x41, 1],
    ]);
  });
});

describe('unescapeRbsp', () => {
  it('00 00 03 의 03 을 뺀다', () => {
    expect([...unescapeRbsp(bytes(1, 0, 0, 3, 0, 0, 3, 3, 5))]).toEqual([1, 0, 0, 0, 0, 3, 5]);
  });
  it('00 뒤 03 은 그대로다', () => {
    expect([...unescapeRbsp(bytes(0, 3, 0, 3))]).toEqual([0, 3, 0, 3]);
  });
});

// x264 가 1080p High 프로파일로 만드는 SPS(자르기 4줄, 레벨 4.0).
const SPS_1080P = hex(
  '67 64 00 28 ac d9 40 78 02 27 e5 c0 44 00 00 03 00 04 00 00 03 00 f0 3c 60 c6 58',
);

describe('parseSps', () => {
  it('시험 스트림의 베이스라인 SPS 에서 크기와 프로파일을 읽는다', () => {
    expect(parseSps(buildSps(10, 6))).toEqual({
      profileIdc: 66,
      profileCompatibility: 0xc0,
      levelIdc: 30,
      chromaFormatIdc: 1,
      bitDepthLuma: 8,
      bitDepthChroma: 8,
      width: 160,
      height: 96,
    });
  });

  it('큰 크기도 읽는다(ue(v) 가 여러 바이트)', () => {
    expect(parseSps(buildSps(120, 68))).toMatchObject({ width: 1920, height: 1088 });
  });

  it('High 프로파일 SPS 의 자르기를 적용한다(1920x1088 → 1920x1080)', () => {
    expect(parseSps(SPS_1080P)).toMatchObject({
      profileIdc: 100,
      levelIdc: 40,
      chromaFormatIdc: 1,
      bitDepthLuma: 8,
      width: 1920,
      height: 1080,
    });
  });

  it('SPS 가 아니거나 중간에 끊겼으면 H264Error 다', () => {
    expect(() => parseSps(buildPps())).toThrow(H264Error);
    expect(() => parseSps(SPS_1080P.subarray(0, 8))).toThrow(H264Error);
  });
});

describe('buildAvcC', () => {
  it('베이스라인: 7바이트 머리 + SPS·PPS(길이 2바이트 앞붙임), 확장 없음', () => {
    const sps = buildSps(10, 6);
    const pps = buildPps();
    expect([...buildAvcC([sps], [pps])]).toEqual([
      ...[1, 66, 0xc0, 30, 0xff, 0xe1],
      ...[0, sps.length, ...sps],
      ...[1, 0, pps.length, ...pps],
    ]);
  });

  it('High 프로파일은 크로마·비트 깊이 확장 4바이트가 붙는다', () => {
    const pps = buildPps();
    const avcC = buildAvcC([SPS_1080P], [pps]);
    expect([...avcC.subarray(0, 6)]).toEqual([1, 100, 0, 40, 0xff, 0xe1]);
    expect([...avcC.subarray(avcC.length - 4)]).toEqual([0xfd, 0xf8, 0xf8, 0]);
    expect(avcC.length).toBe(7 + 2 + SPS_1080P.length + 2 + pps.length + 4);
  });

  it('서로 다른 SPS·PPS 는 모두 싣고 개수를 센다', () => {
    const other = buildSps(8, 6);
    const avcC = buildAvcC([buildSps(10, 6), other], [buildPps()]);
    expect(avcC[5]).toBe(0xe2);
  });

  it('SPS 나 PPS 가 없으면 H264Error 다', () => {
    expect(() => buildAvcC([], [buildPps()])).toThrow(H264Error);
    expect(() => buildAvcC([buildSps(1, 1)], [])).toThrow(H264Error);
  });
});

/** 샘플 데이터(길이 + NAL 의 이음)를 NAL 로 푼다. */
function nalsOf(data: Uint8Array): Uint8Array[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: Uint8Array[] = [];
  for (let at = 0; at < data.length;) {
    const length = view.getUint32(at);
    out.push(data.subarray(at + 4, at + 4 + length));
    at += 4 + length;
  }
  return out;
}

describe('parseAnnexB', () => {
  const stream = buildTestH264Stream({ frames: 70, keyEvery: 30 });
  const parsed = parseAnnexB(stream.data);

  it('프레임마다 샘플 하나, 키프레임은 간격대로이고 SPS·PPS 는 하나씩이다', () => {
    expect(parsed.samples).toHaveLength(70);
    expect(parsed.samples.flatMap((sample, i) => (sample.keyframe ? [i] : []))).toEqual([
      0, 30, 60,
    ]);
    expect(parsed.sps).toHaveLength(1);
    expect(parsed.pps).toHaveLength(1);
    expect(parsed.dropped).toBe(0);
  });

  it('샘플은 NAL 길이(4바이트) + NAL 이고 SPS·PPS 는 들어 있지 않다', () => {
    const all = parsed.samples.flatMap((sample) => nalsOf(sample.data));
    expect(all).toHaveLength(70);
    expect(all.map(nalType).every((type) => type === NAL.IDR || type === NAL.SLICE)).toBe(true);
    expect(nalType(nalsOf(parsed.samples[0]!.data)[0]!)).toBe(NAL.IDR);
    expect(nalType(nalsOf(parsed.samples[1]!.data)[0]!)).toBe(NAL.SLICE);
  });

  const units = splitNalUnits(buildTestH264Stream({ frames: 4, keyEvery: 30 }).data);
  const [sps, pps, idr, p1, p2] = units as [
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array,
  ];

  it('첫 키프레임 앞의 프레임은 디코딩할 수 없어 버린다', () => {
    const result = parseAnnexB(annexB([p1, sps, pps, p2, idr, p1]));
    expect(result.dropped).toBe(2);
    expect(result.samples.map((sample) => sample.keyframe)).toEqual([true, false]);
  });

  it('한 프레임의 여러 슬라이스(first_mb_in_slice 가 0 이 아님)는 한 샘플이다', () => {
    const second = Uint8Array.from(idr);
    second[1] = 0x40; // first_mb_in_slice = 1
    const result = parseAnnexB(annexB([sps, pps, idr, second, p1]));
    expect(result.samples).toHaveLength(2);
    expect(nalsOf(result.samples[0]!.data)).toHaveLength(2);
  });

  it('AUD 는 프레임 경계이고, SEI 는 뒤따르는 프레임에 붙는다', () => {
    const aud = bytes(0x09, 0xf0);
    const sei = bytes(0x06, 0x01, 0x01, 0x80);
    const result = parseAnnexB(annexB([aud, sps, pps, idr, aud, sei, p1, aud, p2]));
    expect(result.samples).toHaveLength(3);
    expect(nalsOf(result.samples[1]!.data).map(nalType)).toEqual([NAL.SEI, NAL.SLICE]);
  });

  it('다른 SPS 가 중간에 나오면 모두 기억한다', () => {
    const result = parseAnnexB(annexB([sps, pps, idr, p1, buildSps(8, 6), pps, idr, p2]));
    expect(result.sps).toHaveLength(2);
    expect(result.pps).toHaveLength(1);
    expect(result.samples).toHaveLength(4);
  });

  it('SPS·PPS 나 키프레임이 없으면 H264Error 다', () => {
    expect(() => parseAnnexB(annexB([idr, p1]))).toThrow(H264Error);
    expect(() => parseAnnexB(annexB([sps, pps, p1, p2]))).toThrow(H264Error);
    expect(() => parseAnnexB(new Uint8Array())).toThrow(H264Error);
    expect(() => parseAnnexB(bytes(1, 2, 3, 4))).toThrow(H264Error);
  });
});
