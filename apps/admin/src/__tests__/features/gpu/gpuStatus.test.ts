import {
  autoStopText,
  availabilityLabel,
  cellUsable,
  disabledFeatureNotices,
  formatElapsed,
  formatRegion,
  gpuDot,
  gpuErrorReason,
  gpuSummary,
  HOST_CPU_SLOW_SCORE,
  HOST_CPU_SLOW_TEXT,
  hostCpuWarning,
  isGpuOn,
  needsTierConfirm,
  prepRemainingText,
  prepStep,
  rowUsable,
  shortGpuName,
  tierWarning,
  vlmReadiness,
} from '@/features/gpu/gpuStatus';
import type {
  GpuLaunch,
  GpuOfferCell,
  GpuOffers,
  GpuSession,
  GpuStatus,
} from '@/features/gpu/types';
import { describe, expect, it } from 'vitest';

const T = 1_793_000_000_000;

const session = (change: Partial<GpuSession> = {}): GpuSession => ({
  session_id: 's-1',
  state: 'ACTIVE',
  stage: 'WEIGHTS',
  stage_reason_code: null,
  provider: 'RUNPOD',
  instance_id: 'pod-1',
  gpu_type: 'NVIDIA H100 80GB HBM3',
  region: 'AP-JP-1',
  price_per_hour_usd: 3,
  registered_at_ms: T + 60_000,
  elapsed_ms: 0,
  tier0_link: 'DISCONNECTED',
  ...change,
});

const launch = (change: Partial<GpuLaunch> = {}): GpuLaunch => ({
  launch_id: 'l-1',
  state: 'RUNNING',
  provider: 'RUNPOD',
  gpu_type: 'NVIDIA H100 80GB HBM3',
  region: 'AP-JP-1',
  cloud_type: 'SECURE',
  interruptible: false,
  price_per_hour_usd: 3,
  requested_by: 'admin1',
  requested_at_ms: T,
  instance_id: 'pod-1',
  ended_at_ms: null,
  end_reason: null,
  failure_code: null,
  ...change,
});

const status = (change: Partial<GpuStatus>): GpuStatus => ({
  session: null,
  server_time_ms: T,
  launch: null,
  power: 'OFF',
  stop_block: null,
  ...change,
});

describe('gpuDot', () => {
  it('서버 power 를 점 네 가지로 줄인다(켜는 중·준비 중은 같은 노랑)', () => {
    expect(gpuDot(status({ power: 'OFF' }), false)).toBe('OFF');
    expect(gpuDot(status({ power: 'STARTING' }), false)).toBe('PREPARING');
    expect(gpuDot(status({ power: 'PREPARING' }), false)).toBe('PREPARING');
    expect(gpuDot(status({ power: 'CONNECTED' }), true)).toBe('CONNECTED');
    expect(gpuDot(status({ power: 'ERROR' }), false)).toBe('ERROR');
  });

  it('상태를 못 받으면(관리자 아님) Tier 0 연결만으로 가른다', () => {
    expect(gpuDot(undefined, true)).toBe('CONNECTED');
    expect(gpuDot(undefined, false)).toBe('OFF');
  });

  it('power 가 없는 옛 서버 응답은 세션으로 고른다', () => {
    expect(gpuDot(status({ power: undefined, session: session({ stage: 'READY' }) }), false)).toBe(
      'CONNECTED',
    );
    expect(gpuDot(status({ power: undefined, session: session({ stage: 'FAILED' }) }), false)).toBe(
      'ERROR',
    );
    expect(gpuDot(status({ power: undefined, session: session() }), false)).toBe('PREPARING');
    expect(gpuDot(status({ power: undefined, session: session({ state: 'ENDED' }) }), false)).toBe(
      'OFF',
    );
  });
});

describe('prepStep', () => {
  it('켜는 중 → 가중치 → 엔진(Tier 0·vLLM 포함) → 준비 완료', () => {
    expect(prepStep(status({ power: 'STARTING', launch: launch() }))).toBe(0);
    expect(
      prepStep(status({ power: 'PREPARING', session: session({ stage: 'REGISTERED' }) })),
    ).toBe(1);
    expect(prepStep(status({ power: 'PREPARING', session: session({ stage: 'WEIGHTS' }) }))).toBe(
      1,
    );
    for (const stage of ['ENGINE', 'TIER0', 'VLLM']) {
      expect(prepStep(status({ power: 'PREPARING', session: session({ stage }) }))).toBe(2);
    }
    expect(
      prepStep(status({ power: 'CONNECTED', session: session({ stage: 'READY' }) })),
    ).toBeNull();
  });
});

