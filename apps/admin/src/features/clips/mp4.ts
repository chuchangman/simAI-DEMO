import {
  BOX_HEADER_SIZE,
  COLOR_DEPTH,
  COMPATIBLE_BRANDS,
  COMPRESSOR_NAME_BYTES,
  DATA_REFERENCE_INDEX,
  DEFAULT_FRAME_RATE,
  FIXED_16_ONE,
  FIXED_8_ONE,
  FLAGS_TRACK_ENABLED,
  FLAGS_URL_SELF_CONTAINED,
  FLAGS_VMHD,
  FRAMES_PER_SAMPLE,
  HANDLER_TYPE_VIDEO,
  LANGUAGE_UND,
  MAJOR_BRAND,
  MAX_FRAME_RATE,
  MAX_U32,
  MIN_FRAME_RATE,
  MINOR_VERSION,
  MOVIE_TIMESCALE,
  MS_PER_SECOND,
  NEXT_TRACK_ID,
  PRE_DEFINED_MINUS_ONE,
  RESOLUTION_72_DPI,
  TIMESCALE,
  TRACK_ID,
  UNITY_MATRIX,
  VIDEO_HANDLER_NAME,
} from '@/features/clips/constants';
import { buildAvcC, H264Error, parseSps, type ParsedAnnexB } from '@/features/clips/h264';

// H.264 → MP4 감싸기(재인코딩 없음). 서버는 영상을 변환하지 않으므로(server-event-clips.md) 브라우저가 Annex B 클립을
// 재생할 수 있게 MP4(ISO/IEC 14496-12)로 감싼다. 외부 라이브러리를 쓰지 않는다: mp4box.js 2.4.1 의 addSample 은 샘플마다
// moof 를 쓰는 조각난 MP4 만 만들어 길이·탐색 색인이 없어서, 색인이 있는 일반 MP4 를 직접 쓴다.
// 구조: ftyp · moov(mvhd, trak(tkhd, mdia(mdhd, hdlr, minf(vmhd, dinf, stbl)))) · mdat. 샘플은 한 덩어리(chunk)다.

export interface Mp4Options {
  /** 초당 프레임 수. 스트림에는 프레임 시각이 없어 프레임을 일정한 간격으로 둔다. */
  frameRate?: number;
  /**
   * 클립의 촬영 구간 길이(ms). frameRate 가 없으면 프레임 수 ÷ 구간으로 속도를 정해 전체 길이를 촬영 구간에 맞춘다.
   * 프레임이 빠진 곳(has_gaps)이 있어도 그 자리를 따로 메우지 않고 프레임을 고르게 편다.
   */
  windowMs?: number;
}

/** moov 를 쓰는 데 필요한 영상 트랙 정보. */
interface Track {
  width: number;
  height: number;
  /** avcC 상자 내용(SPS·PPS). */
  avcC: Uint8Array;
  /** 샘플(프레임)마다 바이트 크기. */
  sampleSizes: number[];
  /** stts 항목: [같은 길이가 이어지는 샘플 수, 샘플 길이(미디어 시간 단위)]. */
  durations: [count: number, delta: number][];
  /** stss 항목: 키프레임 샘플 번호(1부터). */
  keyframes: number[];
  /** 전체 길이(미디어 시간 단위). */
  duration: number;
  /** 전체 길이(영화 시간 단위). */
  movieDuration: number;
}

const text = new TextEncoder();

const MATRIX = u32s(UNITY_MATRIX);

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function u16(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((value, i) => view.setUint16(i * 2, value));
  return out;
}

function u32s(values: readonly number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, i) => view.setUint32(i * 4, value));
  return out;
}

const u32 = (...values: number[]) => u32s(values);

const zeros = (count: number) => new Uint8Array(count);

function box(type: string, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = concat(parts);
  return concat([u32(BOX_HEADER_SIZE + body.length), text.encode(type), body]);
}

