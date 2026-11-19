import { GPU_ERROR } from '@/features/gpu/api';
import type { GpuOfferCell, GpuOffers, GpuStatus, GpuTier } from '@/features/gpu/types';
import { ApiError } from '@/lib/http';

// 상단바 GPU 점·정보창·패널·설정이 쓰는 순수 계산(S15P31A101-702, -705, -733). 서버 상태(GET /api/gpu/sessions/current 의 power·launch·session)를
// 점 네 가지로 줄이고, 정보창 줄(짧은 GPU 이름·지역, 경과·단가·예상 비용, 자동 정지 남은 시간, 준비 단계·예상 남은 시간)을 만든다.

export interface GpuCatalogItem {
  gpuType: string;
  name: string;
  memoryGb: number | null;
}

/** RunPod 재고 표 기준 GPU 목록(설정 화면 목록 선택·짧은 이름 통일용, S15P31A101-733) */
export const RUNPOD_GPU_CATALOG: readonly GpuCatalogItem[] = [
  { gpuType: 'NVIDIA H100 80GB HBM3', name: 'H100 SXM', memoryGb: 80 },
  { gpuType: 'NVIDIA H100 NVL', name: 'H100 NVL', memoryGb: 94 },
  { gpuType: 'NVIDIA H100 PCIe', name: 'H100 PCIe', memoryGb: 80 },
  { gpuType: 'NVIDIA H200', name: 'H200 SXM', memoryGb: 141 },
  { gpuType: 'NVIDIA H200 NVL', name: 'H200 NVL', memoryGb: 143 },
  { gpuType: 'NVIDIA A100-SXM4-80GB', name: 'A100 SXM', memoryGb: 80 },
  { gpuType: 'NVIDIA A100 80GB PCIe', name: 'A100 PCIe', memoryGb: 80 },
  { gpuType: 'NVIDIA B200', name: 'B200', memoryGb: 180 },
  { gpuType: 'NVIDIA L40S', name: 'L40S', memoryGb: 48 },
  { gpuType: 'NVIDIA L40', name: 'L40', memoryGb: 48 },
  { gpuType: 'NVIDIA A40', name: 'A40', memoryGb: 48 },
  { gpuType: 'NVIDIA RTX 6000 Ada Generation', name: 'RTX 6000 Ada', memoryGb: 48 },
  { gpuType: 'NVIDIA RTX A6000', name: 'RTX A6000', memoryGb: 48 },
  { gpuType: 'NVIDIA GeForce RTX 5090', name: 'RTX 5090', memoryGb: 32 },
  { gpuType: 'NVIDIA GeForce RTX 4090', name: 'RTX 4090', memoryGb: 24 },
  { gpuType: 'NVIDIA L4', name: 'L4', memoryGb: 24 },
  { gpuType: 'NVIDIA GeForce RTX 3090', name: 'RTX 3090', memoryGb: 24 },
  { gpuType: 'NVIDIA RTX A5000', name: 'RTX A5000', memoryGb: 24 },
  { gpuType: 'NVIDIA RTX A4000', name: 'RTX A4000', memoryGb: 16 },
];

/** AWS 서울 GPU 인스턴스 목록(S15P31A101-703, -733) */
export const AWS_GPU_CATALOG: readonly GpuCatalogItem[] = [
  { gpuType: 'p5.48xlarge', name: 'p5.48xlarge · H100', memoryGb: 80 },
  { gpuType: 'p4de.24xlarge', name: 'p4de.24xlarge · A100 80GB', memoryGb: 80 },
  { gpuType: 'p4d.24xlarge', name: 'p4d.24xlarge · A100 40GB', memoryGb: 40 },
  { gpuType: 'g6e.2xlarge', name: 'g6e.2xlarge · L40S', memoryGb: 48 },
  { gpuType: 'g6e.4xlarge', name: 'g6e.4xlarge · L40S', memoryGb: 48 },
  { gpuType: 'g6e.12xlarge', name: 'g6e.12xlarge · L40S', memoryGb: 48 },
  { gpuType: 'g7e.2xlarge', name: 'g7e.2xlarge', memoryGb: 48 },
  { gpuType: 'g6.2xlarge', name: 'g6.2xlarge · L4', memoryGb: 24 },
  { gpuType: 'g5.2xlarge', name: 'g5.2xlarge · A10G', memoryGb: 24 },
];