describe('gpuSummary', () => {
  it('켠 요청부터 경과를 재고 시간당 가격으로 예상 비용을 내며 GPU 이름은 짧은 이름으로 통일한다', () => {
    const s = status({ power: 'PREPARING', launch: launch(), session: session() });
    const summary = gpuSummary(s, T + 30 * 60_000)!;
    expect(summary.gpuType).toBe('H100 SXM');
    expect(summary.region).toBe('AP-JP-1');
    expect(summary.elapsedMs).toBe(30 * 60_000);
    expect(summary.costUsd).toBeCloseTo(1.5);
  });

  it('켠 요청 없이 열린 세션(손으로 켬)은 등록부터 재고, 가격을 모르면 비용을 비운다', () => {
    const s = status({ power: 'CONNECTED', session: session({ price_per_hour_usd: null }) });
    const summary = gpuSummary(s, T + 61 * 60_000)!;
    expect(summary.elapsedMs).toBe(60 * 60_000);
    expect(summary.costUsd).toBeNull();
  });

  it('꺼져 있으면 요약이 없다', () => {
    expect(gpuSummary(status({ launch: launch({ state: 'STOPPED' }) }), T)).toBeNull();
    expect(isGpuOn(status({ launch: launch({ state: 'FAILED' }) }))).toBe(false);
    expect(isGpuOn(status({ launch: launch({ state: 'REQUESTED' }) }))).toBe(true);
  });
});

describe('gpuErrorReason', () => {
  it('준비 실패는 사유 코드, 켜기 실패는 재고 여부를 보인다', () => {
    expect(
      gpuErrorReason(
        status({
          power: 'ERROR',
          session: session({ stage: 'FAILED', stage_reason_code: 'ENGINE_BUILD_FAILED' }),
        }),
      ),
    ).toBe('준비 실패 (ENGINE_BUILD_FAILED)');
    expect(
      gpuErrorReason(
        status({
          power: 'ERROR',
          launch: launch({ state: 'FAILED', failure_code: 'OUT_OF_STOCK' }),
        }),
      ),
    ).toBe('켜기 실패 (재고 없음)');
    expect(gpuErrorReason(status({ power: 'OFF' }))).toBeNull();
  });
});

describe('vlmReadiness(S15P31A101-706)', () => {
  it('VLLM 단계는 받는 중, READY 는 준비, 시한 초과 설명이 붙은 READY 는 시한 초과', () => {
    expect(vlmReadiness(status({ power: 'CONNECTED', session: session({ stage: 'VLLM' }) }))).toBe(
      'LOADING',
    );
    expect(vlmReadiness(status({ power: 'CONNECTED', session: session({ stage: 'READY' }) }))).toBe(
      'READY',
    );
    const timedOut = session({
      stage: 'READY',
      stage_detail: 'vLLM 미준비(시한 초과): VLM 근거·보고서 없이 관제',
    });
    expect(vlmReadiness(status({ power: 'CONNECTED', session: timedOut }))).toBe('TIMED_OUT');
  });

  it('세션 없음·끝난 세션·관리자 아님(상태 없음)·그 밖의 단계는 모름(지금 동작 그대로)', () => {
    expect(vlmReadiness(undefined)).toBe('UNKNOWN');
    expect(vlmReadiness(status({ power: 'CONNECTED' }))).toBe('UNKNOWN');
    expect(vlmReadiness(status({ session: session({ stage: 'VLLM', state: 'ENDED' }) }))).toBe(
      'UNKNOWN',
    );
    expect(vlmReadiness(status({ power: 'PREPARING', session: session({ stage: 'TIER0' }) }))).toBe(
      'UNKNOWN',
    );
  });
});

describe('formatElapsed', () => {
  it('분·시간으로 짧게', () => {
    expect(formatElapsed(30_000)).toBe('1분 미만');
    expect(formatElapsed(12 * 60_000)).toBe('12분');
    expect(formatElapsed(65 * 60_000)).toBe('1시간 5분');
    expect(formatElapsed(120 * 60_000)).toBe('2시간');
  });
});

