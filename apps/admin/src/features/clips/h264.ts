import {
  AVCC_HEADER_BYTES,
  AVCC_HIGH_EXTENSION_BYTES,
  AVCC_VERSION,
  CHROMA_420,
  CHROMA_422,
  CHROMA_444,
  DEFAULT_BIT_DEPTH,
  EMULATION_PREVENTION_BYTE,
  EMULATION_ZERO_RUN,
  FIRST_MB_ZERO_BIT,
  HIGH_PROFILES,
  MACROBLOCK_SIZE,
  MAX_UE_LEADING_ZEROS,
  NAL,
  NAL_LENGTH_SIZE,
  NAL_TYPE_MASK,
  PARAMETER_SET_LENGTH_SIZE,
  RESERVED_3_BITS,
  RESERVED_5_BITS,
  RESERVED_6_BITS,
  SCALING_LIST_SIZE_4X4,
  SCALING_LIST_SIZE_8X8,
  SCALING_LISTS,
  SCALING_LISTS_444,
  SCALING_LISTS_4X4,
  SCALING_RANGE,
  SCALING_START,
  SPS_FIXED_BYTES,
  SPS_MIN_BYTES,
} from '@/features/clips/constants';

// H.264 Annex B 기본 스트림 읽기(ITU-T H.264 부록 B·7.3). 디코딩하지 않고 NAL 만 나눠 MP4 로 감쌀 재료를 만든다.
// Tier 0 클립(`container: h264-annexb`)은 구간마다 SPS·PPS 를 앞에 두고 접근 단위를 받은 순서대로 이어 붙인 것이다.
// B 프레임이 없는 스트림(디코딩 순서 = 표시 순서)만 다룬다. 카메라 라이브 스트림이 그렇다.

export class H264Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'H264Error';
  }
}

export const nalType = (nal: Uint8Array) => (nal[0] ?? 0) & NAL_TYPE_MASK;

/** 시작 코드(00 00 01, 00 00 00 01)로 NAL 을 나눈다. 돌려주는 NAL 은 시작 코드와 뒤따르는 0 바이트를 뺀 것이다. */
export function splitNalUnits(data: Uint8Array): Uint8Array[] {
  const nals: Uint8Array[] = [];
  const end = data.length;
  let start = -1;
  const close = (stop: number) => {
    let last = stop;
    // NAL 은 0 으로 끝나지 않는다(RBSP 끝 비트). 뒤의 0 은 다음 시작 코드의 앞부분이다.
    while (last > start && data[last - 1] === 0) last -= 1;
    if (last > start) nals.push(data.subarray(start, last));
  };
  let i = 0;
  while (i + 2 < end) {
    // 세 번째 바이트가 1 보다 크면 i, i+1, i+2 어디서도 시작 코드가 시작하지 않는다.
    if ((data[i + 2] ?? 0) > 1) {
      i += 3;
    } else if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      if (start >= 0) close(i);
      start = i + 3;
      i += 3;
    } else {
      i += 1;
    }
  }
  if (start >= 0) close(end);
  return nals;
}

/** 에뮬레이션 방지 바이트(00 00 03 의 03)를 뺀 RBSP. */
export function unescapeRbsp(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let length = 0;
  let zeros = 0;
  for (const byte of bytes) {
    if (zeros >= EMULATION_ZERO_RUN && byte === EMULATION_PREVENTION_BYTE) {
      zeros = 0;
      continue;
    }
    out[length++] = byte;
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return out.subarray(0, length);
}

class BitReader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}

  bit(): number {
    const byte = this.bytes[this.pos >> 3];
    if (byte === undefined) throw new H264Error('SPS 가 중간에 끊겼다');
    const value = (byte >> (7 - (this.pos & 7))) & 1;
    this.pos += 1;
    return value;
  }

  bits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) value = value * 2 + this.bit();
    return value;
  }

  /** ue(v): 지수 골룸. */
  ue(): number {
    let zeros = 0;
    while (this.bit() === 0) {
      zeros += 1;
      if (zeros > MAX_UE_LEADING_ZEROS) throw new H264Error('SPS 의 ue(v) 값이 너무 크다');
    }
    return 2 ** zeros - 1 + this.bits(zeros);
  }

  /** se(v). */
  se(): number {
    const k = this.ue();
    return k % 2 === 1 ? (k + 1) / 2 : -k / 2;
  }
}