const KNOWN_GPU_SHORT_NAMES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(RUNPOD_GPU_CATALOG.map((item) => [item.gpuType, item.name])),
  'NVIDIA H200 SXM': 'H200 SXM',
  'NVIDIA A100-SXM4-40GB': 'A100 SXM 40GB',
  'AMD Instinct MI300X OAM': 'MI300X',
  'AMD Instinct MI350X': 'MI350X',
  'Tesla V100-SXM2-16GB': 'V100 SXM2',
  'Tesla V100-SXM2-32GB': 'V100 SXM2 32GB',
  'Tesla V100-PCIE-16GB': 'Tesla V100',
  'Tesla V100-FHHL-16GB': 'Tesla V100',
};

/**
 * 켜기 표·정보창·패널·설정의 GPU 이름을 짧은 이름(예: H100 SXM)으로 통일한다(S15P31A101-733).
 * 카탈로그 ID(NVIDIA H100 80GB HBM3 등)는 매핑 표를 먼저 보고, 없으면 제조사 접두사를 뗀다.
 */
export function shortGpuName(gpuType: string, rawName?: string | null): string {
  const id = gpuType.trim();
  const mappedById = KNOWN_GPU_SHORT_NAMES[id];
  if (mappedById) return mappedById;
  const candidate = rawName && rawName.trim().length > 0 ? rawName.trim() : id;
  const mappedByName = KNOWN_GPU_SHORT_NAMES[candidate];
  if (mappedByName) return mappedByName;
  return candidate
    .replace(/^(?:NVIDIA\s+GeForce\s+|NVIDIA\s+|AMD\s+Instinct\s+)/i, '')
    .replace(/\s+Ada\s+Generation$/i, ' Ada')
    .trim();
}

/** RunPod 재고 표 지역 코드 목록(설정 화면 선택용) */
export const RUNPOD_REGION_CATALOG: readonly string[] = [
  'AP-JP-1',
  'OC-AU-1',
  'AP-IN-1',
  'CA-MTL-1',
  'CA-MTL-3',
  'CA-MTL-4',
  'EU-RO-1',
  'EU-SE-1',
  'EU-CZ-1',
  'EU-FR-1',
  'EU-NL-1',
  'EU-IS-1',
  'US-TX-3',
  'US-CA-2',
  'US-GA-1',
  'US-KS-2',
];

/** AWS 서울 가용 영역 목록(설정 화면 선택용) */
export const AWS_REGION_CATALOG: readonly string[] = [
  'ap-northeast-2a',
  'ap-northeast-2b',
  'ap-northeast-2c',
  'ap-northeast-2d',
];

const COUNTRY_BY_ISO: Readonly<Record<string, string>> = {
  JP: '일본',
  KR: '한국',
  AU: '호주',
  NZ: '뉴질랜드',
  IN: '인도',
  SG: '싱가포르',
  TW: '대만',
  HK: '홍콩',
  CA: '캐나다',
  US: '미국',
  RO: '루마니아',
  SE: '스웨덴',
  NO: '노르웨이',
  FI: '핀란드',
  IS: '아이슬란드',
  CZ: '체코',
  DE: '독일',
  FR: '프랑스',
  NL: '네덜란드',
  GB: '영국',
  UK: '영국',
  IE: '아일랜드',
  ES: '스페인',
  IT: '이탈리아',
  PL: '폴란드',
  BG: '불가리아',
  AT: '오스트리아',
  CH: '스위스',
  BE: '벨기에',
  DK: '덴마크',
  PT: '포르투갈',
  HU: '헝가리',
  GR: '그리스',
  BR: '브라질',
  AE: '아랍에미리트',
  ZA: '남아프리카',
};

const AREA_PREFIXES: ReadonlySet<string> = new Set([
  'AP',
  'OC',
  'EU',
  'SA',
  'ME',
  'AF',
  'SEA',
  'NA',
]);

const AWS_REGION_COUNTRIES: readonly [RegExp, string][] = [
  [/^ap-northeast-2[a-z]?$/i, '한국'],
  [/^ap-northeast-[13][a-z]?$/i, '일본'],
  [/^ap-southeast-1[a-z]?$/i, '싱가포르'],
  [/^ap-southeast-2[a-z]?$/i, '호주'],
  [/^ap-south-\d[a-z]?$/i, '인도'],
  [/^us-(?:east|west)-\d[a-z]?$/i, '미국'],
  [/^ca-central-\d[a-z]?$/i, '캐나다'],
  [/^eu-central-\d[a-z]?$/i, '독일'],
  [/^eu-west-1[a-z]?$/i, '아일랜드'],
  [/^eu-west-2[a-z]?$/i, '영국'],
  [/^eu-west-3[a-z]?$/i, '프랑스'],
  [/^eu-north-1[a-z]?$/i, '스웨덴'],
  [/^sa-east-1[a-z]?$/i, '브라질'],
];