/** version 0 인 상자. flags 는 version 과 같은 4바이트 칸에 들어간다. */
const fullBox = (type: string, flags: number, ...parts: Uint8Array[]) =>
  box(type, u32(flags), ...parts);

/** 프레임 시각(미디어 시간 단위). 소수 프레임 속도도 오차가 쌓이지 않게 인덱스에서 바로 계산한다. */
const dtsOf = (index: number, frameRate: number) => Math.round((index * TIMESCALE) / frameRate);

const fitToWindow = (sampleCount: number, windowMs: number) =>
  Math.min(MAX_FRAME_RATE, Math.max(MIN_FRAME_RATE, (sampleCount * MS_PER_SECOND) / windowMs));

/** 프레임 속도: 지정값 > 촬영 구간에 맞춘 값 > 기본값. */
function resolveFrameRate({ frameRate, windowMs }: Mp4Options, sampleCount: number): number {
  const hasWindow = windowMs !== undefined && windowMs > 0;
  const rate = frameRate ?? (hasWindow ? fitToWindow(sampleCount, windowMs) : DEFAULT_FRAME_RATE);
  if (!Number.isFinite(rate) || rate <= 0) throw new H264Error('프레임 속도가 올바르지 않다');
  return rate;
}

/** stts 항목. 같은 길이가 이어지는 구간을 묶는다. 마지막 프레임은 앞 프레임과 같은 길이다. */
function sampleDurations(count: number, frameRate: number): Track['durations'] {
  const runs: Track['durations'] = [];
  let previous = 0;
  for (let i = 1; i <= count; i++) {
    const at = dtsOf(i, frameRate);
    const delta = at - previous;
    previous = at;
    const last = runs[runs.length - 1];
    if (last && last[1] === delta) last[0] += 1;
    else runs.push([1, delta]);
  }
  return runs;
}

function buildFtyp() {
  return box(
    'ftyp',
    text.encode(MAJOR_BRAND),
    u32(MINOR_VERSION),
    ...COMPATIBLE_BRANDS.map((brand) => text.encode(brand)),
  );
}

function buildAvc1({ width, height, avcC }: Track) {
  return box(
    'avc1',
    zeros(6), // reserved
    u16(DATA_REFERENCE_INDEX),
    zeros(16), // pre_defined · reserved
    u16(width, height),
    u32(RESOLUTION_72_DPI, RESOLUTION_72_DPI),
    zeros(4), // reserved
    u16(FRAMES_PER_SAMPLE),
    zeros(COMPRESSOR_NAME_BYTES),
    u16(COLOR_DEPTH, PRE_DEFINED_MINUS_ONE),
    box('avcC', avcC),
  );
}

/** 샘플 색인. dataOffset 은 mdat 안 첫 샘플의 파일 안 위치다. */
function buildStbl(track: Track, dataOffset: number) {
  const { sampleSizes, durations, keyframes } = track;
  const count = sampleSizes.length;
  return box(
    'stbl',
    fullBox('stsd', 0, u32(1), buildAvc1(track)),
    fullBox('stts', 0, u32(durations.length), u32s(durations.flat())),
    // 모두 키프레임이면 stss 를 쓰지 않는다(모든 샘플이 동기 샘플).
    ...(keyframes.length === count
      ? []
      : [fullBox('stss', 0, u32(keyframes.length), u32s(keyframes))]),
    fullBox('stsc', 0, u32(1, 1, count, 1)), // 한 덩어리: 첫 덩어리 번호, 덩어리당 샘플 수, 항목 번호
    fullBox('stsz', 0, u32(0, count), u32s(sampleSizes)),
    fullBox('stco', 0, u32(1, dataOffset)),
  );
}

function buildMinf(track: Track, dataOffset: number) {
  return box(
    'minf',
    fullBox('vmhd', FLAGS_VMHD, u16(0, 0, 0, 0)),
    box('dinf', fullBox('dref', 0, u32(1), fullBox('url ', FLAGS_URL_SELF_CONTAINED))),
    buildStbl(track, dataOffset),
  );
}

