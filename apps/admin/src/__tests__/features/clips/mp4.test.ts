import { DEFAULT_FRAME_RATE, TIMESCALE } from '@/features/clips/constants';
import { buildAvcC, H264Error, parseAnnexB } from '@/features/clips/h264';
import { muxAvcMp4, muxAvcMp4Parts } from '@/features/clips/mp4';
import { buildTestH264Stream } from '@/mocks/h264TestStream';
import { describe, expect, it } from 'vitest';

// 만든 MP4 를 작은 상자 읽개로 다시 읽어 색인(stts·stss·stsz·stco)이 실제 바이트와 맞는지 본다.

interface Box {
  type: string;
  /** 상자 시작. */
  start: number;
  size: number;
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf']);
const ascii = (data: Uint8Array, at: number, length: number) =>
  new TextDecoder().decode(data.subarray(at, at + length));

function children(data: Uint8Array, start: number, end: number): Box[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: Box[] = [];
  for (let at = start; at < end;) {
    const size = view.getUint32(at);
    out.push({ type: ascii(data, at + 4, 4), start: at, size });
    if (size < 8) throw new Error('상자 크기가 올바르지 않다');
    at += size;
  }
  return out;
}

function find(data: Uint8Array, path: string[]): Box {
  let level = children(data, 0, data.length);
  let found: Box | undefined;
  for (const type of path) {
    found = level.find((box) => box.type === type);
    if (!found) throw new Error(`${path.join('/')} 가 없다`);
    level = CONTAINERS.has(type) ? children(data, found.start + 8, found.start + found.size) : [];
  }
  return found!;
}

const has = (data: Uint8Array, path: string[]) => {
  try {
    find(data, path);
    return true;
  } catch {
    return false;
  }
};

/** 상자 본문(머리 8바이트, 전체 상자는 version/flags 4바이트 더)을 읽는 DataView. */
function view(data: Uint8Array, box: Box) {
  return new DataView(data.buffer, data.byteOffset + box.start, box.size);
}

const STBL = ['moov', 'trak', 'mdia', 'minf', 'stbl'];
const u32s = (data: Uint8Array, box: Box, from: number, count: number) => {
  const v = view(data, box);
  return Array.from({ length: count }, (_, i) => v.getUint32(from + i * 4));
};

const stream = buildTestH264Stream({ frames: 90, keyEvery: 30 });
const parsed = parseAnnexB(stream.data);

describe('muxAvcMp4', () => {
  const mp4 = muxAvcMp4(parsed, { frameRate: 15 });

  it('ftyp · moov · mdat 순서이고 mdat 크기는 샘플 크기의 합이다', () => {
    const top = children(mp4, 0, mp4.length);
    expect(top.map((box) => box.type)).toEqual(['ftyp', 'moov', 'mdat']);
    expect(ascii(mp4, 8, 4)).toBe('isom');
    const total = parsed.samples.reduce((sum, sample) => sum + sample.data.length, 0);
    expect(top[2]?.size).toBe(8 + total);
    expect(top[2]!.start + top[2]!.size).toBe(mp4.length);
  });

  it('stsz·stco 가 가리키는 곳에 샘플 바이트가 그대로 있다', () => {
    const stsz = find(mp4, [...STBL, 'stsz']);
    const [fixed, count] = u32s(mp4, stsz, 12, 2) as [number, number];
    expect([fixed, count]).toEqual([0, 90]);
    const sizes = u32s(mp4, stsz, 20, count);
    expect(sizes).toEqual(parsed.samples.map((sample) => sample.data.length));

    const stco = find(mp4, [...STBL, 'stco']);
    const [entries, offset] = u32s(mp4, stco, 12, 2) as [number, number];
    expect(entries).toBe(1);
    const mdat = find(mp4, ['mdat']);
    expect(offset).toBe(mdat.start + 8);

    // stsc: 샘플 전부가 한 덩어리(chunk) 안에 있다.
    expect(u32s(mp4, find(mp4, [...STBL, 'stsc']), 12, 4)).toEqual([1, 1, 90, 1]);

    let at = offset;
    parsed.samples.forEach((sample, i) => {
      expect([...mp4.subarray(at, at + sizes[i]!)]).toEqual([...sample.data]);
      at += sizes[i]!;
    });
  });

  it('시간 색인: 15fps 는 샘플마다 6000(1/90000초), 길이는 6초다', () => {
    expect(TIMESCALE).toBe(90_000);
    const stts = find(mp4, [...STBL, 'stts']);
    expect(u32s(mp4, stts, 12, 3)).toEqual([1, 90, 6000]);
    const mdhd = find(mp4, ['moov', 'trak', 'mdia', 'mdhd']);
    expect(u32s(mp4, mdhd, 20, 2)).toEqual([90_000, 90 * 6000]);
    const mvhd = find(mp4, ['moov', 'mvhd']);
    expect(u32s(mp4, mvhd, 20, 2)).toEqual([1000, 6000]);
    const tkhd = find(mp4, ['moov', 'trak', 'tkhd']);
    expect(view(mp4, tkhd).getUint32(28)).toBe(6000);
  });

  it('stss 는 키프레임 번호(1부터)이고 모두 키프레임이면 stss 가 없다', () => {
    const stss = find(mp4, [...STBL, 'stss']);
    expect(u32s(mp4, stss, 12, 4)).toEqual([3, 1, 31, 61]);

    const allKey = buildTestH264Stream({ frames: 6, keyEvery: 1 });
    expect(has(muxAvcMp4(parseAnnexB(allKey.data)), [...STBL, 'stss'])).toBe(false);
  });

  it('avc1 항목에 크기와 avcC(SPS·PPS)가 들어 있다', () => {
    const stsd = find(mp4, [...STBL, 'stsd']);
    const avc1 = stsd.start + 16;
    expect(ascii(mp4, avc1 + 4, 4)).toBe('avc1');
    const v = new DataView(mp4.buffer, mp4.byteOffset);
    expect([v.getUint16(avc1 + 8 + 24), v.getUint16(avc1 + 8 + 26)]).toEqual([160, 96]);
    // VisualSampleEntry 본문은 78바이트.
    const avcC = avc1 + 8 + 78;
    expect(ascii(mp4, avcC + 4, 4)).toBe('avcC');
    const expected = buildAvcC(parsed.sps, parsed.pps);
    expect(v.getUint32(avcC)).toBe(8 + expected.length);
    expect([...mp4.subarray(avcC + 8, avcC + 8 + expected.length)]).toEqual([...expected]);
    // 트랙 머리의 크기(16.16 고정 소수점).
    const tkhd = find(mp4, ['moov', 'trak', 'tkhd']);
    expect([
      view(mp4, tkhd).getUint32(tkhd.size - 8),
      view(mp4, tkhd).getUint32(tkhd.size - 4),
    ]).toEqual([160 << 16, 96 << 16]);
  });

  it('29.97fps 처럼 나누어떨어지지 않는 속도도 오차가 쌓이지 않는다', () => {
    const out = muxAvcMp4(parsed, { frameRate: 30_000 / 1001 });
    const stts = find(out, [...STBL, 'stts']);
    const entries = view(out, stts).getUint32(12);
    const runs = u32s(out, stts, 16, entries * 2);
    // 프레임 간격은 3003 근처에서 하나씩만 어긋난다.
    const deltas = runs.filter((_, i) => i % 2 === 1);
    expect(deltas.every((d) => d === 3003 || d === 3002 || d === 3004)).toBe(true);
    const total = runs.reduce(
      (sum, value, i) => (i % 2 === 0 ? sum + value * (runs[i + 1] ?? 0) : sum),
      0,
    );
    expect(total).toBe(Math.round((90 * TIMESCALE * 1001) / 30_000));
  });

  it('프레임 속도를 정하는 법: 지정값 > 촬영 구간(프레임 수 ÷ 구간) > 기본 15fps', () => {
    const deltaOf = (options: Parameters<typeof muxAvcMp4>[1]) => {
      const out = muxAvcMp4(parsed, options);
      return u32s(out, find(out, [...STBL, 'stts']), 12, 3)[2];
    };
    expect(DEFAULT_FRAME_RATE).toBe(15);
    expect(deltaOf({})).toBe(6000);
    // 90 프레임이 6초 → 15fps.
    expect(deltaOf({ windowMs: 6_000 })).toBe(6000);
    // 90 프레임이 18초 → 5fps.
    expect(deltaOf({ windowMs: 18_000 })).toBe(18_000);
    // 너무 느리거나 빠르면 1~60fps 로 맞춘다.
    expect(deltaOf({ windowMs: 10_000_000 })).toBe(90_000);
    expect(deltaOf({ windowMs: 1 })).toBe(1500);
    // 구간이 0 이하면 기본값.
    expect(deltaOf({ windowMs: 0 })).toBe(6000);
    expect(deltaOf({ frameRate: 30, windowMs: 18_000 })).toBe(3000);
  });

  it('프레임 속도가 올바르지 않으면 H264Error 다', () => {
    expect(() => muxAvcMp4(parsed, { frameRate: 0 })).toThrow(H264Error);
    expect(() => muxAvcMp4(parsed, { frameRate: Number.NaN })).toThrow(H264Error);
  });
});

describe('muxAvcMp4Parts', () => {
  it('조각을 이어 붙이면 muxAvcMp4 와 같은 바이트다', () => {
    const parts = muxAvcMp4Parts(parsed, { windowMs: 6_000 });
    const joined = Uint8Array.from(parts.flatMap((part) => [...part]));
    expect([...joined]).toEqual([...muxAvcMp4(parsed, { windowMs: 6_000 })]);
  });

  it('샘플 바이트는 복사하지 않고 그대로 담는다', () => {
    const parts = muxAvcMp4Parts(parsed);
    expect(parts.slice(3)).toEqual(parsed.samples.map((sample) => sample.data));
    expect(parts[3]).toBe(parsed.samples[0]?.data);
  });
});

describe('읽을 수 없는 스트림', () => {
  it('SPS·PPS 가 없는 바이트는 H264Error 다', () => {
    expect(() => muxAvcMp4(parseAnnexB(new Uint8Array([1, 2, 3])))).toThrow(H264Error);
  });
});