/** 지역 코드에서 나라 이름을 찾는다(모르면 null) */
export function regionCountry(region: string): string | null {
  const code = region.trim();
  if (!code) return null;
  for (const [pattern, country] of AWS_REGION_COUNTRIES) {
    if (pattern.test(code)) return country;
  }
  const parts = code.toUpperCase().split('-');
  if (parts.length >= 2) {
    const first = parts[0]!;
    const second = parts[1]!;
    if (AREA_PREFIXES.has(first) && COUNTRY_BY_ISO[second]) {
      return COUNTRY_BY_ISO[second]!;
    }
    if (COUNTRY_BY_ISO[first]) {
      return COUNTRY_BY_ISO[first]!;
    }
    if (COUNTRY_BY_ISO[second]) {
      return COUNTRY_BY_ISO[second]!;
    }
  }
  return null;
}

/** 지역 표시: 나라 이름+코드(예: 일본 AP-JP-1). 나라를 모르면 코드 원문 그대로 */
export function formatRegion(region: string): string {
  const code = region.trim();
  const country = regionCountry(code);
  return country ? `${country} ${code}` : code;
}

/** 상단바 점: 초록 연결 / 노랑(깜빡임) 준비 중 / 회색 꺼짐 / 빨강 오류 */
export type GpuDot = 'CONNECTED' | 'PREPARING' | 'OFF' | 'ERROR';

/** 점 상태 글. 상단바에는 「GPU」만 두고(-705) 이 글은 정보창 첫 줄과 화면 읽기 이름에 쓴다 */
export const DOT_LABEL: Record<GpuDot, string> = {
  CONNECTED: 'GPU 연결',
  PREPARING: 'GPU 준비 중',
  OFF: 'GPU 꺼짐',
  ERROR: 'GPU 오류',
};

/** 준비 단계 이름. 0 은 공급자가 인스턴스를 띄우는 중(G1 등록 전) */
export const PREP_STEPS = ['켜는 중', '가중치', '엔진', '준비 완료'] as const;

/**
 * 점 상태. 관리자가 아니라 상태를 못 받았으면(status 없음) Tier 0 연결만으로 연결·꺼짐을 가른다.
 * 서버가 power 를 싣지 않았으면(-702 이전 서버) 세션으로 고른다.
 */
export function gpuDot(status: GpuStatus | undefined, tier0Connected: boolean): GpuDot {
  if (!status) return tier0Connected ? 'CONNECTED' : 'OFF';
  switch (status.power) {
    case 'CONNECTED':
      return 'CONNECTED';
    case 'STARTING':
    case 'PREPARING':
      return 'PREPARING';
    case 'ERROR':
      return 'ERROR';
    case 'OFF':
      return 'OFF';
    default: {
      const s = status.session;
      if (!s || s.state !== 'ACTIVE') return 'OFF';
      if (s.stage === 'FAILED') return 'ERROR';
      return s.stage === 'READY' || s.tier0_link === 'CONNECTED' ? 'CONNECTED' : 'PREPARING';
    }
  }
}

/** 준비 단계 번호(PREP_STEPS). 준비 중이 아니면 null */
export function prepStep(status: GpuStatus | undefined): number | null {
  if (!status) return null;
  if (status.power === 'STARTING') return 0;
  if (status.power !== 'PREPARING') return null;
  const stage = status.session?.stage;
  if (stage === 'ENGINE' || stage === 'TIER0' || stage === 'VLLM') return 2;
  if (stage === 'READY') return 3;
  return 1;
}

/** 켜기 패널·확인창 예상 준비 시간 안내(S15P31A101-733, 17차 실측 반영) */
export const LAUNCH_PREP_TIME_NOTE = '예상 준비 시간: 캐시 있으면 약 4분, 첫 부팅 20분 이상';

/** 끄기 확인창 다시 켤 때 예상 시간 안내(S15P31A101-733) */
export const STOP_RELAUNCH_TIME_NOTE = '다시 켜면 준비에 약 4분(첫 부팅은 20분 이상) 걸립니다.';

