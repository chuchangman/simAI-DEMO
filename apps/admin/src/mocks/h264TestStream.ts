import {
  EMULATION_PREVENTION_BYTE,
  EMULATION_ZERO_RUN,
  MACROBLOCK_SIZE,
  NAL,
} from '@/features/clips/constants';

// 시험용 H.264 Annex B 스트림을 코드로 만든다(영상 파일을 저장소에 두지 않는다). 클립 mock 과 MP4 감싸기 시험이 쓴다.
// 인코더 없이 디코딩할 수 있게 매크로블록을 I_PCM(원본 샘플 그대로)으로 쓴다: 키프레임은 모든 칸을, 그 사이 프레임은
// 바뀐 칸만 I_PCM 으로 쓰고 나머지는 P_Skip 이다. 베이스라인·4:2:0·POC 타입 2(B 프레임 없음)라 브라우저가 그대로 재생한다.
// 화면: 색 막대 위를 흰 점이 든 검은 칸이 한 칸씩 지나간다.

const BITS_PER_BYTE = 8;
/** 시작 코드(4바이트). */
const START_CODE = [0, 0, 0, 1];
/** NAL 헤더의 nal_ref_idc 자리(nal_unit_type 5비트 위)와 값: 매개변수 집합·IDR 은 3, 참조되는 P 슬라이스는 2. */
const REF_IDC_SHIFT = 5;
const REF_IDC_HIGH = 3;
const REF_IDC_P_SLICE = 2;
/** frame_num 의 비트 수(log2_max_frame_num). */
const LOG2_MAX_FRAME_NUM = 4;
/** idr_pic_id 의 범위. 이어지는 IDR 마다 값이 달라야 한다. */
const IDR_PIC_ID_RANGE = 65_536;

// SPS
const PROFILE_BASELINE = 66;
/** constraint_set0·1 플래그. */
const CONSTRAINT_SET_01 = 0xc0;
const LEVEL_3_0 = 30;
/** pic_order_cnt_type 2: 표시 순서 = 디코딩 순서. */
const POC_TYPE_OUTPUT_ORDER = 2;

// 슬라이스·매크로블록
/** slice_type: 5 이상은 슬라이스 안이 모두 같은 종류라는 뜻이다(I = 7, P = 5). */
const SLICE_TYPE_I = 7;
const SLICE_TYPE_P = 5;
/** mb_type: I 슬라이스의 I_PCM 은 25, P 슬라이스에서는 P 종류(5)만큼 더해 30 이다. */
const MB_TYPE_I_PCM = 25;
const MB_TYPE_I_PCM_IN_P = 30;

// 화면(BT.601 제한 범위)
const LUMA_BLACK = 16;
const LUMA_WHITE = 235;
const CHROMA_NEUTRAL = 128;
/** 검은 칸 안에서 흰 점이 차지하는 범위(픽셀). */
const DOT_FROM = 4;
const DOT_TO = 12;
/** 매크로블록 하나의 휘도 샘플 수(16x16)와 색차 샘플 수(4:2:0 이라 8x8). */
const LUMA_SAMPLES = MACROBLOCK_SIZE * MACROBLOCK_SIZE;
const CHROMA_SAMPLES = (MACROBLOCK_SIZE / 2) ** 2;

// 기본 크기(매크로블록 단위, 10x6 = 160x96), 키프레임 간격, 검은 칸이 옮겨 가는 간격(프레임)
const DEFAULT_WIDTH_MBS = 10;
const DEFAULT_HEIGHT_MBS = 6;
const DEFAULT_KEY_EVERY = 30;
const DEFAULT_STEP_FRAMES = 5;

class BitWriter {
  private readonly bytes: number[] = [];
  private current = 0;
  private used = 0;

  bit(value: number) {
    this.current = (this.current << 1) | (value & 1);
    this.used += 1;
    if (this.used === BITS_PER_BYTE) {
      this.bytes.push(this.current);
      this.current = 0;
      this.used = 0;
    }
  }

  bits(value: number, count: number) {
    for (let i = count - 1; i >= 0; i--) this.bit(Math.floor(value / 2 ** i) & 1);
  }

  /** ue(v). */
  ue(value: number) {
    const code = value + 1;
    const length = Math.floor(Math.log2(code));
    this.bits(0, length);
    this.bits(code, length + 1);
  }

  /** se(v). */
  se(value: number) {
    this.ue(value > 0 ? 2 * value - 1 : -2 * value);
  }

  get aligned() {
    return this.used === 0;
  }

  /** 바이트 경계까지 0 비트를 채운다(pcm_alignment_zero_bit). */
  align() {
    while (!this.aligned) this.bit(0);
  }

  byte(value: number) {
    if (this.aligned) this.bytes.push(value & 0xff);
    else this.bits(value, BITS_PER_BYTE);
  }

  /** rbsp_trailing_bits: 끝 비트 1 과 0 채움. */
  finish(): number[] {
    this.bit(1);
    this.align();
    return this.bytes;
  }
}