export interface SpsInfo {
  profileIdc: number;
  /** constraint_set 플래그와 예약 비트 한 바이트. */
  profileCompatibility: number;
  levelIdc: number;
  chromaFormatIdc: number;
  bitDepthLuma: number;
  bitDepthChroma: number;
  /** 자르기(frame_cropping)를 적용한 표시 크기. */
  width: number;
  height: number;
}

/** SPS 의 색 형식 칸. 높은 프로파일이 아니면 4:2:0·8비트다. */
interface ColorFormat {
  chromaFormatIdc: number;
  separateColourPlane: number;
  bitDepthLuma: number;
  bitDepthChroma: number;
}

const DEFAULT_COLOR_FORMAT: ColorFormat = {
  chromaFormatIdc: CHROMA_420,
  separateColourPlane: 0,
  bitDepthLuma: DEFAULT_BIT_DEPTH,
  bitDepthChroma: DEFAULT_BIT_DEPTH,
};

/** 색차를 가로(세로)로 반으로 줄인 형식의 자르기 단위. */
const CHROMA_CROP_UNIT = 2;
/** frame_mbs_only_flag 가 0(필드 부호화)이면 세로 단위가 두 배다. */
const FIELD_CODING_FACTOR = 2;

function skipScalingList(reader: BitReader, size: number) {
  let last = SCALING_START;
  let next = SCALING_START;
  for (let j = 0; j < size; j++) {
    if (next !== 0) next = (last + reader.se() + SCALING_RANGE) % SCALING_RANGE;
    if (next !== 0) last = next;
  }
}

function skipScalingMatrix(reader: BitReader, chromaFormatIdc: number) {
  const lists = chromaFormatIdc === CHROMA_444 ? SCALING_LISTS_444 : SCALING_LISTS;
  for (let i = 0; i < lists; i++) {
    if (reader.bit() === 1) {
      skipScalingList(
        reader,
        i < SCALING_LISTS_4X4 ? SCALING_LIST_SIZE_4X4 : SCALING_LIST_SIZE_8X8,
      );
    }
  }
}

/** 높은 프로파일에만 있는 색 형식·비트 깊이 칸을 읽는다. 스케일링 행렬은 건너뛴다. */
function readColorFormat(reader: BitReader): ColorFormat {
  const chromaFormatIdc = reader.ue();
  const separateColourPlane = chromaFormatIdc === CHROMA_444 ? reader.bit() : 0;
  const bitDepthLuma = DEFAULT_BIT_DEPTH + reader.ue();
  const bitDepthChroma = DEFAULT_BIT_DEPTH + reader.ue();
  reader.bit(); // qpprime_y_zero_transform_bypass_flag
  if (reader.bit() === 1) skipScalingMatrix(reader, chromaFormatIdc);
  return { chromaFormatIdc, separateColourPlane, bitDepthLuma, bitDepthChroma };
}

/** 표시 순서 칸(pic_order_cnt_type 과 그에 딸린 값)을 건너뛴다. */
function skipPicOrderCount(reader: BitReader) {
  const pocType = reader.ue();
  if (pocType === 0) {
    reader.ue(); // log2_max_pic_order_cnt_lsb_minus4
  } else if (pocType === 1) {
    reader.bit(); // delta_pic_order_always_zero_flag
    reader.se();
    reader.se();
    const cycle = reader.ue();
    for (let i = 0; i < cycle; i++) reader.se();
  }
}

/** frame_cropping 칸을 읽어 가로·세로에서 잘라 낼 픽셀 수를 돌려준다. */
function readCrop(reader: BitReader, color: ColorFormat, fieldFactor: number) {
  const left = reader.ue();
  const right = reader.ue();
  const top = reader.ue();
  const bottom = reader.ue();
  const chromaArrayType = color.separateColourPlane === 1 ? 0 : color.chromaFormatIdc;
  const halvesWidth = chromaArrayType === CHROMA_420 || chromaArrayType === CHROMA_422;
  const unitX = halvesWidth ? CHROMA_CROP_UNIT : 1;
  const unitY = (chromaArrayType === CHROMA_420 ? CHROMA_CROP_UNIT : 1) * fieldFactor;
  return { x: unitX * (left + right), y: unitY * (top + bottom) };
}