/** 준비 중 정보창의 단계별 예상 남은 시간(S15P31A101-733). 준비 중이 아니면 null */
export function prepRemainingText(status: GpuStatus | undefined): string | null {
  const step = prepStep(status);
  if (step === null) return null;
  if (step === 0) return '예상 남은 시간: 캐시 있으면 약 4분 (첫 부팅 20분 이상)';
  if (step === 1) return '예상 남은 시간: 캐시 있으면 약 3~4분 (첫 부팅 15~20분)';
  if (step === 2) {
    return status?.session?.stage === 'VLLM'
      ? '예상 남은 시간: 캐시 있으면 약 1~3분 (첫 부팅 10분 이상)'
      : '예상 남은 시간: 캐시 있으면 약 2~3분 (첫 빌드 10~15분)';
  }
  return '예상 남은 시간: 1분 미만';
}

/**
 * VLM(vLLM) 준비 상태(S15P31A101-706). 열린 GPU 세션의 부팅 단계로만 판단한다(-700 보고).
 * LOADING: 단계 VLLM(Tier 0 는 준비됐고 VLM 가중치 31.5GB 받기·vLLM 기동 대기)
 * TIMED_OUT: READY 인데 단계 설명이 「vLLM 미준비(시한 초과)…」 계열(VLM 근거·보고서 없이 관제)
 * READY: 그 밖의 READY. UNKNOWN: 세션 없음(손으로 켠 GPU 등)·관리자 아님(상태 없음)·그 밖의 단계 → 화면은 지금 동작 그대로
 */
export type VlmReadiness = 'LOADING' | 'TIMED_OUT' | 'READY' | 'UNKNOWN';

/** 부팅이 vLLM 시한 초과 READY 에 싣는 설명의 공통 부분(deploy/scripts/simai_gpu_boot.py lobby_stage) */
export const VLLM_TIMEOUT_MARK = 'vLLM 미준비';

export function vlmReadiness(status: GpuStatus | undefined): VlmReadiness {
  const session = status?.session;
  if (!session || session.state !== 'ACTIVE') return 'UNKNOWN';
  if (session.stage === 'VLLM') return 'LOADING';
  if (session.stage !== 'READY') return 'UNKNOWN';
  return session.stage_detail?.includes(VLLM_TIMEOUT_MARK) ? 'TIMED_OUT' : 'READY';
}

/** 켜져 있거나 켜는 중이라 끄기 대상이 있는지(없으면 패널이 켜기를 보인다) */
export function isGpuOn(status: GpuStatus | undefined): boolean {
  if (!status) return false;
  const launch = status.launch;
  if (launch && (launch.state === 'REQUESTED' || launch.state === 'RUNNING')) return true;
  return status.session?.state === 'ACTIVE';
}

export interface GpuSummary {
  gpuType: string;
  region: string | null;
  /** 켠 뒤 지난 시간(ms). 켠 요청이 열려 있으면 요청부터, 아니면 세션 등록부터 */
  elapsedMs: number;
  pricePerHourUsd: number | null;
  /** 시간당 가격 × 경과. 가격을 모르면 null */
  costUsd: number | null;
}

/** 정보창 요약. 켜져 있지 않으면 null. nowMs 는 서버 시계로 맞춘 지금. gpuType 은 짧은 이름으로 통일한다(-733) */
export function gpuSummary(status: GpuStatus | undefined, nowMs: number): GpuSummary | null {
  if (!status || !isGpuOn(status)) return null;
  const session = status.session?.state === 'ACTIVE' ? status.session : null;
  const launch =
    status.launch && (status.launch.state === 'REQUESTED' || status.launch.state === 'RUNNING')
      ? status.launch
      : null;
  const started = launch?.requested_at_ms ?? session?.registered_at_ms ?? nowMs;
  const elapsedMs = Math.max(0, nowMs - started);
  const price = session?.price_per_hour_usd ?? launch?.price_per_hour_usd ?? null;
  const rawGpuType = session?.gpu_type ?? launch?.gpu_type ?? '';
  return {
    gpuType: rawGpuType ? shortGpuName(rawGpuType) : '',
    region: session?.region ?? launch?.region ?? null,
    elapsedMs,
    pricePerHourUsd: price,
    costUsd: price === null ? null : (price * elapsedMs) / 3_600_000,
  };
}

