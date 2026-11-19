import { useCctvStore } from '@/features/cctv/cctv.store';
import { deriveCaptureView } from '@/features/setup/backgroundCapture';
import { BackgroundCaptureModal } from '@/features/setup/BackgroundCaptureModal';
import { deriveCameraCheckView, deriveCameraWalkView } from '@/features/setup/cameraCheck';
import { CameraCheckModal } from '@/features/setup/CameraCheckModal';
import { calibrateNextStep } from '@/features/setup/nextStep';
import { deriveWaitingView } from '@/features/setup/setup';
import { SetupCalibrateStep } from '@/features/setup/SetupCalibrateStep';
import { AiZoneDraftsPanel } from '@/features/setup/SetupPanels';
import { SETUP_NEW_ZONE_PREFIX } from '@/features/setup/setupZonePlan';
import { SetupZoneReviewCard } from '@/features/setup/SetupZoneReviewCard';
import {
  setupSessionResponseSchema,
  setupZoneDraftsResponseSchema,
  zoneDraftItemSchema,
} from '@/features/setup/types';
import { useBackgroundCapture } from '@/features/setup/useBackgroundCapture';
import type { Zone } from '@/features/zones/types';
import { zoneAiOpinionSchema, zoneHeightChangeSchema } from '@/features/zones/types';
import { readZones } from '@/features/zones/zones';
import {
  buildCameraCheck,
  buildDefaultZoneDraftItems,
  buildSetupZoneDraftsResponse,
} from '@/mocks/setup';
import { MOCK_ZONES } from '@/mocks/zones';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/features/cctv/useCctvPreview', () => ({ useCctvPreview: () => ({ attach: vi.fn() }) }));
const viewport = vi.hoisted(() => ({
  zones: [] as Zone[],
  selectTarget: vi.fn(),
  clearSelection: vi.fn(),
}));
vi.mock('@/features/layout/SpatialViewportHost', () => ({ useSpatialViewport: () => viewport }));
const review = vi.hoisted(() => ({
  pending: 1,
  unchangedPending: 0,
  busy: false,
  error: null,
  confirm: vi.fn(),
  confirmAll: vi.fn(),
  confirmUnchanged: vi.fn(),
  remove: vi.fn(),
  keepCarried: vi.fn(),
  replaceWithDraft: vi.fn(),
}));
vi.mock('@/features/setup/useSetupZoneReview', () => ({ useSetupZoneReview: () => review }));
const importer = vi.hoisted(() => ({
  run: vi.fn(),
  busy: false,
  result: null as { added: number; skipped: string[] } | null,
  error: null as string | null,
}));
vi.mock('@/features/setup/useSeedSetupZonePlan', () => ({
  useImportPreviousZones: () => importer,
}));

const IDS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];
const session = (patch: Record<string, unknown> = {}) =>
  setupSessionResponseSchema.parse({
    setup_session_id: 's1',
    site_id: 's',
    work_unit_id: 1,
    status: 'COLLECTING_BACKGROUND',
    stage: 'COLLECTING_BACKGROUND',
    progress_pct: 0,
    camera_heights_m: Object.fromEntries(IDS.map((id) => [id, 2.4])),
    started_at_ms: 1000,
    updated_at_ms: 1000,
    ...patch,
  });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useCctvStore.getState().reset();
});

