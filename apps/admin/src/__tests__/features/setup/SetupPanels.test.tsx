import { useCctvStore } from '@/features/cctv/cctv.store';
import { deriveStep1Coverage, deriveWaitingView } from '@/features/setup/setup';
import { SetupCalibrateStep } from '@/features/setup/SetupCalibrateStep';
import {
  AiZoneDraftsPanel,
  CameraStatusDetails,
  CameraVideoPanel,
} from '@/features/setup/SetupPanels';
import { setupSessionResponseSchema, type CoverageGuidesResponse } from '@/features/setup/types';
import { buildCoverageGuidePayload, buildSetupZoneDraftsResponse } from '@/mocks/setup';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/cctv/useCctvPreview', () => ({
  useCctvPreview: () => ({ attach: vi.fn() }),
}));
// 보정·생성 단계의 3D 칸이 읽는 현재 Scene 조회(@/lib/api → env)는 여기서 쓰지 않는다.
vi.mock('@/lib/api', () => ({ api: vi.fn() }));

afterEach(() => {
  cleanup();
  useCctvStore.getState().reset();
});

/** 기본 카메라 4대(cam_A~cam_D)로 만든 1단계 카메라 목록. */
const defaultCoverage = () => deriveStep1Coverage(undefined);

describe('세팅 카메라 영상(S15P31A101-691: 2×2 칸, 겹침 2D 지도는 「자세히」)', () => {
  it.each([false, true])(
    '실시간 연결 %s 에서도 영상 4칸을 교실 모서리 위치대로(위 왼쪽·위 오른쪽·아래 왼쪽·아래 오른쪽) 놓고 2D 지도는 없다',
    (live) => {
      if (live) {
        useCctvStore.getState().hello(['cam_A', 'cam_B', 'cam_C', 'cam_D']);
        useCctvStore.getState().setLink('open');
      }
      render(<CameraVideoPanel coverage={defaultCoverage()} />);
      const canvasIds = within(screen.getByRole('group', { name: '카메라 영상' }))
        .getAllByLabelText(/영상$/)
        .map((canvas) => canvas.getAttribute('aria-label'));
      expect(canvasIds).toEqual([
        '카메라 1 영상',
        '카메라 2 영상',
        '카메라 4 영상',
        '카메라 3 영상',
      ]);
      expect(screen.queryByRole('img', { name: /위에서 본 보정 화면/ })).toBeNull();
      expect(screen.getAllByRole('heading', { name: '카메라 시야 · 실시간 영상' })).toHaveLength(1);
    },
  );

  it('칸마다 이름표에 배지 하나만 달고, 근거가 없으면 정상으로 미루지 않고 「확인 중」이다', () => {
    render(<CameraVideoPanel coverage={defaultCoverage()} />);
    const tile = screen.getByLabelText('카메라 1 영상').parentElement!;
    expect(within(tile).getByText('확인 중').getAttribute('data-badge')).toBe('CHECKING');
    expect(within(tile).queryByText('정상')).toBeNull();
  });

  it('보정·생성 단계(배지 끔·제목 없음)는 영상만 보인다', () => {
    render(<CameraVideoPanel coverage={defaultCoverage()} showBadges={false} title={null} />);
    expect(screen.queryByText('확인 중')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getAllByLabelText(/^카메라 \d 영상$/)).toHaveLength(4);
  });

  it('영상이 오지 않는 칸은 흐리게 두고 상태를 글로 보인다', () => {
    render(<CameraVideoPanel coverage={defaultCoverage()} />);
    const tile = screen.getByLabelText('카메라 1 영상');
    expect(tile.className).toContain('opacity-45');
    expect(tile.parentElement!.textContent).toContain('카메라 1');
  });

  it('영상 칸은 누르는 단추가 아니다(크게 보기 없음)', () => {
    render(<CameraVideoPanel coverage={defaultCoverage()} />);
    expect(screen.queryByRole('button', { name: /크게 보기|작게 보기/ })).toBeNull();
  });
});

const latest = buildCoverageGuidePayload({ connectivity: 'CONNECTED', guides: [] });
const fresh: CoverageGuidesResponse = {
  calibration_version: null,
  guides: [],
  site_id: 'classroom-1',
  status: 'OK',
  stale: false,
  received_at_ms: 100,
  age_ms: 0,
  latest,
};