describe('재고 글·VRAM 등급(S15P31A101-705)', () => {
  const cell = (change: Partial<GpuOfferCell> = {}): GpuOfferCell => ({
    gpu_type: 'g',
    region: 'r',
    stock: 'HIGH',
    price_per_hour_usd: 1,
    within_cap: true,
    ...change,
  });

  it('등급 글 없이 켤 수 있음·없음·모름, 공급자가 개수를 주면 n개', () => {
    expect(availabilityLabel(cell({ available: true }))).toBe('켤 수 있음');
    expect(availabilityLabel(cell({ stock: 'LOW' }))).toBe('켤 수 있음'); // available 없는 옛 응답
    expect(availabilityLabel(cell({ stock: 'NONE', available: false }))).toBe('없음');
    expect(availabilityLabel(cell({ stock: 'UNKNOWN', available: null }))).toBe('모름');
    expect(availabilityLabel(cell({ available: true, count: 3 }))).toBe('3개');
    expect(availabilityLabel(undefined)).toBe('없음');
  });

  it('모름은 고를 수 있고 없음·가격 상한 밖은 못 고른다', () => {
    expect(cellUsable(cell({ stock: 'UNKNOWN', available: null }))).toBe(true);
    expect(cellUsable(cell({ stock: 'NONE', available: false }))).toBe(false);
    expect(cellUsable(cell({ within_cap: false }))).toBe(false);
    expect(cellUsable(undefined)).toBe(false);
  });

  it('제한·위험만 확인을 더 받고, 경고는 안 되는 것을 말한다', () => {
    expect(needsTierConfirm('LIMITED')).toBe(true);
    expect(needsTierConfirm('RISKY')).toBe(true);
    expect(needsTierConfirm('BELOW_RECOMMENDED')).toBe(false);
    expect(needsTierConfirm(null)).toBe(false);
    expect(tierWarning('LIMITED')).toContain('세팅(맵 굽기)·VLM 근거·아바타가 안 됩니다');
    expect(tierWarning('RISKY')).toContain('Tier 0 최소 사양');
    expect(tierWarning('RECOMMENDED')).toBeNull();
    expect(tierWarning(undefined)).toBeNull();
  });
});

describe('S15P31A101-733: 짧은 GPU 이름·나라 이름 지역·예상 시간·켤 수 있는 행', () => {
  it('GPU 원문 이름을 짧은 이름으로 통일하고 지역에 나라 이름을 붙인다', () => {
    expect(shortGpuName('NVIDIA H100 80GB HBM3')).toBe('H100 SXM');
    expect(shortGpuName('NVIDIA GeForce RTX 4090')).toBe('RTX 4090');
    expect(shortGpuName('NVIDIA Custom GPU')).toBe('Custom GPU');
    expect(formatRegion('AP-JP-1')).toBe('일본 AP-JP-1');
    expect(formatRegion('EU-RO-1')).toBe('루마니아 EU-RO-1');
    expect(formatRegion('ap-northeast-2a')).toBe('한국 ap-northeast-2a');
    expect(formatRegion('UNKNOWN-1')).toBe('UNKNOWN-1');
  });

  it('준비 단계마다 예상 남은 시간을 안내하고 자동 정지까지 남은 시간을 계산한다', () => {
    expect(prepRemainingText(status({ power: 'STARTING', launch: launch() }))).toContain(
      '캐시 있으면 약 4분 (첫 부팅 20분 이상)',
    );
    expect(
      prepRemainingText(status({ power: 'PREPARING', session: session({ stage: 'WEIGHTS' }) })),
    ).toContain('약 3~4분');
    expect(
      prepRemainingText(status({ power: 'PREPARING', session: session({ stage: 'ENGINE' }) })),
    ).toContain('약 2~3분');
    expect(
      prepRemainingText(status({ power: 'CONNECTED', session: session({ stage: 'READY' }) })),
    ).toBeNull();

    const connected = status({
      power: 'CONNECTED',
      session: session({ stage: 'READY', registered_at_ms: T }),
    });
    expect(autoStopText(connected, T + 10 * 60_000, 30, null)).toBe('자동 정지까지 약 20분');
    expect(autoStopText(connected, T + 10 * 60_000, 30, T + 8 * 60_000)).toBe(
      '자동 정지까지 약 28분',
    );
    expect(autoStopText(connected, T + 10 * 60_000, 0, null)).toBe('자동 정지 꺼짐');
    expect(autoStopText({ ...connected, stop_block: 'LIVE' }, T + 10 * 60_000, 30, null)).toBe(
      '자동 정지 보류 (작업 중)',
    );
  });

  it('rowUsable: 켤 수 있는 칸이 하나라도 있는 행만 true', () => {
    const offers: GpuOffers = {
      provider: 'RUNPOD',
      cloud_type: 'SECURE',
      interruptible: false,
      max_price_per_hour_usd: 3,
      gpu_types: [],
      regions: [{ region: 'AP-JP-1', name: 'JP', preferred: true }],
      cells: [
        {
          gpu_type: 'G1',
          region: 'AP-JP-1',
          stock: 'HIGH',
          available: true,
          price_per_hour_usd: 2,
          within_cap: true,
        },
        {
          gpu_type: 'G2',
          region: 'AP-JP-1',
          stock: 'NONE',
          available: false,
          price_per_hour_usd: 2,
          within_cap: true,
        },
      ],
      default: null,
      fetched_at_ms: T,
    };
    expect(rowUsable(offers, 'G1')).toBe(true);
    expect(rowUsable(offers, 'G2')).toBe(false);
  });
});

