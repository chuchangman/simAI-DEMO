import { useCctvStore } from '@/features/cctv/cctv.store';
import { BackgroundCaptureModal } from '@/features/setup/BackgroundCaptureModal';
import {
  STAGE_A_WARNING_TITLE,
  stageAAlerts,
  stageAReasonText,
  visibleGuides,
} from '@/features/setup/cameraGuides';
import { step1NextStep } from '@/features/setup/nextStep';
import { deriveStep1Coverage, STAGE_A_FALLBACK_GUIDE } from '@/features/setup/setup';
import { StageAWarning } from '@/features/setup/StageAWarning';
import type {
  CoverageGuideItem,
  CoverageGuidesResponse,
  StageAPair,
  StageAReadiness,
  StageAStatus,
} from '@/features/setup/types';
import { coverageGuidesResponseSchema } from '@/features/setup/types';
import { buildCoverageGuidePayload } from '@/mocks/setup';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 세팅 보정(Stage A) 기준 경고(S15P31A101-761): 옆 4쌍의 미달·불안정만 「세팅 시작」 근처에 경고하고 시작은 막지 않는다.

vi.mock('@/features/cctv/useCctvPreview', () => ({
  useCctvPreview: () => ({ attach: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  useCctvStore.getState().reset();
});

const CAMS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];

const row = (
  a: string,
  b: string,
  status: StageAStatus,
  patch: Partial<StageAPair> = {},
): StageAPair => ({
  a,
  b,
  status,
  inliers: status === 'UNKNOWN' ? null : 80,
  cells_a: status === 'UNKNOWN' ? null : 5,
  cells_b: status === 'UNKNOWN' ? null : 5,
  shortfall: [],
  sufficient_rounds: status === 'READY' ? 4 : 0,
  observed_rounds: status === 'UNKNOWN' ? 0 : 4,
  ...patch,
});

const readiness = (pairs: StageAPair[]): StageAReadiness => ({
  min_inliers: 60,
  min_inlier_ratio: 0.1,
  grid: [4, 4],
  min_cell_inliers: 2,
  min_cells: 4,
  window_rounds: 4,
  pairs,
});

const mixed = readiness([
  row('cam_A', 'cam_B', 'READY'),
  row('cam_B', 'cam_C', 'UNSTABLE', {
    inliers: 52,
    shortfall: ['FEW_INLIERS'],
    sufficient_rounds: 3,
  }),
  row('cam_C', 'cam_D', 'SHORT', {
    inliers: 41,
    cells_a: 2,
    shortfall: ['FEW_INLIERS', 'CLUSTERED'],
  }),
  row('cam_A', 'cam_D', 'CONFIRMING', { sufficient_rounds: 2, observed_rounds: 2 }),
]);

const guide = (
  camera_id: string,
  pair: [string, string],
  direction: CoverageGuideItem['direction'] = 'RIGHT',
): CoverageGuideItem => ({
  camera_id,
  pair,
  direction,
  magnitude: 'SMALL',
  reason_code: 'OPTIONAL_IMPROVE',
});

const response = (
  stage: StageAReadiness | null,
  guides: CoverageGuideItem[] = [],
  stale = false,
): CoverageGuidesResponse => ({
  calibration_version: null,
  guides: [],
  site_id: 'classroom-1',
  status: stale ? 'STALE' : 'OK',
  stale,
  received_at_ms: 100,
  age_ms: stale ? 90_000 : 0,
  latest: { ...buildCoverageGuidePayload({ guides }), stage_a_readiness: stage },
});

describe('경고할 쌍 고르기', () => {
  it('옆 쌍의 미달·불안정만 고르고 충분·확인 중·모름과 대각 쌍은 뺀다', () => {
    const withDiagonal = readiness([...mixed.pairs, row('cam_A', 'cam_C', 'SHORT')]);
    expect(stageAAlerts(CAMS, withDiagonal).map((p) => `${p.a}-${p.b}:${p.status}`)).toEqual([
      'cam_B-cam_C:UNSTABLE',
      'cam_C-cam_D:SHORT',
    ]);
    expect(stageAAlerts(CAMS, readiness([row('cam_A', 'cam_B', 'UNKNOWN')]))).toEqual([]);
  });

  it('옛 헬퍼(값 없음)면 경고하지 않는다', () => {
    expect(stageAAlerts(CAMS, null)).toEqual([]);
    expect(stageAAlerts(CAMS, undefined)).toEqual([]);
    const parsed = coverageGuidesResponseSchema.parse({
      status: 'OK',
      latest: buildCoverageGuidePayload(),
    });
    expect(deriveStep1Coverage(parsed, false, CAMS).stageAAlerts).toEqual([]);
  });

  it('사유 문장: 불안정은 흔들림, 구석 몰림, 점 부족(수 포함)', () => {
    expect(stageAReasonText(mixed.pairs[1]!, 60)).toContain('최근 10초');
    expect(stageAReasonText(row('cam_C', 'cam_D', 'SHORT', { shortfall: ['CLUSTERED'] }), 60)).toBe(
      '같이 보는 곳이 화면 한쪽 구석에 몰려 있어요',
    );
    expect(stageAReasonText(mixed.pairs[2]!, 60)).toBe(
      '두 카메라가 같이 보는 점이 부족해요 (41/60)',
    );
  });

  it('선택 보강 안내도 경고 쌍이면 보인다(등급이 ENOUGH 여도)', () => {
    const optional = guide('cam_C', ['cam_C', 'cam_D']);
    expect(visibleGuides(CAMS, [optional], [])).toEqual([]);
    expect(visibleGuides(CAMS, [optional], [], stageAAlerts(CAMS, mixed))).toEqual([optional]);
  });
});

describe('1단계 표시 모델과 지금 할 일', () => {
  it('경고 쌍마다 그 카메라의 기존 방향 안내를 붙이고, 없으면 일반 안내를 쓴다', () => {
    const coverage = deriveStep1Coverage(
      response(mixed, [
        guide('cam_C', ['cam_C', 'cam_D']),
        guide('cam_D', ['cam_C', 'cam_D'], 'LEFT'),
      ]),
      false,
      CAMS,
    );
    expect(coverage.stageAAlerts.map((a) => [a.label, a.statusLabel])).toEqual([
      ['카메라 2–카메라 3', '불안정'],
      ['카메라 3–카메라 4', '기준 미달'],
    ]);
    expect(coverage.stageAAlerts[0]!.guides).toEqual([STAGE_A_FALLBACK_GUIDE]);
    expect(coverage.stageAAlerts[1]!.guides).toEqual([
      '카메라 3 오른쪽으로 조금 돌려 주세요 (카메라 3–카메라 4)',
      '카메라 4 왼쪽으로 조금 돌려 주세요 (카메라 3–카메라 4)',
    ]);
  });

  it('오래된 결과로는 경고하지 않는다', () => {
    expect(deriveStep1Coverage(response(mixed, [], true), false, CAMS).stageAAlerts).toEqual([]);
  });

  it('지금 할 일은 경고하되 「다음」으로 시작할 수 있다고 쓴다', () => {
    const coverage = deriveStep1Coverage(response(mixed), false, CAMS);
    const step = step1NextStep({
      coverage,
      heights: { missingIds: [], invalidIds: [] },
      heightCameraIds: CAMS,
      modePending: false,
      submitting: false,
    });
    expect(step.title).toBe('카메라 2–카메라 3, 카메라 3–카메라 4 보정 기준에 못 미쳐요');
    expect(step.detail).toContain('그대로 「다음」으로 시작할 수도 있어요');
    expect(step.tone).toBe('delay');
    const onlyUnstable = deriveStep1Coverage(
      response(readiness([mixed.pairs[0]!, mixed.pairs[1]!])),
      false,
      CAMS,
    );
    expect(
      step1NextStep({
        coverage: onlyUnstable,
        heights: { missingIds: [], invalidIds: [] },
        heightCameraIds: CAMS,
        modePending: false,
        submitting: false,
      }).title,
    ).toBe('카메라 2–카메라 3 판정이 흔들려요');
  });
});

describe('「세팅 시작」 근처 경고', () => {
  it('경고가 없으면 그리지 않는다', () => {
    const { container } = render(<StageAWarning alerts={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('배경 촬영 창의 「시작」 위에 경고와 방향 안내를 보이고 「시작」은 그대로 눌린다', () => {
    const coverage = deriveStep1Coverage(
      response(mixed, [guide('cam_C', ['cam_C', 'cam_D'])]),
      false,
      CAMS,
    );
    const onStart = vi.fn();
    render(
      <BackgroundCaptureModal
        view={{ phase: 'ready', cameras: [], blockedLabels: [], pendingLabels: [] }}
        secondsLeft={20}
        waitingForWorker={false}
        onStart={onStart}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onClose={vi.fn()}
        stageAAlerts={coverage.stageAAlerts}
      />,
    );
    const warning = screen.getByRole('status', { name: STAGE_A_WARNING_TITLE });
    expect(warning.textContent).toContain('카메라 2–카메라 3 불안정');
    expect(warning.textContent).toContain('카메라 3–카메라 4 기준 미달');
    expect(warning.textContent).toContain('카메라 3 오른쪽으로 조금 돌려 주세요');
    const start = screen.getByRole<HTMLButtonElement>('button', { name: '시작' });
    expect(start.disabled).toBe(false);
    start.click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('촬영이 시작되면 경고를 거둔다', () => {
    const coverage = deriveStep1Coverage(response(mixed), false, CAMS);
    render(
      <BackgroundCaptureModal
        view={{ phase: 'capturing', cameras: [], blockedLabels: [], pendingLabels: [] }}
        secondsLeft={10}
        waitingForWorker={false}
        onStart={vi.fn()}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onClose={vi.fn()}
        stageAAlerts={coverage.stageAAlerts}
      />,
    );
    expect(screen.queryByRole('status', { name: STAGE_A_WARNING_TITLE })).toBeNull();
  });
});