describe('「자세히 · 카메라 상태」의 카메라 각도 표시', () => {
  it.each([
    { label: '확인 중', response: undefined, error: false, expected: '—' },
    { label: '계산 요청 실패', response: fresh, error: true, expected: '—' },
    {
      label: '결과 없음',
      response: { ...fresh, status: 'EMPTY' as const, latest: null },
      error: false,
      expected: '—',
    },
    {
      label: '응답 STALE',
      response: { ...fresh, status: 'STALE' as const },
      error: false,
      expected: '—',
    },
    { label: 'stale 플래그', response: { ...fresh, stale: true }, error: false, expected: '—' },
    {
      label: '계산 불가',
      response: { ...fresh, latest: { ...latest, connectivity: 'UNKNOWN' as const } },
      error: false,
      expected: '—',
    },
    ...(['STALE', 'NO_VIDEO', 'OK'] as const).map((status) => ({
      label: `카메라 ${status}`,
      response: {
        ...fresh,
        latest: buildCoverageGuidePayload({
          connectivity: 'CONNECTED',
          guides: [],
          cameraStatuses: { cam_A: status },
        }),
      },
      error: false,
      expected: status === 'OK' ? '각도 양호' : '—',
    })),
    {
      label: 'OK + 회전 안내',
      response: {
        ...fresh,
        latest: buildCoverageGuidePayload({
          connectivity: 'DISCONNECTED',
          guides: [
            {
              camera_id: 'cam_A',
              pair: ['cam_A', 'cam_B'],
              direction: 'RIGHT',
              magnitude: 'SMALL',
              reason_code: 'WEAK_PAIR_EDGE_CLUSTER',
            },
          ],
        }),
      },
      error: false,
      expected: '오른쪽으로 조금 돌려 주세요 (카메라 1–카메라 2)',
    },
    {
      label: 'CONNECTED + 선택 보강만',
      response: {
        ...fresh,
        latest: buildCoverageGuidePayload({
          guides: [
            {
              camera_id: 'cam_A',
              pair: ['cam_A', 'cam_B'],
              direction: 'RIGHT',
              magnitude: 'SMALL',
              reason_code: 'OPTIONAL_IMPROVE',
            },
          ],
        }),
      },
      error: false,
      expected: '각도 양호',
    },
  ])('$label', ({ response, error, expected }) => {
    render(<CameraStatusDetails coverage={deriveStep1Coverage(response, error)} />);
    const row = screen.getByText('카메라 1', { selector: 'b' }).closest('li')!;
    expect(within(row).getByText(expected)).toBeTruthy();
    if (expected !== '각도 양호') expect(within(row).queryByText('각도 양호')).toBeNull();
  });

  it('옆 카메라 쌍의 겹침이 부족하면 「자세히」에 보정 실패 위험을 쌍 이름과 함께 알리고, 아니면 알리지 않는다', () => {
    const pair = (a: string, b: string, grade: 'ENOUGH' | 'LACK') => ({
      a,
      b,
      raw_matches: null,
      inliers: null,
      inlier_ratio: null,
      grade,
      centroid_a: null,
      centroid_b: null,
    });
    const lackNeighbors = {
      ...fresh,
      latest: buildCoverageGuidePayload({
        guides: [],
        pairs: [
          pair('cam_A', 'cam_B', 'ENOUGH'),
          pair('cam_B', 'cam_C', 'LACK'),
          pair('cam_C', 'cam_D', 'LACK'),
          pair('cam_A', 'cam_C', 'LACK'),
        ],
      }),
    };
    render(<CameraStatusDetails coverage={deriveStep1Coverage(lackNeighbors)} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('보정이 실패할 수 있어요');
    expect(alert.textContent).toContain(
      '카메라 2–카메라 3, 카메라 3–카메라 4 겹침이 부족합니다. 카메라를 돌리거나 겹치는 곳에 무늬 있는 물건을 두세요.',
    );
    cleanup();
    render(<CameraStatusDetails coverage={deriveStep1Coverage(fresh)} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('「자세히」는 처음 닫혀 있고 겹침 2D 지도를 안에 둔다', () => {
    render(<CameraStatusDetails coverage={deriveStep1Coverage(fresh)} />);
    const details = screen.getByRole('group', { name: '카메라 상태 자세히' });
    expect(details.hasAttribute('open')).toBe(false);
    expect(within(details).getByRole('img', { name: /위에서 본 보정 화면/ })).toBeTruthy();
  });
});

describe('AI 위험 구역 초안 패널', () => {
  const renderDrafts = (overrides: Partial<Parameters<typeof AiZoneDraftsPanel>[0]> = {}) => {
    const onAcceptDraft = vi.fn();
    const onDiscardDraft = vi.fn();
    render(
      <AiZoneDraftsPanel
        draftsResponse={buildSetupZoneDraftsResponse('s1')}
        acceptedDraftIds={[]}
        discardedDraftIds={[]}
        pendingDraftId={null}
        acceptFailure={null}
        onAcceptDraft={onAcceptDraft}
        onDiscardDraft={onDiscardDraft}
        {...overrides}
      />,
    );
    return { onAcceptDraft, onDiscardDraft };
  };

  it('제목은 AI 위험 구역 초안뿐이고 배경 맵 단계 상태 줄은 없다', () => {
    renderDrafts();
    expect(screen.getByRole('heading', { name: 'AI 위험 구역 초안' })).toBeTruthy();
    expect(screen.queryByText(/배경 맵 상태/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('status', { name: '배경 맵 단계 상태' })).toBeNull();
  });

  it('초안 목록과 수락·버리기 동작은 그대로다', () => {
    const { onAcceptDraft, onDiscardDraft } = renderDrafts();
    const list = screen.getByRole('list', { name: 'AI 구역 초안 목록' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('창가 개구부 추락 주의')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '창가 개구부 추락 주의 수락' }));
    expect(onAcceptDraft).toHaveBeenCalledWith(
      expect.objectContaining({ candidate_id: 'cand-opening-1' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '전면 단상 작업면 후보 버리기' }));
    expect(onDiscardDraft).toHaveBeenCalledWith('cand-surface-2');
  });

  it('분석 중이거나 남은 초안이 없으면 그 상태를 글로 보인다', () => {
    renderDrafts({ draftsResponse: buildSetupZoneDraftsResponse('s1', { status: 'QUEUED' }) });
    expect(screen.getByText('AI 구역 초안 분석 중')).toBeTruthy();
    cleanup();
    renderDrafts({ discardedDraftIds: ['cand-opening-1', 'cand-surface-2'] });
    expect(screen.getByText('AI 구역 초안 없음')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('분석이 끝났는데 초안이 0건이면(실패 포함) 직접 그리기를, World 이어짐이면 이전 구역 불러오기도 권한다(S15P31A101-758)', () => {
    renderDrafts({ draftsResponse: buildSetupZoneDraftsResponse('s1', { drafts: [] }) });
    expect(screen.getByRole('status').textContent).toBe(
      'AI 가 개구부를 찾지 못했어요 — 직접 그려 주세요',
    );
    expect(screen.queryByText('AI 구역 초안 없음')).toBeNull();
    cleanup();
    renderDrafts({
      draftsResponse: buildSetupZoneDraftsResponse('s1', { status: 'FAILED' }),
      canImportPrevious: true,
    });
    expect(screen.getByRole('status').textContent).toBe(
      'AI 가 개구부를 찾지 못했어요 — 직접 그리거나 이전 구역을 불러오세요',
    );
    expect(screen.queryByRole('list', { name: 'AI 구역 초안 목록' })).toBeNull();
  });

  it('같은 자리의 이전 구역과 묶인 초안은 목록에서 감추고 「이어 쓴 구역 확인」에서 고른다고 알린다', () => {
    renderDrafts({ mergedDraftIds: ['cand-opening-1'] });
    const list = screen.getByRole('list', { name: 'AI 구역 초안 목록' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).queryByText('창가 개구부 추락 주의')).toBeNull();
    cleanup();
    renderDrafts({ mergedDraftIds: ['cand-opening-1'], discardedDraftIds: ['cand-surface-2'] });
    expect(
      screen.getByText(
        '「창가 개구부 추락 주의」은(는) 같은 자리의 이전 구역과 묶어 위 「이어 쓴 구역 확인」에서 골라요.',
      ),
    ).toBeTruthy();
  });
});

describe('세팅 대기 이유 표시(S15P31A101-583)', () => {
  const NOW = 1_800_000_000_000;
  const session = (waitReason: Record<string, unknown> | null, status = 'COLLECTING_BACKGROUND') =>
    setupSessionResponseSchema.parse({
      setup_session_id: 's1',
      site_id: 'classroom-1',
      work_unit_id: 1,
      status,
      progress_pct: 0,
      camera_heights_m: { cam_A: 2.44, cam_C: 2.48 },
      started_at_ms: NOW - 700_000,
      updated_at_ms: NOW - 700_000,
      wait_reason: waitReason,
    });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderPanel(waitReason: Record<string, unknown> | null, status?: string) {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(
      <SetupCalibrateStep
        cameraView={<div data-testid="camera-view" />}
        waiting={deriveWaitingView(session(waitReason, status))}
        onRetry={vi.fn()}
        onReturnToStep1={vi.fn()}
      />,
    );
    return screen.queryByRole('status', { name: '세팅 대기 이유' });
  }

  it('관제 우선으로 세팅을 받지 않으면 이유·대기 시간·할 일을 보이고 일반 문구를 대신한다', () => {
    const box = renderPanel({
      code: 'WORKER_PAUSED_TIER0',
      since_ms: NOW - 605_000,
      basis: 'TIER0_HEALTH',
    })!;
    expect(box.textContent).toContain(
      'GPU 서버가 관제를 먼저 처리하느라 세팅 시작을 기다리고 있습니다',
    );
    expect(box.textContent).toContain('대기 10분 05초');
    expect(box.textContent).toContain('관제 지연을 알 수 없다는 기록으로 추정');
    expect(box.textContent).toContain('GPU 서버 상태를 확인하세요');
    expect(screen.queryByText(/워커의 진행 정보를 기다리는 중입니다/)).toBeNull();
    expect(screen.queryByText(/새 진행 정보가 없습니다/)).toBeNull();
  });

  it('배경 미완료는 카메라와 비켜 달라는 안내를 보인다', () => {
    const box = renderPanel({
      code: 'BACKGROUND_INCOMPLETE',
      since_ms: NOW - 90_000,
      cameras: [{ camera_id: 'cam_C', collection_pct: 15 }],
    })!;
    expect(
      within(box).getByText('사람 없는 배경을 아직 다 모으지 못했습니다 (카메라 2 15%)'),
    ).toBeTruthy();
    expect(within(box).getByText('사람이 카메라 앞에서 잠시 비켜 주세요.')).toBeTruthy();
    expect(box.textContent).toContain('대기 1분 30초');
  });

  it.each([
    ['NO_WORKER', 'GPU 서버(분석 워커)가 연결돼 있지 않습니다'],
    ['WORKER_BUSY_OTHER_JOB', 'GPU 서버가 다른 작업을 먼저 처리하고 있습니다'],
    ['WAITING_FOR_WORKER', 'GPU 서버가 세팅 작업을 가져가기를 기다리고 있습니다'],
    ['WORKER_STARTING', 'GPU 서버가 세팅 작업을 받아 시작을 준비하고 있습니다'],
  ])('%s 이유를 보인다', (code, title) => {
    const box = renderPanel({ code, since_ms: NOW - 5_000 })!;
    expect(within(box).getByText(title)).toBeTruthy();
    expect(box.textContent).toContain('대기 0분 05초');
    expect(box.textContent).not.toContain('마지막 연결');
  });

  it('워커가 묻지 않으면 마지막 연결 시각(없으면 기록 없음)을 함께 보인다', () => {
    const box = renderPanel({
      code: 'WORKER_NOT_POLLING',
      since_ms: NOW - 60_000,
      worker_last_seen_ms: NOW - 900_000,
      tier0_lag_ms: 1800,
    })!;
    expect(box.textContent).toContain('GPU 서버가 세팅 작업을 가져가지 않고 있습니다');
    expect(box.textContent).toContain('마지막 연결 15분 00초 전');
    expect(box.textContent).toContain('참고: 최근 관제 지연 1800 ms');
    cleanup();
    expect(renderPanel({ code: 'WORKER_NOT_POLLING', since_ms: NOW })!.textContent).toContain(
      '연결 기록 없음',
    );
  });

  it('이유가 없거나 실패한 세션이면 대기 이유 칸이 없다', () => {
    expect(renderPanel(null)).toBeNull();
    // 이유가 없으면 기존 안내(오래 바뀌지 않음)를 그대로 쓴다
    expect(screen.getByText(/새 진행 정보가 없습니다/)).toBeTruthy();
    cleanup();
    expect(renderPanel({ code: 'WORKER_NOT_POLLING', since_ms: NOW }, 'FAILED')).toBeNull();
  });
});