/** 서버 기본 유휴 자동 정지 분(GpuProperties.Defaults) */
export const DEFAULT_AUTO_STOP_IDLE_MINUTES = 30;

/**
 * 연결된 GPU 의 자동 정지까지 남은 시간 문구(S15P31A101-733).
 * 연결 상태(CONNECTED)에서만 보이며, 관제·세팅 중이면 보류를, 0분이면 꺼짐을 알린다.
 * 시작점은 준비 완료(stage_at_ms 또는 registered_at_ms)와 마지막 화면 조작 시각 중 늦은 쪽을 기준으로 삼고,
 * 서버 쪽 최근 활동(작업·세팅 종료 등)으로 이미 기준 시간을 넘긴 채 켜져 있으면 유휴 기준 시간을 안내한다.
 */
export function autoStopText(
  status: GpuStatus | undefined,
  nowMs: number,
  idleMinutes: number = DEFAULT_AUTO_STOP_IDLE_MINUTES,
  lastActivityMs?: number | null,
): string | null {
  if (!status || gpuDot(status, false) !== 'CONNECTED') return null;
  if (idleMinutes <= 0) return '자동 정지 꺼짐';
  if (status.stop_block === 'LIVE') return '자동 정지 보류 (작업 중)';
  if (status.stop_block === 'SETUP') return '자동 정지 보류 (세팅 중)';
  const session = status.session?.state === 'ACTIVE' ? status.session : null;
  const windowMs = idleMinutes * 60_000;
  const baseMs = session?.stage_at_ms ?? session?.registered_at_ms ?? null;
  const sinceMs =
    baseMs !== null && nowMs - baseMs < windowMs
      ? Math.max(baseMs, lastActivityMs ?? 0)
      : (lastActivityMs ?? baseMs);
  if (sinceMs !== null && sinceMs > 0) {
    const remainMs = windowMs - Math.max(0, nowMs - sinceMs);
    if (remainMs > 0) {
      return `자동 정지까지 약 ${formatElapsed(remainMs)}`;
    }
  }
  return `자동 정지: 유휴 ${idleMinutes}분 후`;
}

/** 오류 점일 때 한 줄 까닭 */
export function gpuErrorReason(status: GpuStatus | undefined): string | null {
  if (!status || status.power !== 'ERROR') return null;
  const session = status.session;
  if (session?.state === 'ACTIVE' && session.stage === 'FAILED') {
    return `준비 실패${session.stage_reason_code ? ` (${session.stage_reason_code})` : ''}`;
  }
  const launch = status.launch;
  if (launch?.state === 'FAILED') {
    return launch.failure_code === 'OUT_OF_STOCK' ? '켜기 실패 (재고 없음)' : '켜기 실패';
  }
  if (launch?.state === 'RUNNING' && session?.state === 'ENDED') return 'GPU 연결이 끊겼습니다';
  return '끄기 실패 · 다시 시도하세요';
}

/**
 * 느린 CPU 서버 기준(S15P31A101-740). 부팅 보고기가 잰 단일 스레드 점수(초당 반복, 클수록 빠름)가 이 값 미만이면 경고한다.
 * 초기값이다: 18차(2026-11-15)에 같은 H100 SXM AP-JP-1 의 두 번째 Pod(Xeon Platinum 8460Y+ 160코어 호스트)이 같은 계산에서
 * 스레드 CPU 시간이 2배였지만 첫 Pod 의 점수는 기록이 없다. 그래서 노트북 측정(약 2,300~3,200)의 0.4배쯤인 1,000 으로 시작하고,
 * 첫 라이브 실측(빠른 서버·느린 서버 점수)이 쌓이면 둘 사이로 조정한다. 근거와 절차는 docs/design/S15P31A101-740-gpu-host-cpu-check.md.
 */
export const HOST_CPU_SLOW_SCORE = 1000;

export const HOST_CPU_SLOW_TEXT =
  'CPU 가 느린 서버 — 사람이 많을 때 판정 지연이 늘 수 있음. 끄고 다시 켜면 다른 서버에 배정될 수 있어요';

/** 열린 세션의 호스트 CPU 점수가 기준 미만이면 경고 글, 아니면(점수 모름 포함) null. 조작은 없다 */
export function hostCpuWarning(status: GpuStatus | undefined): string | null {
  const session = status?.session;
  if (session?.state !== 'ACTIVE') return null;
  const score = session.host_cpu?.single_thread_score;
  if (typeof score !== 'number' || score >= HOST_CPU_SLOW_SCORE) return null;
  return HOST_CPU_SLOW_TEXT;
}

