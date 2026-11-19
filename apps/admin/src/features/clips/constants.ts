// 클립 영상 감싸기·재생에 쓰는 고정값. 숫자의 출처는 H.264(ITU-T H.264)와 MP4(ISO/IEC 14496-12·15) 규격이다.

// ── 클립 원본 ──

/** Tier 0 원본: H.264 Annex B 기본 스트림. 브라우저가 바로 재생하지 못해 MP4 로 감싼다. */
export const CONTAINER_ANNEXB = 'h264-annexb';
/** 서명 주소를 그대로 재생할 수 있는 MP4. */
export const CONTAINER_MP4 = 'mp4';
/** 감싼 MP4 blob 의 형식. */
export const MP4_MIME = 'video/mp4';

/** 서버가 정한 클립 거절 이유(ApiError.code). */
export const CLIP_ERROR = {
  /** 자동 보존 클립은 보존 표시를 뗄 수 없다(409). */
  AUTO_RETAINED: 'CLIP_AUTO_RETAINED',
  /** 보관 기간이 지나 지운 클립(410). */
  DELETED: 'CLIP_DELETED',
} as const;

// ── 클립 준비 ──

/**
 * 위험 구간이 시작된 뒤 클립이 목록에 오기까지 기다리는 시간(ms). Tier 0 가 사후 20초를 채우고(카메라가 멈추면 마감 여유 5초 더)
 * 잘라 올린 뒤 기록을 보낸다(설계 S15P31A101-748). 업로드는 카메라 4대 × 약 20 MB 라 1분 남짓 잡았다. 이 안에서 클립이 없으면
 * 「영상 준비 중」, 지나도 없으면 클립 없음으로 본다(늦게 와도 다시 받기로 보인다).
 */
export const CLIP_PREPARE_MS = 120_000;

// ── H.264 스트림 ──

/** nal_unit_type. */
export const NAL = { SLICE: 1, IDR: 5, SEI: 6, SPS: 7, PPS: 8, AUD: 9 } as const;
/** NAL 헤더 첫 바이트에서 nal_unit_type 이 든 하위 5비트. */
export const NAL_TYPE_MASK = 0x1f;
/** 슬라이스 헤더 첫 바이트의 맨 앞 비트. first_mb_in_slice 가 0 이면(ue(v) 의 첫 비트가 1) 켜진다. */
export const FIRST_MB_ZERO_BIT = 0x80;
/** MP4 샘플 안에서 NAL 앞에 붙는 길이 칸의 바이트 수. */
export const NAL_LENGTH_SIZE = 4;
/** 에뮬레이션 방지 바이트(00 00 03 의 03). */
export const EMULATION_PREVENTION_BYTE = 3;
/** 에뮬레이션 방지 바이트 앞에 이어지는 0 바이트의 개수. */
export const EMULATION_ZERO_RUN = 2;

/** SPS NAL 의 고정 머리: NAL 헤더 1 + profile_idc·constraint 플래그·level_idc 3 바이트. 이 뒤부터 비트 단위 칸이다. */
export const SPS_FIXED_BYTES = 4;
/** SPS 로 볼 수 있는 가장 짧은 NAL(고정 머리 + 비트 칸 1바이트). */
export const SPS_MIN_BYTES = 5;
/** ue(v) 앞에 올 수 있는 0 비트의 최대 개수. 넘으면 32비트를 벗어나는 값이라 깨진 스트림으로 본다. */
export const MAX_UE_LEADING_ZEROS = 32;
/** profile_idc 가 이 목록이면 SPS 에 색 형식·비트 깊이·스케일링 목록 칸이 더 붙는다. */
export const HIGH_PROFILES = new Set([
  100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135,
]);

/** chroma_format_idc: 4:2:0 (칸이 없을 때의 기본값). */
export const CHROMA_420 = 1;
/** chroma_format_idc: 4:2:2. */
export const CHROMA_422 = 2;
/** chroma_format_idc: 4:4:4. 색 평면을 따로 쓰는 칸이 있고 스케일링 목록이 12개다. */
export const CHROMA_444 = 3;
/** 비트 깊이 칸이 없을 때(8비트)의 기본값. */
export const DEFAULT_BIT_DEPTH = 8;
/** 스케일링 목록 개수(4:4:4 가 아닐 때·4:4:4 일 때). */
export const SCALING_LISTS = 8;
export const SCALING_LISTS_444 = 12;
/** 앞의 6개 스케일링 목록은 4x4(16칸), 나머지는 8x8(64칸)이다. */
export const SCALING_LISTS_4X4 = 6;
export const SCALING_LIST_SIZE_4X4 = 16;
export const SCALING_LIST_SIZE_8X8 = 64;
/** 스케일링 목록 값의 순환 범위와 첫 값. */
export const SCALING_RANGE = 256;
export const SCALING_START = 8;
/** 매크로블록 한 변(픽셀). SPS 의 크기는 이 단위로 적혀 있다. */
export const MACROBLOCK_SIZE = 16;