function buildMdia(track: Track, dataOffset: number) {
  return box(
    'mdia',
    fullBox('mdhd', 0, u32(0, 0, TIMESCALE, track.duration), u16(LANGUAGE_UND, 0)),
    fullBox(
      'hdlr',
      0,
      u32(0),
      text.encode(HANDLER_TYPE_VIDEO),
      zeros(12),
      text.encode(VIDEO_HANDLER_NAME),
    ),
    buildMinf(track, dataOffset),
  );
}

function buildTrak(track: Track, dataOffset: number) {
  return box(
    'trak',
    fullBox(
      'tkhd',
      FLAGS_TRACK_ENABLED,
      u32(0, 0, TRACK_ID, 0, track.movieDuration),
      zeros(8),
      u16(0, 0, 0, 0),
      MATRIX,
      u32(track.width * FIXED_16_ONE, track.height * FIXED_16_ONE),
    ),
    buildMdia(track, dataOffset),
  );
}

function buildMoov(track: Track, dataOffset: number) {
  return box(
    'moov',
    fullBox(
      'mvhd',
      0,
      u32(0, 0, MOVIE_TIMESCALE, track.movieDuration, FIXED_16_ONE),
      u16(FIXED_8_ONE, 0),
      zeros(8),
      MATRIX,
      zeros(24),
      u32(NEXT_TRACK_ID),
    ),
    buildTrak(track, dataOffset),
  );
}

function buildTrack(parsed: ParsedAnnexB, options: Mp4Options): Track {
  const { samples } = parsed;
  const frameRate = resolveFrameRate(options, samples.length);
  const first = parsed.sps[0];
  if (!first || samples.length === 0) throw new H264Error('감쌀 프레임이 없다');
  const { width, height } = parseSps(first);
  const duration = dtsOf(samples.length, frameRate);
  return {
    width,
    height,
    avcC: buildAvcC(parsed.sps, parsed.pps),
    sampleSizes: samples.map((sample) => sample.data.length),
    durations: sampleDurations(samples.length, frameRate),
    keyframes: samples.flatMap((sample, i) => (sample.keyframe ? [i + 1] : [])),
    duration,
    movieDuration: Math.round((duration * MOVIE_TIMESCALE) / TIMESCALE),
  };
}

/**
 * 이미 나눈 스트림을 MP4 조각 목록(ftyp · moov · mdat 머리 · 샘플들)으로 쓴다. 샘플 바이트는 복사하지 않고 그대로 담는다.
 * 하나로 이어 붙이지 않고 Blob 에 바로 넘기면 큰 영상 바이트를 한 번 덜 복사한다.
 */
export function muxAvcMp4Parts(
  parsed: ParsedAnnexB,
  options: Mp4Options = {},
): Uint8Array<ArrayBuffer>[] {
  const track = buildTrack(parsed, options);
  const dataSize = track.sampleSizes.reduce((sum, size) => sum + size, 0);
  const ftyp = buildFtyp();

  // stco 의 값이 moov 크기에 기대므로 크기를 먼저 잰다(값은 크기에 영향을 주지 않는다).
  const dataOffset = ftyp.length + buildMoov(track, 0).length + BOX_HEADER_SIZE;
  if (dataOffset + dataSize > MAX_U32) throw new H264Error('클립이 너무 커서 MP4 로 감쌀 수 없다');
  const mdatHeader = concat([u32(BOX_HEADER_SIZE + dataSize), text.encode('mdat')]);

  return [
    ftyp,
    buildMoov(track, dataOffset),
    mdatHeader,
    ...parsed.samples.map((sample) => sample.data),
  ];
}

/** 이미 나눈 스트림을 한 덩어리 MP4 로 쓴다. */
export function muxAvcMp4(parsed: ParsedAnnexB, options: Mp4Options = {}): Uint8Array<ArrayBuffer> {
  return concat(muxAvcMp4Parts(parsed, options));
}