export interface DisabledNotice {
  key: string;
  text: string;
  detail: string | null;
}

export interface DisabledNotices {
  /** 조치·주의가 필요한 꺼짐(경고 줄) */
  warnings: DisabledNotice[];
  /** 의도된 설정·이미 지나간 사실(「자세히」 안에 접어 둔다, S15P31A101-756) */
  infos: DisabledNotice[];
}

const NO_NOTICES: DisabledNotices = { warnings: [], infos: [] };

/**
 * 열린 세션의 꺼진 기능 항목(S15P31A101-747, -756). 준비 완료(READY)에서만, 모르거나 없으면 빈 목록. 조작은 없다.
 * 부팅 보고기는 READY 뒤에도 주기로 다시 계산해 보고하므로 해소된 항목은 EC2 최신 값에서 빠진다. 옛 보고기(disabled_notices 없음)는
 * disabled_features 문구를 그대로 경고로 보인다(자세히 없음).
 */
export function disabledFeatureNotices(status: GpuStatus | undefined): DisabledNotices {
  const session = status?.session;
  if (session?.state !== 'ACTIVE' || session.stage !== 'READY') return NO_NOTICES;
  const notices = session.disabled_notices;
  if (notices) {
    const toNotice = (n: (typeof notices)[number]): DisabledNotice => ({
      key: n.key,
      text: n.text,
      detail: n.detail?.trim() ? n.detail : null,
    });
    const shown = notices.filter((n) => n.text.trim() !== '');
    return {
      warnings: shown.filter((n) => n.level === 'warning').map(toNotice),
      infos: shown.filter((n) => n.level === 'info').map(toNotice),
    };
  }
  const legacy = (session.disabled_features ?? [])
    .filter((t) => t.trim() !== '')
    .map((text) => ({ key: text, text, detail: null }));
  return { warnings: legacy, infos: [] };
}

export const STOP_BLOCK_TEXT: Record<'LIVE' | 'SETUP', string> = {
  LIVE: '관제(작업) 중에는 끌 수 없습니다',
  SETUP: '세팅 중에는 끌 수 없습니다',
};

/**
 * 칸 재고 글(S15P31A101-705): 1개 이상이면 되므로 등급(많음·보통·적음)은 쓰지 않는다. 켤 수 있음 / 없음 / 모름(AWS, 고를 수 있음).
 * 공급자가 개수를 주면 「n개」. 서버가 available 을 싣지 않았으면(-705 이전) 재고 등급에서 고른다.
 */
export function cellAvailable(cell: GpuOfferCell | undefined): boolean | null {
  if (!cell) return false;
  if (cell.available !== undefined) return cell.available;
  if (cell.stock === 'UNKNOWN') return null;
  return cell.stock !== 'NONE';
}

export function availabilityLabel(cell: GpuOfferCell | undefined): string {
  const available = cellAvailable(cell);
  if (available === null) return '모름';
  if (!available) return '없음';
  return cell?.count != null && cell.count > 0 ? `${cell.count}개` : '켤 수 있음';
}

/** 고를 수 있는 칸: 없음이 아니고(모름은 고를 수 있음) 가격 상한 안 */
export function cellUsable(cell: GpuOfferCell | undefined): boolean {
  return cell !== undefined && cellAvailable(cell) !== false && cell.within_cap;
}

/** 행에서 켤 수 있는 칸이 하나라도 있는지(S15P31A101-733: 기본 표시·추천 꼬리표 조건) */
export function rowUsable(offers: GpuOffers, gpuType: string): boolean {
  return offers.regions.some((r) =>
    cellUsable(offers.cells.find((c) => c.gpu_type === gpuType && c.region === r.region)),
  );
}

/** 추천 꼬리표 hover 설명 */
export const RECOMMENDED_TOOLTIP =
  '권장 사양(80GB급 H100·H200 계열): 관제·세팅·AI 근거·아바타를 모두 실행합니다.';

/** VRAM 등급 글. 추천 등급(80GB급)은 따로 표시하지 않는다(추천 표시는 H100·H200 계열의 「추천」) */
export const TIER_LABEL: Record<Exclude<GpuTier, 'RECOMMENDED'>, string> = {
  BELOW_RECOMMENDED: '권장 미만',
  LIMITED: '제한',
  RISKY: '위험',
};