/** RBSP 에 에뮬레이션 방지 바이트를 넣고 NAL 헤더를 붙인다(시작 코드 없음). */
function nal(refIdc: number, type: number, rbsp: readonly number[]): Uint8Array {
  const out = [(refIdc << REF_IDC_SHIFT) | type];
  let zeros = 0;
  for (const byte of rbsp) {
    if (zeros >= EMULATION_ZERO_RUN && byte <= EMULATION_PREVENTION_BYTE) {
      out.push(EMULATION_PREVENTION_BYTE);
      zeros = 0;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

/** NAL 들을 4바이트 시작 코드로 이어 붙인 Annex B. */
export function annexB(units: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = units.reduce((sum, unit) => sum + START_CODE.length + unit.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const unit of units) {
    out.set(START_CODE, at);
    out.set(unit, at + START_CODE.length);
    at += START_CODE.length + unit.length;
  }
  return out;
}

/** 베이스라인 SPS(NAL). 크기는 매크로블록(16픽셀) 단위다. */
export function buildSps(widthMbs: number, heightMbs: number): Uint8Array {
  const w = new BitWriter();
  w.byte(PROFILE_BASELINE);
  w.byte(CONSTRAINT_SET_01);
  w.byte(LEVEL_3_0);
  w.ue(0); // seq_parameter_set_id
  w.ue(LOG2_MAX_FRAME_NUM - 4); // log2_max_frame_num_minus4
  w.ue(POC_TYPE_OUTPUT_ORDER);
  w.ue(1); // max_num_ref_frames
  w.bit(0); // gaps_in_frame_num_value_allowed_flag
  w.ue(widthMbs - 1);
  w.ue(heightMbs - 1);
  w.bit(1); // frame_mbs_only_flag
  w.bit(1); // direct_8x8_inference_flag
  w.bit(0); // frame_cropping_flag
  w.bit(0); // vui_parameters_present_flag
  return nal(REF_IDC_HIGH, NAL.SPS, w.finish());
}

export function buildPps(): Uint8Array {
  const w = new BitWriter();
  w.ue(0); // pic_parameter_set_id
  w.ue(0); // seq_parameter_set_id
  w.bit(0); // entropy_coding_mode_flag: CAVLC
  w.bit(0); // bottom_field_pic_order_in_frame_present_flag
  w.ue(0); // num_slice_groups_minus1
  w.ue(0); // num_ref_idx_l0_default_active_minus1
  w.ue(0); // num_ref_idx_l1_default_active_minus1
  w.bit(0); // weighted_pred_flag
  w.bits(0, 2); // weighted_bipred_idc
  w.se(0); // pic_init_qp_minus26
  w.se(0); // pic_init_qs_minus26
  w.se(0); // chroma_qp_index_offset
  w.bit(0); // deblocking_filter_control_present_flag
  w.bit(0); // constrained_intra_pred_flag
  w.bit(0); // redundant_pic_cnt_present_flag
  return nal(REF_IDC_HIGH, NAL.PPS, w.finish());
}

// BT.601 제한 범위 YCbCr: 흰·노랑·청록·초록·자홍·빨강·파랑.
const BARS: readonly (readonly [number, number, number])[] = [
  [235, 128, 128],
  [210, 16, 146],
  [170, 166, 16],
  [145, 54, 34],
  [106, 202, 222],
  [81, 90, 240],
  [41, 240, 110],
];

const filled = (count: number, value: number) => new Array<number>(count).fill(value);

/** 검은 칸 가운데에 흰 점: 칸이 움직이는 것이 한눈에 보인다. 한 번만 만든다. */
const BOX_PCM = (() => {
  const luma: number[] = [];
  for (let y = 0; y < MACROBLOCK_SIZE; y++) {
    for (let x = 0; x < MACROBLOCK_SIZE; x++) {
      const inDot = x >= DOT_FROM && x < DOT_TO && y >= DOT_FROM && y < DOT_TO;
      luma.push(inDot ? LUMA_WHITE : LUMA_BLACK);
    }
  }
  return [...luma, ...filled(CHROMA_SAMPLES * 2, CHROMA_NEUTRAL)];
})();

/** 색 막대마다 매크로블록 하나의 I_PCM 샘플(휘도 256 + Cb 64 + Cr 64). 한 번만 만든다. */
const BAR_PCM = BARS.map(([y, cb, cr]) => [
  ...filled(LUMA_SAMPLES, y),
  ...filled(CHROMA_SAMPLES, cb),
  ...filled(CHROMA_SAMPLES, cr),
]);

/** 매크로블록 하나의 I_PCM 샘플. 검은 칸이 아니면 열 위치에 맞는 색 막대다. */
function pcmSamples(mbx: number, widthMbs: number, isBox: boolean): number[] {
  if (isBox) return BOX_PCM;
  return BAR_PCM[Math.floor((mbx * BARS.length) / widthMbs)] ?? BAR_PCM[0]!;
}

export interface TestStreamOptions {
  /** 프레임 수. */
  frames: number;
  /** 매크로블록 단위 크기(기본 10x6 = 160x96). */
  widthMbs?: number;
  heightMbs?: number;
  /** 키프레임 간격(프레임). */
  keyEvery?: number;
  /** 검은 칸이 한 칸 옮겨 가는 프레임 수. */
  stepFrames?: number;
}

export interface TestStream {
  data: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  frames: number;
  keyframes: number;
}

/** 화면 칸 배치와 프레임마다 검은 칸이 있는 자리. */
interface Layout {
  widthMbs: number;
  heightMbs: number;
  boxAddress: (frame: number) => number;
}

/** 매크로블록 하나를 I_PCM 으로 쓴다. mbType 은 I 슬라이스와 P 슬라이스가 다르다. */
function writeMacroblock(
  w: BitWriter,
  layout: Layout,
  address: number,
  mbType: number,
  box: number,
) {
  w.ue(mbType);
  w.align();
  const mbx = address % layout.widthMbs;
  for (const sample of pcmSamples(mbx, layout.widthMbs, address === box)) w.byte(sample);
}

/** IDR 슬라이스(키프레임): 모든 칸을 I_PCM 으로 쓴다. */
function buildKeyframeNal(layout: Layout, frame: number, idrPicId: number): Uint8Array {
  const w = new BitWriter();
  const box = layout.boxAddress(frame);
  w.ue(0); // first_mb_in_slice
  w.ue(SLICE_TYPE_I);
  w.ue(0); // pic_parameter_set_id
  w.bits(0, LOG2_MAX_FRAME_NUM); // frame_num
  w.ue(idrPicId % IDR_PIC_ID_RANGE);
  w.bit(0); // no_output_of_prior_pics_flag
  w.bit(0); // long_term_reference_flag
  w.se(0); // slice_qp_delta
  const mbs = layout.widthMbs * layout.heightMbs;
  for (let address = 0; address < mbs; address++) {
    writeMacroblock(w, layout, address, MB_TYPE_I_PCM, box);
  }
  return nal(REF_IDC_HIGH, NAL.IDR, w.finish());
}

/** P 슬라이스: 바뀐 칸(검은 칸이 떠난 자리와 닿은 자리)만 I_PCM 으로 쓰고 나머지는 건너뛴다. */
function buildDeltaNal(layout: Layout, frame: number, sinceKey: number): Uint8Array {
  const w = new BitWriter();
  const box = layout.boxAddress(frame);
  w.ue(0); // first_mb_in_slice
  w.ue(SLICE_TYPE_P);
  w.ue(0); // pic_parameter_set_id
  w.bits(sinceKey % 2 ** LOG2_MAX_FRAME_NUM, LOG2_MAX_FRAME_NUM); // frame_num
  w.bit(0); // num_ref_idx_active_override_flag
  w.bit(0); // ref_pic_list_modification_flag_l0
  w.bit(0); // adaptive_ref_pic_marking_mode_flag
  w.se(0); // slice_qp_delta
  const previous = layout.boxAddress(frame - 1);
  const changed = box === previous ? [] : [previous, box].sort((a, b) => a - b);
  let next = 0;
  for (const address of changed) {
    w.ue(address - next); // mb_skip_run
    writeMacroblock(w, layout, address, MB_TYPE_I_PCM_IN_P, box);
    next = address + 1;
  }
  const mbs = layout.widthMbs * layout.heightMbs;
  if (next < mbs) w.ue(mbs - next); // 남은 칸 모두 건너뜀
  return nal(REF_IDC_P_SLICE, NAL.SLICE, w.finish());
}

/** 시험 스트림. SPS·PPS 는 맨 앞에 한 번만 둔다(Tier 0 클립 구간과 같다). */
export function buildTestH264Stream({
  frames,
  widthMbs = DEFAULT_WIDTH_MBS,
  heightMbs = DEFAULT_HEIGHT_MBS,
  keyEvery = DEFAULT_KEY_EVERY,
  stepFrames = DEFAULT_STEP_FRAMES,
}: TestStreamOptions): TestStream {
  const boxRow = Math.floor(heightMbs / 2);
  const layout: Layout = {
    widthMbs,
    heightMbs,
    boxAddress: (frame) => boxRow * widthMbs + (Math.floor(frame / stepFrames) % widthMbs),
  };

  const units: Uint8Array[] = [buildSps(widthMbs, heightMbs), buildPps()];
  let keyframes = 0;
  let sinceKey = 0;
  for (let frame = 0; frame < frames; frame++) {
    if (frame % keyEvery === 0) {
      sinceKey = 0;
      units.push(buildKeyframeNal(layout, frame, keyframes));
      keyframes += 1;
    } else {
      sinceKey += 1;
      units.push(buildDeltaNal(layout, frame, sinceKey));
    }
  }
  return {
    data: annexB(units),
    width: widthMbs * MACROBLOCK_SIZE,
    height: heightMbs * MACROBLOCK_SIZE,
    frames,
    keyframes,
  };
}