// avcC(AVCDecoderConfigurationRecord, ISO/IEC 14496-15 5.3.3.1)
export const AVCC_VERSION = 1;
/** 고정 머리 7바이트: 버전·프로파일·호환·레벨·길이 칸·SPS 개수·PPS 개수. */
export const AVCC_HEADER_BYTES = 7;
/** 프로파일이 high 계열일 때 뒤에 붙는 색 형식·비트 깊이 4바이트. */
export const AVCC_HIGH_EXTENSION_BYTES = 4;
/** 매개변수 집합 앞의 길이 칸(2바이트). */
export const PARAMETER_SET_LENGTH_SIZE = 2;
/** 예약 비트를 1 로 채운 값: 6비트(길이 칸·색 형식), 3비트(SPS 개수), 5비트(비트 깊이). */
export const RESERVED_6_BITS = 0xfc;
export const RESERVED_3_BITS = 0xe0;
export const RESERVED_5_BITS = 0xf8;

// ── MP4 상자 ──

/** 미디어 시간 단위(1/90000초). */
export const TIMESCALE = 90_000;
/** 영화 시간 단위(밀리초). */
export const MOVIE_TIMESCALE = 1_000;
export const MS_PER_SECOND = 1_000;
/** 상자 머리(크기 4 + 종류 4)의 바이트 수. */
export const BOX_HEADER_SIZE = 8;
/** 상자 크기와 파일 오프셋은 32비트다. 넘으면 MP4 로 감쌀 수 없다. */
export const MAX_U32 = 0xffff_ffff;

/** 프레임 속도를 알 수 없을 때(촬영 구간 길이가 없을 때)의 값. Tier 0 카메라 기본값이다. */
export const DEFAULT_FRAME_RATE = 15;
export const MIN_FRAME_RATE = 1;
export const MAX_FRAME_RATE = 60;

/** 16.16 고정 소수점의 1.0. */
export const FIXED_16_ONE = 0x0001_0000;
/** 단위 행렬. 마지막 칸만 2.30 고정 소수점이다. */
export const UNITY_MATRIX = [FIXED_16_ONE, 0, 0, 0, FIXED_16_ONE, 0, 0, 0, 0x4000_0000] as const;
/** mvhd 의 재생 음량 1.0(8.8 고정 소수점). */
export const FIXED_8_ONE = 0x0100;
/** 사진 해상도 72dpi(16.16 고정 소수점). */
export const RESOLUTION_72_DPI = 0x0048_0000;
/** 언어 und(미정)를 5비트 글자 3개로 쓴 값. */
export const LANGUAGE_UND = 0x55c4;

export const MAJOR_BRAND = 'isom';
export const MINOR_VERSION = 512;
export const COMPATIBLE_BRANDS = ['isom', 'iso2', 'avc1', 'mp41'] as const;

/** vmhd 상자 flags(규격이 1 로 정했다). */
export const FLAGS_VMHD = 1;
/** url 상자 flags: 자료가 파일 안에 있다. */
export const FLAGS_URL_SELF_CONTAINED = 1;
/** tkhd flags: 트랙 사용(1) + 영화에 포함(2). */
export const FLAGS_TRACK_ENABLED = 3;
/** 영상 트랙 번호. 트랙은 하나뿐이다. */
export const TRACK_ID = 1;
export const NEXT_TRACK_ID = 2;
/** avc1 항목: 자료 참조 번호·샘플당 프레임 수. */
export const DATA_REFERENCE_INDEX = 1;
export const FRAMES_PER_SAMPLE = 1;
/** avc1 항목: 색 깊이 24비트, pre_defined(-1). */
export const COLOR_DEPTH = 0x0018;
export const PRE_DEFINED_MINUS_ONE = 0xffff;
/** avc1 의 compressorname 칸(32바이트). */
export const COMPRESSOR_NAME_BYTES = 32;
/** hdlr: 영상 트랙의 종류와 이름. */
export const HANDLER_TYPE_VIDEO = 'vide';
export const VIDEO_HANDLER_NAME = 'VideoHandler\0';
