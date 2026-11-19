import { deriveCameraCheckView } from '@/features/setup/cameraCheck';
import { deriveWaitingView } from '@/features/setup/setup';
import { SetupCalibrateStep } from '@/features/setup/SetupCalibrateStep';
import { setupSessionResponseSchema } from '@/features/setup/types';
import { buildCameraCheck, buildQualityGate } from '@/mocks/setup';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 미리보기 3D 칸이 읽는 현재 Scene 조회(@/lib/api → env)는 여기서 쓰지 않는다. 3D 배치는 SetupPage 시험이 본다.
vi.mock('@/lib/api', () => ({ api: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const check = (over: Record<string, unknown> = {}) => ({
  input_height_m: 2.25,
  restored_height_m: 2.26,
  difference_cm: 1,
  within_tolerance: true,
  guidance: null,
  ...over,
});

const sessionOf = (over: Record<string, unknown> = {}) =>
  setupSessionResponseSchema.parse({
    setup_session_id: 's1',
    site_id: 'classroom-1',
    work_unit_id: 1,
    status: 'JOINT_BA_AND_VERIFY',
    stage: 'JOINT_BA_AND_VERIFY',
    progress_pct: 50,
    camera_heights_m: { cam_A: 2.25, cam_B: 2.3 },
    height_tolerance_cm: 5,
    started_at_ms: Date.now(),
    updated_at_ms: Date.now(),
    ...over,
  });

const failedSession = (over: Record<string, unknown> = {}) =>
  sessionOf({ status: 'FAILED', stage: 'FAILED', ...over });

function renderStep(
  session: ReturnType<typeof sessionOf>,
  handlers: {
    onRetry?: () => void;
    onReturnToStep1?: () => void;
    onTurnOnGpu?: () => void;
    retryPending?: boolean;
  } = {},
) {
  const onRetry = handlers.onRetry ?? vi.fn();
  const onReturnToStep1 = handlers.onReturnToStep1 ?? vi.fn();
  render(
    <SetupCalibrateStep
      cameraView={<div data-testid="camera-view" />}
      waiting={deriveWaitingView(session)}
      onRetry={onRetry}
      retryPending={handlers.retryPending}
      onReturnToStep1={onReturnToStep1}
      onTurnOnGpu={handlers.onTurnOnGpu}
    />,
  );
  return { onRetry, onReturnToStep1 };
}

const stages = () =>
  within(screen.getByRole('list', { name: '보정·생성 단계' })).getAllByRole('listitem');

describe('보정·생성 진행 카드(5단계 막대)', () => {
  it('5단계를 순서대로 보이고 끝난 단계는 완료, 지금 단계는 구간 안 %, 남은 단계는 대기로 보인다', () => {
    renderStep(sessionOf({ progress_pct: 52.5 }));
    // 5단계 막대·단계별 %·경과 시간은 「자세히 · 진행 단계」(닫힘) 안에 있다(S15P31A101-691)
    const details = screen.getByRole('group', { name: '진행 단계 자세히' });
    expect(details.hasAttribute('open')).toBe(false);
    expect(within(details).getByRole('heading', { name: '진행 단계' })).toBeTruthy();
    const rows = stages();
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual([
      'done',
      'done',
      'current',
      'upcoming',
      'upcoming',
    ]);
    expect(rows.map((row) => row.textContent)).toEqual([
      '배경 수집완료',
      '3D 공간·좌표계완료',
      '카메라 정밀 보정진행 중 · 0분 00초 경과50%',
      '미리보기 맵·구역 초안대기',
      '정밀 3D 맵대기',
    ]);
    expect(
      screen
        .getByRole('progressbar', { name: '카메라 정밀 보정 진행률' })
        .getAttribute('aria-valuenow'),
    ).toBe('50');
    expect(
      screen.getByRole('progressbar', { name: '세팅 진행률' }).getAttribute('aria-valuenow'),
    ).toBe('52.5');
    expect(screen.getByText('진행 52.5%')).toBeTruthy();
  });

  it('서버 값이 그대로면 시간이 지나도 막대는 오르지 않고 현재 단계 시간만 흐른다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    const start = Date.now();
    const props = (pct: number, updated: number, id = 's1') => ({
      waiting: deriveWaitingView(
        sessionOf({
          setup_session_id: id,
          progress_pct: pct,
          started_at_ms: start - 120_000,
          updated_at_ms: updated,
        }),
      ),
      cameraView: null,
      onRetry: vi.fn(),
      onReturnToStep1: vi.fn(),
    });
    const view = render(<SetupCalibrateStep {...props(50, start - 10_000)} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('진행 50%')).toBeTruthy();
    expect(screen.getByText('진행 중 · 1분 10초 경과')).toBeTruthy();
    expect(
      screen
        .getByRole('progressbar', { name: '카메라 정밀 보정 진행률' })
        .getAttribute('aria-valuenow'),
    ).toBe('40');
    // 같은 단계에서 하위 진행을 받아도 단계 시간은 유지한다.
    view.rerender(<SetupCalibrateStep {...props(55, Date.now())} />);
    expect(screen.getByText('진행 55%')).toBeTruthy();
    expect(screen.getByText('진행 중 · 1분 10초 경과')).toBeTruthy();
    view.rerender(<SetupCalibrateStep {...props(67, Date.now())} />);
    expect(screen.getByText('진행 중 · 0분 00초 경과')).toBeTruthy();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText('진행 중 · 0분 05초 경과')).toBeTruthy();
    view.rerender(<SetupCalibrateStep {...props(67, Date.now(), 's2')} />);
    expect(screen.getByText('진행 중 · 0분 00초 경과')).toBeTruthy();
  });

  it('배경을 모으는 동안만 비켜 달라는 안내와 카메라별 수집률을 단계 아래에 보인다', () => {
    renderStep(
      sessionOf({
        status: 'COLLECTING_BACKGROUND',
        stage: 'COLLECTING_BACKGROUND',
        progress_pct: 7.5,
        background_collection_pct: { cam_A: 50, cam_B: 80 },
      }),
    );
    expect(stages()[0]!.textContent).toContain('50%');
    expect(screen.getByText('배경을 모으는 동안 카메라 앞에서 비켜 주세요.')).toBeTruthy();
    expect(screen.getByLabelText('카메라별 배경 수집 진행률').textContent).toBe(
      '카메라 1 50% · 카메라 2 80%',
    );
    cleanup();

    renderStep(
      sessionOf({ progress_pct: 20, background_collection_pct: { cam_A: 100, cam_B: 100 } }),
    );
    expect(screen.queryByText('배경을 모으는 동안 카메라 앞에서 비켜 주세요.')).toBeNull();
    expect(screen.queryByLabelText('카메라별 배경 수집 진행률')).toBeNull();
  });

  it('높이 불일치나 결과가 없으면 안내와 결과 표를 그리지 않는다', () => {
    renderStep(sessionOf({ progress_pct: 20 }));
    expect(screen.queryByRole('alert', { name: '카메라 높이 불일치 경고' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('보정·생성 실패 안내', () => {
  it('어느 단계에서 멈췄는지(마지막 서버 진행률)·원인·해결을 보이고 그 단계 막대를 실패로 칠한다', () => {
    renderStep(
      failedSession({
        progress_pct: 40,
        failure_code: 'VALIDATION_REJECTED',
        failure_message: "worsened_pairs=['cam_A-cam_B']",
      }),
    );
    const box = screen.getByRole('alert', { name: '세팅 실패 안내' });
    expect(box.textContent).toContain('카메라 정밀 보정 단계에서 멈췄어요');
    expect(box.textContent).toContain(
      '보정한 뒤 오히려 어긋난 카메라 쌍이 있어요 (카메라 1–카메라 2)',
    );
    expect(box.textContent).toContain(
      '「다시 시도」를 누르면 같은 카메라와 높이 설정으로 세팅을 다시 시작합니다.',
    );
    expect(stages().map((row) => row.getAttribute('data-status'))).toEqual([
      'done',
      'done',
      'failed',
      'upcoming',
      'upcoming',
    ]);
    expect(stages()[2]!.textContent).toBe('카메라 정밀 보정실패');
  });

  it('실패 코드 안내에 서버 코드와 서버 메시지 원문은 보이지 않는다', () => {
    renderStep(
      failedSession({
        progress_pct: 14,
        failure_code: 'BACKGROUND_INCOMPLETE',
        failure_message: 'raw server message',
      }),
    );
    const box = screen.getByRole('alert', { name: '세팅 실패 안내' });
    expect(box.textContent).toContain('배경 수집 단계에서 멈췄어요');
    expect(box.textContent).not.toContain('BACKGROUND_INCOMPLETE');
    expect(box.textContent).not.toContain('raw server message');
  });

  it('카메라 확인 실패는 「자세히」를 열지 않아도 첫 화면에 원인과 다시 시도를 보인다(S15P31A101-719)', () => {
    const camCheck = buildCameraCheck(['cam_A', 'cam_B'], 'cal-1', 'INCOMPLETE', 30);
    camCheck.problems = [
      { kind: 'CHECK', id: 'camera_check', camera_ids: [], reason: 'NO_PERSON', message: 'x' },
    ];
    const { onRetry } = renderStep(
      failedSession({
        progress_pct: 80,
        failure_code: 'CAMERA_CHECK_NOT_PASSED',
        failure_message: '카메라 확인을 1번 걸었지만 통과하지 못해 맵을 만들지 않았습니다: x',
        camera_check: camCheck,
      }),
    );
    const box = screen.getByRole('alert', { name: '세팅 실패 안내' });
    expect(box.textContent).toContain('어느 카메라에서도 사람이 보이지 않았습니다');
    expect(box.textContent).not.toContain('서버에서 세팅을 끝내지 못했어요');
    fireEvent.click(within(box).getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('같은 상태로 다시 해도 소용없는 실패는 카메라 연결 관리로 단추 하나뿐이다', () => {
    const { onRetry, onReturnToStep1 } = renderStep(
      failedSession({
        progress_pct: 40,
        failure_code: 'INSUFFICIENT_FEATURES',
        failure_message: 'Insufficient raw feature matches on pair cam_A-cam_B: 7',
      }),
    );
    const box = within(screen.getByRole('alert', { name: '세팅 실패 안내' }));
    expect(
      box.getByText('옆 카메라 카메라 1–카메라 2 사이에 같이 보이는 곳이 적어요'),
    ).toBeTruthy();
    expect(box.queryByRole('button', { name: '다시 시도' })).toBeNull();
    expect(box.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(box.getByRole('button', { name: '카메라 연결 관리로' }));
    expect(onReturnToStep1).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('다시 해 볼 만한 실패는 다시 시도(주)와 카메라 연결 관리로(보조) 두 단추다', () => {
    const { onRetry, onReturnToStep1 } = renderStep(
      failedSession({ progress_pct: 40, failure_code: 'TIMEOUT' }),
    );
    const box = within(screen.getByRole('alert', { name: '세팅 실패 안내' }));
    expect(box.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '다시 시도',
      '카메라 연결 관리로',
    ]);
    fireEvent.click(box.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(box.getByRole('button', { name: '카메라 연결 관리로' }));
    expect(onReturnToStep1).toHaveBeenCalledTimes(1);
  });

  it('GPU 가 꺼져 있으면 주 단추는 「GPU 켜기」이고 다시 시도·카메라 연결 관리로는 보조로 내려간다(-734)', () => {
    const onTurnOnGpu = vi.fn();
    const { onRetry } = renderStep(failedSession({ progress_pct: 40, failure_code: 'TIMEOUT' }), {
      onTurnOnGpu,
    });
    const box = within(screen.getByRole('alert', { name: '세팅 실패 안내' }));
    expect(box.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'GPU 켜기',
      '다시 시도',
      '카메라 연결 관리로',
    ]);
    expect(box.getByText('GPU 가 꺼져 있어요. 켠 뒤 다시 시도하세요.')).toBeTruthy();
    // 주 단추(기본 모양)는 GPU 켜기 하나, 나머지는 보조 모양이다
    const isPrimary = (name: string) =>
      box.getByRole('button', { name }).classList.contains('bg-primary');
    expect(isPrimary('GPU 켜기')).toBe(true);
    expect(isPrimary('다시 시도')).toBe(false);
    expect(isPrimary('카메라 연결 관리로')).toBe(false);
    fireEvent.click(box.getByRole('button', { name: 'GPU 켜기' }));
    expect(onTurnOnGpu).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('GPU 가 꺼져 있지 않으면(onTurnOnGpu 없음) 「GPU 켜기」를 두지 않는다', () => {
    renderStep(failedSession({ progress_pct: 40, failure_code: 'TIMEOUT' }));
    expect(screen.queryByRole('button', { name: 'GPU 켜기' })).toBeNull();
    expect(screen.queryByText(/GPU 가 꺼져 있어요/)).toBeNull();
  });

  it('다시 시도 요청 중에는 다시 시도 단추가 잠긴다', () => {
    renderStep(failedSession({ failure_code: 'TIMEOUT' }), { retryPending: true });
    const retry = screen.getByRole('button', { name: '다시 시도' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
  });

  it('실패 중에는 높이 불일치 안내를 보이지 않는다', () => {
    renderStep(
      failedSession({
        progress_pct: 70,
        failure_code: 'TIMEOUT',
        height_checks: { cam_A: check({ within_tolerance: false, difference_cm: 41 }) },
      }),
    );
    expect(screen.queryByRole('alert', { name: '카메라 높이 불일치 경고' })).toBeNull();
  });
});

describe('보정 검증 결과 표', () => {
  const withChecks = (over: Record<string, unknown> = {}) =>
    sessionOf({
      progress_pct: 70,
      height_checks: {
        cam_A: check(),
        cam_B: check({
          input_height_m: 2.3,
          restored_height_m: 2.71,
          difference_cm: 41,
          within_tolerance: false,
          guidance: 'cam_B 높이를 다시 재서 입력해 주세요',
        }),
      },
      ...over,
    });

  it('카메라·입력·복원·차이 네 열로 카메라마다 한 행을 보이고 카메라 이름은 서버 id 가 아니다', () => {
    renderStep(withChecks());
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['카메라', '입력', '복원', '차이']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((c) => c.textContent),
      ),
    ).toEqual([
      ['2.25 m', '2.26 m', '1.0 cm'],
      ['2.3 m', '2.71 m', '41.0 cm'],
    ]);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      '카메라 1',
      '카메라 2',
    ]);
    expect(screen.getByRole('heading', { name: '보정 검증 결과' })).toBeTruthy();
    expect(screen.getByText('높이 차이 허용 5 cm')).toBeTruthy();
  });

  it('안 맞는 행은 서버 within_tolerance 로 정해 delay 톤으로 보인다(허용값으로 다시 계산하지 않는다)', () => {
    renderStep(
      withChecks({
        height_checks: {
          cam_A: check({ difference_cm: 0.5, within_tolerance: false }),
          cam_B: check({ difference_cm: 41, within_tolerance: true }),
        },
      }),
    );
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows[0]!.getAttribute('data-within-tolerance')).toBe('false');
    expect(rows[0]!.className).toContain('text-delay');
    expect(rows[1]!.getAttribute('data-within-tolerance')).toBe('true');
    expect(rows[1]!.className).not.toContain('text-delay');
  });

  it('복원 높이·차이를 서버가 주지 않았으면 줄표로 보이고 허용값이 없으면 허용 문구를 생략한다', () => {
    renderStep(
      withChecks({
        height_tolerance_cm: undefined,
        height_checks: {
          cam_A: check({ restored_height_m: null, difference_cm: null, within_tolerance: false }),
        },
      }),
    );
    const cells = within(screen.getByRole('table')).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual(['2.25 m', '—', '—']);
    expect(screen.queryByText(/높이 차이 허용/)).toBeNull();
  });

  it('높이 불일치 안내는 서버 문구를 그대로 보이고, 서버가 높이를 확인하기 전(40% 미만)에는 숨긴다', () => {
    renderStep(withChecks());
    expect(screen.getByRole('alert', { name: '카메라 높이 불일치 경고' }).textContent).toContain(
      '카메라 2 높이를 다시 재서 입력해 주세요',
    );
    cleanup();
    renderStep(withChecks({ progress_pct: 39 }));
    expect(screen.queryByRole('alert', { name: '카메라 높이 불일치 경고' })).toBeNull();
    // 결과 표는 서버가 값을 준 뒤에는 늘 보인다
    expect(screen.getByRole('table')).toBeTruthy();
  });
});

describe('쌍별 검증 표(S15P31A101-646) · 카메라 확인은 걷기 창이 맡는다(S15P31A101-687)', () => {
  const CAMS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];
  const readySession = (over: Record<string, unknown> = {}) =>
    // 미리보기 전(3D 칸 없음): 보정 등록(65%) 뒤 맵 전에 카메라 확인을 한다
    sessionOf({
      status: 'JOINT_BA_AND_VERIFY',
      stage: 'JOINT_BA_AND_VERIFY',
      progress_pct: 65,
      camera_heights_m: { cam_A: 2.44, cam_B: 2.44, cam_C: 2.48, cam_D: 2.48 },
      calibration_version: 'cal-9',
      quality_gate: buildQualityGate(CAMS),
      ...over,
    });

  function renderCheck(session: ReturnType<typeof sessionOf>) {
    const waiting = deriveWaitingView(session);
    render(
      <SetupCalibrateStep
        cameraView={<div data-testid="camera-view" />}
        waiting={waiting}
        cameraCheck={deriveCameraCheckView(session, waiting.cameraIds)}
        showCameraCheck
        onRetry={vi.fn()}
        onReturnToStep1={vi.fn()}
      />,
    );
  }

  it('작은 카메라 확인 카드는 없고 쌍별 표에 옆 카메라 4쌍이 있다', () => {
    renderCheck(
      readySession({
        camera_check: buildCameraCheck(CAMS, 'cal-9', 'MEASURING', 40),
        camera_check_passed: false,
      }),
    );
    expect(screen.queryByRole('heading', { name: '카메라 확인' })).toBeNull();
    expect(screen.queryByRole('progressbar', { name: '카메라 확인 진행률' })).toBeNull();
    const table = screen.getByRole('table', { name: '카메라 쌍별 검증' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: '다시 보정' })).toBeNull();
  });

  it('녹화 재생 시험으로 걷기 확인을 건너뛰면 「재생 시험: 걷기 확인 생략」을 보이고, 아니면 보이지 않는다(S15P31A101-736)', () => {
    renderCheck(
      readySession({
        camera_check: buildCameraCheck(CAMS, 'cal-9', 'SKIPPED_REPLAY'),
        camera_check_passed: true,
        camera_check_phase: 'SKIPPED_REPLAY',
      }),
    );
    const notice = screen.getByTestId('setup-replay-skip');
    expect(notice.textContent).toContain('재생 시험: 걷기 확인 생략');
    expect(notice.getAttribute('role')).toBe('status');
    cleanup();
    renderCheck(
      readySession({
        camera_check: buildCameraCheck(CAMS, 'cal-9', 'PASSED'),
        camera_check_passed: true,
        camera_check_phase: 'PASSED',
      }),
    );
    expect(screen.queryByTestId('setup-replay-skip')).toBeNull();
  });

  it('옛 품질 게이트 멈춤(paused_reason QUALITY_GATE)도 멈춤 안내를 그리지 않는다(PausedNotice 삭제, S15P31A101-691)', () => {
    renderCheck(readySession({ paused_reason: 'QUALITY_GATE' }));
    expect(screen.queryByRole('alert', { name: '세팅 멈춤 안내' })).toBeNull();
    expect(screen.queryByRole('button', { name: '카메라 연결 관리로' })).toBeNull();
  });

  it('카메라 확인 걷기 대기(paused_reason CAMERA_CHECK)는 보정 멈춤 안내로 보이지 않는다', () => {
    renderCheck(
      readySession({
        camera_check: buildCameraCheck(CAMS, 'cal-9', 'AWAITING_START'),
        camera_check_passed: false,
        camera_check_phase: 'AWAITING_START',
        paused_reason: 'CAMERA_CHECK',
      }),
    );
    expect(screen.queryByRole('button', { name: '카메라 연결 관리로' })).toBeNull();
    expect(screen.queryByText(/멈췄습니다/)).toBeNull();
  });

  it('실패한 쌍은 표에서 실패로 보인다', () => {
    renderCheck(
      readySession({
        camera_check: buildCameraCheck(CAMS, 'cal-9', 'FAILED', 100),
        camera_check_passed: false,
      }),
    );
    const failedRow = screen
      .getAllByRole('row')
      .find((row) => row.textContent?.startsWith('카메라 2–카메라 3'))!;
    expect(failedRow.getAttribute('data-outcome')).toBe('fail');
  });
});

describe('보정·생성 화면 정리(S15P31A101-691)', () => {
  const props = (session: ReturnType<typeof sessionOf>) => ({
    cameraView: <div data-testid="camera-view" />,
    waiting: deriveWaitingView(session),
    onRetry: vi.fn(),
    onReturnToStep1: vi.fn(),
  });

  it('왼쪽은 카메라 영상 탭이 기본이고, 미리보기 맵이 생겨도 저절로 3D 로 바뀌지 않으며 탭을 눌러야 3D 가 보인다', () => {
    // 3D 탭은 Scene 조회(Query)를 쓴다. 받지 못해도(api 대역) 빈 틀은 그린다
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { rerender } = render(<SetupCalibrateStep {...props(sessionOf())} />, { wrapper });
    const mapTab = screen.getByRole('tab', { name: '3D 미리보기' }) as HTMLButtonElement;
    expect(mapTab.disabled).toBe(true);
    expect(screen.getByRole('tab', { name: '카메라 영상' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByTestId('camera-view')).toBeTruthy();

    const ready = sessionOf({
      status: 'BAKING_TEXTURE',
      stage: 'BAKING_TEXTURE',
      progress_pct: 90,
      preview_scene_version: 'scene-preview-1',
    });
    rerender(<SetupCalibrateStep {...props(ready)} />);
    expect(screen.getByTestId('camera-view')).toBeTruthy();
    expect(screen.queryByTestId('setup-preview-viewport')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '3D 미리보기' }));
    expect(screen.queryByTestId('camera-view')).toBeNull();
    expect(screen.getByTestId('setup-preview-viewport')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '카메라 영상' }));
    expect(screen.getByTestId('camera-view')).toBeTruthy();
  });

  it('정밀 3D 맵까지 끝나면 고른 적이 없을 때 왼쪽이 3D 미리보기로 바뀐다', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { rerender } = render(<SetupCalibrateStep {...props(sessionOf())} />, { wrapper });
    expect(screen.getByTestId('camera-view')).toBeTruthy();
    const complete = sessionOf({
      status: 'COMPLETED',
      stage: 'COMPLETED',
      progress_pct: 100,
      preview_scene_version: 'scene-preview-1',
      scene_version: 'scene-final-1',
    });
    rerender(<SetupCalibrateStep {...props(complete)} />);
    expect(screen.queryByTestId('camera-view')).toBeNull();
    expect(screen.getByTestId('setup-preview-viewport')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '3D 미리보기' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('tab', { name: '카메라 영상' }));
    expect(screen.getByTestId('camera-view')).toBeTruthy();
  });

  it('시연 계정은 지금 할 일 없이 자세히 · 진행 단계를 펼쳐 보인다', () => {
    render(
      <SetupCalibrateStep
        {...props(sessionOf({ progress_pct: 52.5 }))}
        nextStep={{ title: '카메라를 보정하고 있어요', detail: '', tone: 'idle' }}
        demo
      />,
    );
    expect(screen.queryByTestId('setup-next-step')).toBeNull();
    const details = screen.getByRole('group', { name: '진행 단계 자세히' });
    expect(details.hasAttribute('open')).toBe(true);
    expect(within(details).getByRole('list', { name: '보정·생성 단계' })).toBeTruthy();
  });

  it('오른쪽 맨 위는 지금 할 일 한 장(무엇이 / 어떻게)과 전체 진행 막대 하나다', () => {
    render(
      <SetupCalibrateStep
        {...props(sessionOf({ progress_pct: 52.5 }))}
        nextStep={{
          title: '카메라를 보정하고 있어요',
          detail: '끝나면 카메라 확인 걷기 창이 열려요',
          tone: 'idle',
        }}
      />,
    );
    const card = screen.getByTestId('setup-next-step');
    expect(within(card).getByRole('heading', { name: '지금 할 일' })).toBeTruthy();
    expect(within(card).getByRole('status').textContent).toBe('카메라를 보정하고 있어요');
    expect(within(card).getByText('끝나면 카메라 확인 걷기 창이 열려요')).toBeTruthy();
    expect(
      within(card).getByRole('progressbar', { name: '전체 진행' }).getAttribute('aria-valuenow'),
    ).toBe('52.5');
    // 단계별 막대는 지금 할 일 카드에 없다
    expect(within(card).queryByRole('list', { name: '보정·생성 단계' })).toBeNull();
  });

  it('맵 보강 촬영은 「자세히 · 맵 보강」에서만 연다(여는 함수를 줄 때만 보인다)', () => {
    const onOpenSupplement = vi.fn();
    const { rerender } = render(<SetupCalibrateStep {...props(sessionOf())} />);
    expect(screen.queryByRole('group', { name: '맵 보강 자세히' })).toBeNull();
    rerender(<SetupCalibrateStep {...props(sessionOf())} onOpenSupplement={onOpenSupplement} />);
    const details = screen.getByRole('group', { name: '맵 보강 자세히' });
    fireEvent.click(within(details).getByRole('button', { name: '맵 보강 촬영' }));
    expect(onOpenSupplement).toHaveBeenCalledTimes(1);
  });
});