describe('세팅 상태와 다음 행동(-732)', () => {
  it('맵 완료 뒤 걷기를 재요청할 수 없으면 이유와 카메라 연결 관리로 가는 단추를 한 번만 보인다', () => {
    const current = session({
      status: 'COMPLETED',
      stage: 'COMPLETED',
      progress_pct: 100,
      scene_version: 'scene-final',
      camera_check_passed: false,
    });
    const waiting = deriveWaitingView(current);
    const check = deriveCameraCheckView(current, IDS);
    const onReturn = vi.fn();
    // 정밀 3D 맵까지 끝나 왼쪽이 3D 미리보기(Scene 조회)로 바뀐다
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SetupCalibrateStep
          waiting={waiting}
          cameraView={<div />}
          nextStep={calibrateNextStep({
            waiting,
            pollingError: false,
            walkOpen: false,
            cameraCheckBlocked: '카메라 확인을 마치면 넘어갈 수 있어요',
          })}
          cameraCheck={check}
          onRetry={vi.fn()}
          onReturnToStep1={onReturn}
        />
      </QueryClientProvider>,
    );
    expect(screen.getAllByText('맵은 완성됐지만 카메라 확인이 남아 있어요')).toHaveLength(1);
    expect(screen.getByText(/맵 생성 작업이 끝나 걷기만 다시 할 수 없어요/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '카메라 확인만 다시' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '카메라 연결 관리로' }));
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('서버 접수 전 경과를 세되 촬영 카운트다운은 접수 뒤부터 센다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(11000);
    const initial = session();
    const hook = renderHook(
      ({ current }) =>
        useBackgroundCapture({ stage: 1, session: current, cameraIds: IDS, starting: false }),
      { initialProps: { current: initial } },
    );
    expect(hook.result.current.waitingForWorker).toBe(true);
    act(() => vi.advanceTimersByTime(3000));
    expect(hook.result.current.waitingSeconds).toBe(13);
    expect(hook.result.current.secondsLeft).toBe(20);
    hook.rerender({
      current: session({
        background_capture: {
          since_ms: 14000,
          required_samples: 12,
          cameras: Object.fromEntries(
            IDS.map((id) => [id, { state: 'INSUFFICIENT_SAMPLES', sample_count: 1 }]),
          ),
        },
      }),
    });
    expect(hook.result.current.waitingForWorker).toBe(false);
    act(() => vi.advanceTimersByTime(1500));
    expect(hook.result.current.secondsLeft).toBe(19);
  });

  it('배경 촬영을 받기 전에는 비킬 필요 없음과 경과를 표시하고 미리보기 중지만 구분한다', () => {
    useCctvStore.getState().setLink('stopped');
    render(
      <BackgroundCaptureModal
        view={deriveCaptureView(session(), IDS, false)}
        secondsLeft={20}
        waitingForWorker
        waitingSeconds={93}
        onStart={vi.fn()}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: '배경 촬영' });
    expect(dialog.textContent).toContain(
      '서버 준비 기다리는 중 · 아직 비키지 않아도 됩니다 · 93초 경과',
    );
    expect(dialog.textContent).not.toContain('화면 밖에서 기다려');
    expect(within(dialog).getAllByText('미리보기 멈춤(촬영 계속)')).toHaveLength(4);
    expect(within(dialog).queryByLabelText('남은 시간')).toBeNull();
  });

  it('카메라가 각각 충분히 보여도 함께 보인 횟수가 모자란 쌍을 강조한다', () => {
    const check = buildCameraCheck(IDS, 'cal', 'MEASURING', 50);
    for (const camera of Object.values(check.cameras)) camera.observed_views = 100;
    const pair = Object.values(check.pairs).find((p) => p.required)!;
    pair.samples = 7;
    const view = deriveCameraWalkView(
      session({
        camera_check_phase: 'WALKING',
        camera_check: { ...check, thresholds: { min_pair_samples: 30 } },
      }),
      IDS,
    );
    render(<CameraCheckModal view={view} secondsLeft={5} onStart={vi.fn()} onStop={vi.fn()} />);
    const list = screen.getByRole('list', { name: '카메라 쌍별 함께 보임' });
    const short = within(list).getByText('함께 보임 7/30');
    expect(short.closest('li')?.getAttribute('data-shortage')).toBe('true');
    expect(screen.getAllByText('충분히 보임')).toHaveLength(4);
  });

  it('걷기 전에는 걷는 방법을, 걷는 중에는 지금 보는 카메라 수와 점등을 크게 보이고 한동안 아무도 안 보이면 경고한다(S15P31A101-763)', () => {
    const walkSession = (phase: string, observed: readonly number[]) => {
      const check = buildCameraCheck(IDS, 'cal', 'MEASURING', 0);
      IDS.forEach((id, i) => (check.cameras[id]!.observed_views = observed[i]!));
      return deriveCameraWalkView(
        session({
          camera_check_phase: phase,
          camera_check: {
            ...check,
            attempt: { no: 1, id: 'lease-1', started_at_ms: 1, expires_at_ms: 2 },
          },
        }),
        IDS,
      );
    };
    const { rerender } = render(
      <CameraCheckModal
        view={walkSession('AWAITING_START', [0, 0, 0, 0])}
        secondsLeft={30}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    const guide = screen.getByRole('list', { name: '걷는 방법' });
    expect(guide.textContent).toContain('한 사람만 걸어요');
    expect(guide.textContent).toContain(
      '방 가운데(카메라 4대가 모두 보는 곳)를 천천히 크게 돌아요',
    );
    expect(guide.textContent).toContain('60~90초');
    expect(screen.queryByRole('region', { name: '지금 보는 카메라' })).toBeNull();

    vi.useFakeTimers();
    try {
      const modal = (observed: readonly number[]) => (
        <CameraCheckModal
          view={walkSession('WALKING', observed)}
          secondsLeft={25}
          onStart={vi.fn()}
          onStop={vi.fn()}
        />
      );
      rerender(modal([10, 0, 0, 0]));
      act(() => vi.advanceTimersByTime(600));
      expect(screen.queryByRole('list', { name: '걷는 방법' })).toBeNull();
      const panel = screen.getByRole('region', { name: '지금 보는 카메라' });
      expect(panel.textContent).toContain('지금 보는 카메라 0/4');
      rerender(modal([20, 0, 5, 0]));
      act(() => vi.advanceTimersByTime(600));
      expect(panel.textContent).toContain('지금 보는 카메라 2/4');
      expect(within(panel).getByLabelText('카메라 1 보는 중').getAttribute('data-live')).toBe(
        'true',
      );
      expect(within(panel).getByLabelText('카메라 2 안 보임').getAttribute('data-live')).toBe(
        'false',
      );
      expect(within(panel).queryByRole('alert')).toBeNull();
      act(() => vi.advanceTimersByTime(5_000));
      expect(panel.textContent).toContain('지금 보는 카메라 0/4');
      expect(within(panel).getByRole('alert').textContent).toBe(
        '사람이 안 보입니다 — 카메라 앞으로 걸어 들어오세요',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('AI 초안 기본 설명에 수치가 없고 원문·높이·신뢰도는 닫힌 자세히 안에 있다', () => {
    const response = setupZoneDraftsResponseSchema.parse(buildSetupZoneDraftsResponse('s1'));
    render(
      <AiZoneDraftsPanel
        draftsResponse={response}
        acceptedDraftIds={[]}
        discardedDraftIds={[]}
        pendingDraftId={null}
        acceptFailure={null}
        onAcceptDraft={vi.fn()}
        onDiscardDraft={vi.fn()}
        cameraIds={IDS}
      />,
    );
    for (const item of response.drafts) {
      const details = screen.getByRole('group', { name: `${item.recommended_name} 근거 자세히` });
      expect(details.hasAttribute('open')).toBe(false);
      expect(details.textContent).toContain('높이 범위');
      fireEvent.click(within(details).getByText('자세히'));
    }
    expect(screen.getByRole('list', { name: 'AI 구역 초안 목록' }).textContent).not.toContain(
      'cam_',
    );
  });

  it('변화 없음과 AI 수정 권고가 겹치면 변화 감지로 표시하고 사진도 카메라 번호를 쓴다', () => {
    const zone = readZones(MOCK_ZONES)[0]!;
    viewport.zones = [
      {
        ...zone,
        needsReview: true,
        heightChange: zoneHeightChangeSchema.parse({ zone_id: zone.zoneId, status: 'UNCHANGED' }),
        aiOpinion: zoneAiOpinionSchema.parse({
          status: 'OPINION',
          recommended_action: 'MODIFY',
          rationale: 'cam_C 높이가 달라졌습니다.',
          camera_id: 'cam_C',
          before: { image_url: 'before' },
          after: { image_url: 'after' },
        }),
      },
    ];
    render(<SetupZoneReviewCard sessionId="s" cameraIds={IDS} />);
    expect(screen.getByText('변화 감지')).toBeTruthy();
    expect(screen.queryByText('변화 없음')).toBeNull();
    expect(screen.getByAltText('이전 세팅 · 카메라 3')).toBeTruthy();
    expect(screen.getByText('카메라 3 높이가 달라졌습니다.')).toBeTruthy();
  });
});

describe('이어 쓴 구역 확인 카드의 불러오기·같은 자리 묶음(S15P31A101-758)', () => {
  beforeEach(() => {
    viewport.zones = [];
  });
  afterEach(() => {
    viewport.zones = [];
    importer.result = null;
    vi.clearAllMocks();
  });
  const opening = zoneDraftItemSchema.parse(buildDefaultZoneDraftItems()[0]);

  it('이어 온 구역이 없으면 World 이어짐일 때만 「이전 구역 불러오기」를 보이고 결과를 알린다', () => {
    const { rerender } = render(<SetupZoneReviewCard sessionId="s" canImport={false} />);
    expect(screen.queryByTestId('setup-zone-import-card')).toBeNull();
    rerender(<SetupZoneReviewCard sessionId="s" canImport />);
    fireEvent.click(screen.getByRole('button', { name: '이전 구역 불러오기' }));
    expect(importer.run).toHaveBeenCalledTimes(1);

    importer.result = { added: 0, skipped: [] };
    rerender(<SetupZoneReviewCard sessionId="s" canImport />);
    expect(screen.getByRole('status').textContent).toBe('불러올 이전 구역이 없어요.');
    importer.result = { added: 1, skipped: ['동쪽 개구부'] };
    rerender(<SetupZoneReviewCard sessionId="s" canImport />);
    expect(screen.getByRole('status').textContent).toBe(
      'AI 초안 구역과 같은 자리인 「동쪽 개구부」은(는) 빼고 불러왔어요.',
    );
  });

  it('새로 그린 구역은 확인 목록에 넣지 않는다', () => {
    const zone = readZones(MOCK_ZONES)[0]!;
    viewport.zones = [{ ...zone, zoneId: `${SETUP_NEW_ZONE_PREFIX}0` }];
    render(<SetupZoneReviewCard sessionId="s" canImport />);
    expect(screen.getByTestId('setup-zone-import-card')).toBeTruthy();
    expect(screen.queryByRole('button', { name: `${zone.name} 삭제` })).toBeNull();
  });

  it('같은 자리 AI 초안과 묶인 구역은 확인 대신 「이전 것 유지」·「AI 초안으로」 중 하나를 고른다', () => {
    const [carried, other] = readZones(MOCK_ZONES) as [Zone, Zone];
    viewport.zones = [
      { ...carried, needsReview: true },
      { ...other, needsReview: true },
    ];
    render(
      <SetupZoneReviewCard
        sessionId="s"
        cameraIds={IDS}
        pairedDrafts={new Map([[carried.zoneId, opening]])}
      />,
    );
    const pair = screen.getByTestId('setup-zone-pair');
    expect(pair.textContent).toContain(`AI 초안 「${opening.recommended_name}」과 같은 자리예요.`);
    expect(screen.queryByRole('button', { name: `${carried.name} 확인` })).toBeNull();
    expect(screen.getByRole('button', { name: `${other.name} 확인` })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: `${carried.name} 이전 것 유지` }));
    expect(review.keepCarried).toHaveBeenCalledWith(carried.zoneId, opening.candidate_id);
    fireEvent.click(screen.getByRole('button', { name: `${carried.name} AI 초안으로 바꾸기` }));
    expect(review.replaceWithDraft).toHaveBeenCalledWith(
      carried.zoneId,
      opening,
      viewport.zones.filter((z) => z.zoneId !== carried.zoneId),
    );
  });
});