/** 가로·세로 매크로블록 수와 자르기 칸으로 표시 크기를 구한다. */
function readFrameSize(reader: BitReader, color: ColorFormat) {
  const widthMbs = reader.ue() + 1;
  const heightMapUnits = reader.ue() + 1;
  const frameMbsOnly = reader.bit();
  if (frameMbsOnly === 0) reader.bit(); // mb_adaptive_frame_field_flag
  reader.bit(); // direct_8x8_inference_flag
  const fieldFactor = FIELD_CODING_FACTOR - frameMbsOnly;
  let width = widthMbs * MACROBLOCK_SIZE;
  let height = fieldFactor * heightMapUnits * MACROBLOCK_SIZE;
  if (reader.bit() === 1) {
    const crop = readCrop(reader, color, fieldFactor);
    width -= crop.x;
    height -= crop.y;
  }
  return { width, height };
}

/** SPS NAL(헤더 바이트 포함)에서 프로파일·레벨·크기를 읽는다. */
export function parseSps(nal: Uint8Array): SpsInfo {
  if (nalType(nal) !== NAL.SPS || nal.length < SPS_MIN_BYTES) throw new H264Error('SPS 가 아니다');
  const [, profileIdc = 0, profileCompatibility = 0, levelIdc = 0] = nal.subarray(
    0,
    SPS_FIXED_BYTES,
  );
  const reader = new BitReader(unescapeRbsp(nal.subarray(SPS_FIXED_BYTES)));
  reader.ue(); // seq_parameter_set_id
  const color = HIGH_PROFILES.has(profileIdc) ? readColorFormat(reader) : DEFAULT_COLOR_FORMAT;
  reader.ue(); // log2_max_frame_num_minus4
  skipPicOrderCount(reader);
  reader.ue(); // max_num_ref_frames
  reader.bit(); // gaps_in_frame_num_value_allowed_flag
  const { width, height } = readFrameSize(reader, color);
  if (width <= 0 || height <= 0) throw new H264Error('SPS 의 크기가 올바르지 않다');
  return {
    profileIdc,
    profileCompatibility,
    levelIdc,
    chromaFormatIdc: color.chromaFormatIdc,
    bitDepthLuma: color.bitDepthLuma,
    bitDepthChroma: color.bitDepthChroma,
    width,
    height,
  };
}

/** 매개변수 집합 목록이 avcC 에서 차지하는 바이트 수(길이 칸 포함). */
const parameterSetBytes = (sets: readonly Uint8Array[]) =>
  sets.reduce((sum, set) => sum + PARAMETER_SET_LENGTH_SIZE + set.length, 0);

/**
 * MP4 의 avcC 상자 내용(AVCDecoderConfigurationRecord, ISO/IEC 14496-15 5.3.3.1). 상자 머리는 붙이지 않는다.
 * NAL 길이는 4바이트로 쓴다(lengthSizeMinusOne = 3).
 */