describe('hostCpuWarning(S15P31A101-740)', () => {
  const cpu = (score: number | null) => ({
    model: 'Intel(R) Xeon(R) Platinum 8460Y+',
    logical_cpus: 160,
    cpu_quota: null,
    single_thread_score: score,
    measured_at: T,
  });

  it('기준 미만이면 경고 글을 낸다', () => {
    const s = status({ session: session({ host_cpu: cpu(HOST_CPU_SLOW_SCORE - 1) }) });
    expect(hostCpuWarning(s)).toBe(HOST_CPU_SLOW_TEXT);
    expect(HOST_CPU_SLOW_TEXT).toContain('끄고 다시 켜면 다른 서버에 배정될 수 있어요');
  });

  it('기준 이상·점수 모름·측정 없음·세션 없음·끝난 세션은 경고하지 않는다', () => {
    expect(
      hostCpuWarning(status({ session: session({ host_cpu: cpu(HOST_CPU_SLOW_SCORE) }) })),
    ).toBeNull();
    expect(hostCpuWarning(status({ session: session({ host_cpu: cpu(null) }) }))).toBeNull();
    expect(hostCpuWarning(status({ session: session({ host_cpu: null }) }))).toBeNull();
    expect(hostCpuWarning(status({ session: session() }))).toBeNull();
    expect(hostCpuWarning(status({ session: null }))).toBeNull();
    expect(hostCpuWarning(undefined)).toBeNull();
    expect(
      hostCpuWarning(status({ session: session({ state: 'ENDED', host_cpu: cpu(10) }) })),
    ).toBeNull();
  });
});

describe('disabledFeatureNotices(꺼진 기능 항목, -747·-756)', () => {
  const ready = (change: Partial<GpuSession> = {}) =>
    ({ session: session({ stage: 'READY', ...change }) }) as unknown as GpuStatus;
  const reid = {
    key: 'reid',
    level: 'warning' as const,
    text: 'Re-ID 꺼짐 — 관리자: seed-reid 필요',
    detail: 'FileNotFoundError: cope',
  };
  const cfg = {
    key: 'cfg_live_calibration',
    level: 'info' as const,
    text: '사람 관절 보정은 기본 꺼짐',
  };

  it('경고와 정보를 나누고 원문은 detail 로 둔다', () => {
    const got = disabledFeatureNotices(ready({ disabled_notices: [reid, cfg] }));
    expect(got.warnings).toEqual([
      { key: 'reid', text: reid.text, detail: 'FileNotFoundError: cope' },
    ]);
    expect(got.infos).toEqual([{ key: cfg.key, text: cfg.text, detail: null }]);
  });

  it('해소돼 항목이 빠진 최신 값이면 경고가 없다', () => {
    expect(disabledFeatureNotices(ready({ disabled_notices: [cfg] })).warnings).toEqual([]);
    expect(disabledFeatureNotices(ready({ disabled_notices: [] }))).toEqual({
      warnings: [],
      infos: [],
    });
  });

  it('옛 보고기(disabled_notices 없음)는 disabled_features 문구를 경고로 보인다', () => {
    expect(disabledFeatureNotices(ready({ disabled_features: ['PPE 꺼짐'] })).warnings).toEqual([
      { key: 'PPE 꺼짐', text: 'PPE 꺼짐', detail: null },
    ]);
  });

  it('모르거나(없음·null) 비어 있으면 경고가 없다', () => {
    const none = { warnings: [], infos: [] };
    expect(disabledFeatureNotices(ready({ disabled_features: undefined }))).toEqual(none);
    expect(
      disabledFeatureNotices(ready({ disabled_features: null, disabled_notices: null })),
    ).toEqual(none);
    expect(disabledFeatureNotices(ready({ disabled_features: [] }))).toEqual(none);
    expect(disabledFeatureNotices(undefined)).toEqual(none);
  });

  it('준비 전이거나 끝난 세션은 보이지 않는다', () => {
    const none = { warnings: [], infos: [] };
    expect(disabledFeatureNotices(ready({ stage: 'ENGINE', disabled_notices: [reid] }))).toEqual(
      none,
    );
    expect(disabledFeatureNotices(ready({ state: 'ENDED', disabled_notices: [reid] }))).toEqual(
      none,
    );
  });
});