/**
 * VRAM 등급 색(사용자 결정 2026-11-14, front/CONVENTION.md 의 위험 등급 색 예외): 권장 미만 노랑 / 제한 주황 / 위험 빨강.
 * -704 카메라 지연 배지·-702 GPU 점과 같은 신호등 쓰임이다.
 */
export const TIER_TONE: Record<Exclude<GpuTier, 'RECOMMENDED'>, string> = {
  BELOW_RECOMMENDED: 'text-sev-caution ring-sev-caution/50',
  LIMITED: 'text-sev-high ring-sev-high/50',
  RISKY: 'text-sev-critical ring-sev-critical/50',
};

/** 확인창 경고 글 색(TIER_TONE 과 같은 색) */
export const TIER_TEXT: Record<Exclude<GpuTier, 'RECOMMENDED'>, string> = {
  BELOW_RECOMMENDED: 'text-sev-caution',
  LIMITED: 'text-sev-high',
  RISKY: 'text-sev-critical',
};

/**
 * 켜기 확인창의 등급 경고. 제한·위험은 「이 GPU 로는 ○○ 가 안 됩니다」를 보이고 확인을 거쳐 켠다(막지 않음).
 * 문구는 부팅의 서비스 축소(deploy/scripts/simai_gpu_boot.py boot_services)와 맞춘다: 24~47GB 는 Tier 0 관제만(분석 워커가 없어 세팅도 안 됨).
 */
export function tierWarning(tier: GpuTier | null | undefined): string | null {
  switch (tier) {
    case 'LIMITED':
      return '이 GPU 로는 세팅(맵 굽기)·VLM 근거·아바타가 안 됩니다. VRAM 48GB급 미만이라 Tier 0 관제만 켭니다.';
    case 'RISKY':
      return '이 GPU 로는 관제 준비가 실패할 수 있습니다. VRAM 24GB급 미만이라 Tier 0 최소 사양에 못 미치고 세팅·VLM 근거·아바타도 안 됩니다(개발·시험용).';
    case 'BELOW_RECOMMENDED':
      return 'VRAM 80GB급 미만이라 VLM 근거·아바타가 메모리 부족으로 늦거나 빠질 수 있습니다.';
    default:
      return null;
  }
}

/** 확인을 한 번 더 받아야 하는 등급(제한·위험) */
export const needsTierConfirm = (tier: GpuTier | null | undefined) =>
  tier === 'LIMITED' || tier === 'RISKY';

/** "1시간 5분", "12분", "1분 미만" */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '1분 미만';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}분`;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** 켜기·끄기·설정 저장 실패를 안내 문구로 */
export function gpuErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case GPU_ERROR.ALREADY_ON:
        return 'GPU 가 이미 켜져 있거나 켜는 중입니다.';
      case GPU_ERROR.NOT_ON:
        return '켜져 있는 GPU 가 없습니다.';
      case GPU_ERROR.OUT_OF_STOCK:
        return '고른 GPU·지역에 재고가 없습니다. 다른 칸을 고르세요.';
      case GPU_ERROR.PRICE_OVER_CAP:
        return '시간당 가격이 GPU 설정(설정 → GPU)의 상한보다 높습니다.';
      case GPU_ERROR.STOP_BLOCKED_LIVE:
        return `${STOP_BLOCK_TEXT.LIVE}. 작업을 먼저 종료하세요.`;
      case GPU_ERROR.STOP_BLOCKED_SETUP:
        return `${STOP_BLOCK_TEXT.SETUP}. 세팅을 끝내거나 취소하세요.`;
      case GPU_ERROR.STOP_UNSUPPORTED:
        return '손으로 켠 GPU 는 여기서 끌 수 없습니다.';
      case GPU_ERROR.NOT_CONFIGURED:
        return 'GPU 공급자 설정(API 키 또는 템플릿 ID)이 없습니다. 설정의 GPU 구역을 확인하세요.';
      case GPU_ERROR.INVALID_SETTINGS:
        return '입력 값을 확인하세요.';
      case GPU_ERROR.PROVIDER_ERROR:
        return 'GPU 공급자 요청이 실패했습니다. 잠시 뒤 다시 시도하세요.';
    }
    if (error.status === 403) return '관리자만 할 수 있습니다.';
  }
  return '요청이 실패했습니다. 잠시 뒤 다시 시도하세요.';
}