export function buildAvcC(sps: readonly Uint8Array[], pps: readonly Uint8Array[]): Uint8Array {
  const first = sps[0];
  if (!first || pps.length === 0) throw new H264Error('SPS·PPS 가 없다');
  const info = parseSps(first);
  const high = HIGH_PROFILES.has(info.profileIdc);
  const size =
    AVCC_HEADER_BYTES +
    parameterSetBytes(sps) +
    parameterSetBytes(pps) +
    (high ? AVCC_HIGH_EXTENSION_BYTES : 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const u8 = (value: number) => {
    out[at++] = value;
  };
  const writeSet = (nal: Uint8Array) => {
    view.setUint16(at, nal.length);
    at += PARAMETER_SET_LENGTH_SIZE;
    out.set(nal, at);
    at += nal.length;
  };
  u8(AVCC_VERSION);
  u8(info.profileIdc);
  u8(info.profileCompatibility);
  u8(info.levelIdc);
  u8(RESERVED_6_BITS | (NAL_LENGTH_SIZE - 1)); // 예약 6비트 + lengthSizeMinusOne
  u8(RESERVED_3_BITS | sps.length); // 예약 3비트 + SPS 개수
  sps.forEach(writeSet);
  u8(pps.length);
  pps.forEach(writeSet);
  if (high) {
    u8(RESERVED_6_BITS | info.chromaFormatIdc);
    u8(RESERVED_5_BITS | (info.bitDepthLuma - DEFAULT_BIT_DEPTH));
    u8(RESERVED_5_BITS | (info.bitDepthChroma - DEFAULT_BIT_DEPTH));
    u8(0); // numOfSequenceParameterSetExt
  }
  return out;
}

export interface H264Sample {
  /** NAL 길이(4바이트 빅엔디언) + NAL 을 이어 붙인 한 프레임. SPS·PPS·AUD 는 뺀다. */
  data: Uint8Array<ArrayBuffer>;
  keyframe: boolean;
}

export interface ParsedAnnexB {
  /** 스트림에 나온 서로 다른 SPS·PPS(나온 순서). */
  sps: Uint8Array[];
  pps: Uint8Array[];
  /** 첫 키프레임부터의 프레임. */
  samples: H264Sample[];
  /** 첫 키프레임 앞이라 버린 프레임 수. */
  dropped: number;
}

/** 한 프레임(접근 단위)을 이루는 NAL. 아직 원본 바이트를 가리킬 뿐 복사하지 않았다. */
interface Frame {
  nals: Uint8Array[];
  keyframe: boolean;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

function remember(list: Uint8Array[], nal: Uint8Array) {
  if (!list.some((known) => sameBytes(known, nal))) list.push(nal);
}

const isSlice = (type: number) => type >= NAL.SLICE && type <= NAL.IDR;

/** 슬라이스의 first_mb_in_slice 가 0 이면(ue(v) 의 첫 비트가 1) 새 프레임의 첫 슬라이스다. */
const startsPicture = (nal: Uint8Array) => ((nal[1] ?? 0) & FIRST_MB_ZERO_BIT) !== 0;

/** NAL 을 프레임별로 묶고 스트림에 나온 서로 다른 SPS·PPS 를 모은다. */
function scanFrames(data: Uint8Array) {
  const frames: Frame[] = [];
  const sps: Uint8Array[] = [];
  const pps: Uint8Array[] = [];

  let nals: Uint8Array[] = [];
  let hasSlice = false;
  let keyframe = false;
  // 슬라이스가 든 프레임만 닫는다. 슬라이스 없이 모인 SEI 는 다음 프레임에 붙는다.
  const closeFrame = () => {
    if (!hasSlice) return;
    frames.push({ nals, keyframe });
    nals = [];
    hasSlice = false;
    keyframe = false;
  };

  for (const nal of splitNalUnits(data)) {
    const type = nalType(nal);
    if (type === NAL.SPS || type === NAL.PPS) {
      // 다음 프레임의 앞에 오는 매개변수 집합이다. 이전 프레임은 여기서 끝난다.
      closeFrame();
      remember(type === NAL.SPS ? sps : pps, nal);
    } else if (type === NAL.AUD) {
      closeFrame();
    } else if (type === NAL.SEI) {
      closeFrame();
      nals.push(nal);
    } else if (isSlice(type)) {
      if (startsPicture(nal)) closeFrame();
      nals.push(nal);
      hasSlice = true;
      if (type === NAL.IDR) keyframe = true;
    }
    // 그 밖의 NAL(필러·시퀀스 끝 등)은 재생에 필요 없어 버린다.
  }
  closeFrame();
  return { frames, sps, pps };
}

/** NAL 마다 길이(4바이트)를 앞에 붙여 한 덩어리로 이어 붙인다(프레임당 한 번 복사). */
function toSampleData(nals: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(nals.reduce((sum, nal) => sum + NAL_LENGTH_SIZE + nal.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const nal of nals) {
    view.setUint32(at, nal.length);
    out.set(nal, at + NAL_LENGTH_SIZE);
    at += NAL_LENGTH_SIZE + nal.length;
  }
  return out;
}

/** Annex B 스트림을 프레임(접근 단위)별 MP4 샘플로 나눈다. 첫 키프레임 앞의 프레임은 디코딩할 수 없어 버린다. */
export function parseAnnexB(data: Uint8Array): ParsedAnnexB {
  const { frames, sps, pps } = scanFrames(data);
  if (sps.length === 0 || pps.length === 0) throw new H264Error('스트림에 SPS·PPS 가 없다');
  const firstKeyframe = frames.findIndex((frame) => frame.keyframe);
  if (firstKeyframe < 0) throw new H264Error('스트림에 키프레임이 없다');
  const samples = frames
    .slice(firstKeyframe)
    .map((frame) => ({ data: toSampleData(frame.nals), keyframe: frame.keyframe }));
  return { sps, pps, samples, dropped: firstKeyframe };
}
