import {
  cameraCheckBlockReason,
  cameraCheckFailed,
  deriveCameraCheckView,
  deriveCameraWalkView,
  LIVE_HOLD_MS,
  liveCameras,
  NO_PERSON_WARN_MS,
  trackLiveCameras,
  WALK_TARGET_SECONDS,
  walkGuide,
  walkStatus,
} from '@/features/setup/cameraCheck';
import {
  deriveSetupActions,
  type SetupActionHandlers,
  type SetupActionState,
} from '@/features/setup/setupActions';
import { setupSessionResponseSchema, type SetupSessionResponse } from '@/features/setup/types';
import { buildCameraCheck, buildQualityGate, createSetupMock } from '@/mocks/setup';
import { describe, expect, it, vi } from 'vitest';

// 보정 품질 게이트·카메라 확인(S15P31A101-646) 화면 판단.

const CAMS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];

const session = (patch: Record<string, unknown> = {}): SetupSessionResponse =>
  setupSessionResponseSchema.parse({
    setup_session_id: 's-646',
    site_id: 'lobby',
    work_unit_id: 7,
    status: 'BAKING_TEXTURE',
    progress_pct: 95,
    camera_heights_m: { cam_A: 2.44, cam_B: 2.44, cam_C: 2.48, cam_D: 2.48 },
    calibration_version: 'cal-646',
    ...patch,
  });

describe('deriveCameraCheckView', () => {
  it('옆 카메라 4쌍을 만들고 보정 홀드아웃·사람 통과율을 카메라 짝으로 맞춘다(키 순서와 무관)', () => {
    const gate = buildQualityGate(CAMS);
    const view = deriveCameraCheckView(
      session({
        quality_gate: gate,
        camera_check: buildCameraCheck(CAMS, 'cal-646', 'PASSED'),
        camera_check_passed: true,
      }),
      CAMS,
    );
    expect(view.pairs.map((p) => p.label)).toEqual([
      '카메라 1–카메라 2',
      '카메라 1–카메라 4',
      '카메라 2–카메라 3',
      '카메라 3–카메라 4',
    ]);
    const da = view.pairs.find((p) => p.label === '카메라 1–카메라 4')!;
    // 품질 게이트 키는 'cam_D-cam_A'(고리 순서)지만 camera_ids 로 맞춘다
    expect(da.holdoutMedianPx).toBeCloseTo(0.75);
    expect(da.outcome).toBe('pass');
    // 마주 보는 쌍(1–3, 2–4)은 서버가 판정을 줘도 표에 두지 않는다.
    expect(view.pairs.find((p) => p.label === '카메라 1–카메라 3')).toBeUndefined();
    expect(view.pairs.find((p) => p.label === '카메라 2–카메라 4')).toBeUndefined();
    expect(view.passed).toBe(true);
    expect(cameraCheckBlockReason(view)).toBeNull();
  });

  it('실패한 쌍과 원인 문장을 보이고 다음을 막는다', () => {
    const view = deriveCameraCheckView(
      session({
        camera_check: buildCameraCheck(CAMS, 'cal-646', 'FAILED', 100),
        camera_check_passed: false,
      }),
      CAMS,
    );
    expect(view.pairs.find((p) => p.label === '카메라 2–카메라 3')!.outcome).toBe('fail');
    expect(cameraCheckFailed(view)).toBe(true);
    expect(view.problems[0]).toContain('통과율');
    expect(cameraCheckBlockReason(view)).toContain('다시 보정');
  });

  it('품질 게이트 실패(세션 FAILED)도 쌍을 실패로 보이고 문제를 싣는다', () => {
    const gate = buildQualityGate(CAMS);
    gate.verdict = 'FAILED';
    gate.pairs['cam_B-cam_C'] = {
      ...gate.pairs['cam_B-cam_C']!,
      median_px: 7.04,
      verdict: 'FAIL',
      reason: 'HOLDOUT_ERROR_HIGH',
    };
    gate.problems = [
      {
        kind: 'PAIR',
        id: 'cam_B-cam_C',
        camera_ids: ['cam_B', 'cam_C'],
        reason: 'HOLDOUT_ERROR_HIGH',
        message: 'cam_B-cam_C: 홀드아웃 재투영 오차가 큽니다',
      },
    ];
    const view = deriveCameraCheckView(session({ status: 'FAILED', quality_gate: gate }), CAMS);
    expect(view.status).toBe('NONE');
    expect(view.pairs.find((p) => p.label === '카메라 2–카메라 3')!.outcome).toBe('fail');
    expect(view.problems).toEqual(['cam_B-cam_C: 홀드아웃 재투영 오차가 큽니다']);
  });

  it('서버 판정(camera_check_passed)이 아니면 통과로 보지 않는다(다른 보정의 PASSED 등)', () => {
    const view = deriveCameraCheckView(
      session({
        camera_check: buildCameraCheck(CAMS, 'cal-old', 'PASSED'),
        camera_check_passed: false,
      }),
      CAMS,
    );
    expect(view.status).toBe('PASSED');
    expect(view.gated).toBe(true);
    expect(view.passed).toBe(false);
    expect(cameraCheckBlockReason(view)).toBe('카메라 확인을 마치면 넘어갈 수 있어요');
  });

  it('값이 없거나 모양이 틀리면 확인 전으로 본다', () => {
    const view = deriveCameraCheckView(
      session({ camera_check: { status: 'WEIRD' }, camera_check_passed: false }),
      CAMS,
    );
    expect(view.status).toBe('NONE');
    expect(view.pairs.every((p) => p.outcome === 'pending')).toBe(true);
    expect(view.phase).toBeNull();
  });

  it('녹화 재생 시험 건너뜀(SKIPPED_REPLAY)은 서버 관문대로 통과하고 걷기 창을 열지 않는다(S15P31A101-736)', () => {
    const skipped = session({
      camera_check: buildCameraCheck(CAMS, 'cal-646', 'SKIPPED_REPLAY'),
      camera_check_passed: true,
      camera_check_phase: 'SKIPPED_REPLAY',
    });
    const view = deriveCameraCheckView(skipped, CAMS);
    expect(view.status).toBe('SKIPPED_REPLAY');
    expect(view.phase).toBe('SKIPPED_REPLAY');
    expect(view.skippedForReplay).toBe(true);
    expect(view.passed).toBe(true);
    expect(cameraCheckBlockReason(view)).toBeNull();
    expect(cameraCheckFailed(view)).toBe(false);
    expect(deriveCameraWalkView(skipped, CAMS).open).toBe(false);
    // 스위치를 끄거나 실제 카메라로 돌아오면 서버가 통과로 보지 않는다(화면은 그 판정을 따른다)
    const blocked = deriveCameraCheckView(
      session({
        camera_check: buildCameraCheck(CAMS, 'cal-646', 'SKIPPED_REPLAY'),
        camera_check_passed: false,
        camera_check_phase: 'SKIPPED_REPLAY',
      }),
      CAMS,
    );
    expect(blocked.passed).toBe(false);
    expect(deriveCameraCheckView(session(), CAMS).skippedForReplay).toBe(false);
  });

  it('걷기 창 단계를 아는 서버면 확인만 다시 대기(RETRY_WAIT)는 다시 보정 실패가 아니다', () => {
    const retry = deriveCameraCheckView(
      session({
        camera_check: buildCameraCheck(CAMS, 'cal-646', 'INCOMPLETE', 40),
        camera_check_passed: false,
        camera_check_phase: 'RETRY_WAIT',
      }),
      CAMS,
    );
    expect(cameraCheckFailed(retry)).toBe(false);
    const closed = deriveCameraCheckView(
      session({
        status: 'FAILED',
        camera_check: buildCameraCheck(CAMS, 'cal-646', 'INCOMPLETE', 40),
        camera_check_passed: false,
        camera_check_phase: 'FAILED',
      }),
      CAMS,
    );
    expect(cameraCheckFailed(closed)).toBe(true);
  });
});

describe('세팅 2단계 다음·다시 보정 단추', () => {
  const on = (): SetupActionHandlers => ({
    start: vi.fn(),
    confirm: vi.fn(),
    restart: vi.fn(),
    cancelSession: vi.fn(),
    recheckCameras: vi.fn(),
    finish: vi.fn(),
  });
  const state = (patch: Partial<SetupActionState>): SetupActionState => ({
    stage: 1,
    embedded: false,
    startDisabled: false,
    mapComplete: true,
    sessionRunning: false,
    cancelPending: false,
    showHeightNotice: false,
    canFinish: false,
    finishPending: false,
    setupCompleted: false,
    ...patch,
  });

  it('맵이 다 됐어도 카메라 확인 전에는 다음이 꺼지고 이유를 title 로 보인다', () => {
    const [next] = deriveSetupActions(
      state({ cameraCheckBlocked: '카메라 확인을 마치면 넘어갈 수 있어요' }),
      on(),
    );
    expect(next).toMatchObject({ label: '다음', disabled: true, primary: true });
    expect(next!.title).toBe('카메라 확인을 마치면 넘어갈 수 있어요');
    // 맵이 아직이면 맵 이유가 먼저다
    const [first] = deriveSetupActions(
      state({ mapComplete: false, cameraCheckBlocked: 'x' }),
      on(),
    );
    expect(first!.title).toBe('3D 맵을 다 만들면 넘어갈 수 있어요');
  });

  it('카메라 확인이 실패하면 다시 보정 단추가 생기고 restart 를 부른다', () => {
    const handlers = on();
    const buttons = deriveSetupActions(
      state({ cameraCheckBlocked: 'x', cameraCheckFailed: true }),
      handlers,
    );
    const again = buttons.find((b) => b.key === 'recalibrate')!;
    expect(again).toMatchObject({ label: '다시 보정', primary: false, disabled: false });
    again.onClick();
    expect(handlers.restart).toHaveBeenCalled();
  });
});

describe('관문을 모르는 이전 서버', () => {
  it('camera_check_passed 가 없으면 막지 않고 카드도 숨길 수 있게 gated=false', () => {
    const view = deriveCameraCheckView(session(), CAMS);
    expect(view.gated).toBe(false);
    expect(view.passed).toBe(true);
    expect(cameraCheckBlockReason(view)).toBeNull();
  });
});

describe('mock: 카메라 확인 진행과 관문', () => {
  it('autoProgress 는 보정 뒤 기다림 → 재는 중 → 통과로 가고, 통과 전 완료·구역 저장을 거부하는 값을 낸다', () => {
    let t = 1_000_000;
    const mock = createSetupMock({ now: () => t, autoProgress: true });
    const base = session({
      status: 'COLLECTING_BACKGROUND',
      progress_pct: 0,
      calibration_version: null,
    });
    mock.sessions.set(base.setup_session_id, { ...base, started_at_ms: t });
    expect(buildCameraCheck(CAMS, 'cal', 'MEASURING', 50).status).toBe('MEASURING');
    // 시간만 넘겨도 조회 처리기가 진행시키므로 여기서는 값 모양만 계약대로인지 본다
    t += 23_000;
    const gate = buildQualityGate(CAMS);
    expect(Object.keys(gate.pairs)).toEqual([
      'cam_A-cam_B',
      'cam_B-cam_C',
      'cam_C-cam_D',
      'cam_D-cam_A',
    ]);
    const parsed = setupSessionResponseSchema.parse({
      ...base,
      quality_gate: gate,
      camera_check: buildCameraCheck(CAMS, 'cal-646', 'INCOMPLETE', 40),
    });
    expect(parsed.camera_check?.problems[0]?.reason).toBe('NOT_FINISHED');
    expect(parsed.quality_gate?.verdict).toBe('PASSED');
  });
});

describe('걷기 창(S15P31A101-687)', () => {
  const withPhase = (patch: Record<string, unknown>) =>
    session({ status: 'JOINT_BA_AND_VERIFY', progress_pct: 65, ...patch });

  it('걷기 시작 대기면 창을 열고 다음 시도는 1, 수치는 아직 보이지 않는다', () => {
    const walk = deriveCameraWalkView(
      withPhase({
        camera_check: {
          ...buildCameraCheck(CAMS, 'cal-646', 'AWAITING_START'),
          user_wait: { until_ms: 1, wait_s: 412.4 },
        },
        camera_check_phase: 'AWAITING_START',
        paused_reason: 'CAMERA_CHECK',
      }),
      CAMS,
    );
    expect(walk.open).toBe(true);
    expect(walk.nextAttempt).toBe(1);
    expect(walk.waitSeconds).toBe(412);
    expect(walk.cameras.map((c) => c.label)).toEqual([
      '카메라 1',
      '카메라 2',
      '카메라 3',
      '카메라 4',
    ]);
    expect(walk.cameras.every((c) => c.observed === 0 && c.visible === null)).toBe(true);
  });

  it('걷는 중이면 카메라별 사람 보임과 관측 수를 보이고, 통과하면 창을 닫는다', () => {
    const check = buildCameraCheck(CAMS, 'cal-646', 'MEASURING', 50);
    check.cameras.cam_C!.person_visible = false;
    check.cameras.cam_A!.person_visible = true;
    const walking = deriveCameraWalkView(
      withPhase({
        camera_check: {
          ...check,
          attempt: { no: 1, id: 'l-1', started_at_ms: 1, expires_at_ms: 2 },
        },
        camera_check_phase: 'WALKING',
      }),
      CAMS,
    );
    expect(walking.open).toBe(true);
    expect(walking.cameras.find((c) => c.id === 'cam_A')!.visible).toBe(true);
    expect(walking.cameras.find((c) => c.id === 'cam_C')!.visible).toBe(false);
    expect(walking.cameras[0]!.observed).toBe(75);
    expect(walking.progressPct).toBe(50);
    const passed = deriveCameraWalkView(
      withPhase({
        camera_check: buildCameraCheck(CAMS, 'cal-646', 'PASSED'),
        camera_check_phase: 'PASSED',
      }),
      CAMS,
    );
    expect(passed.open).toBe(false);
  });

  it('표본 부족은 카메라 번호로, 기하 실패는 위치 불일치로 나눠 안내하고 다음 시도 번호를 올린다', () => {
    const shortage = buildCameraCheck(CAMS, 'cal-646', 'INCOMPLETE', 70);
    shortage.problems = [
      { kind: 'CAMERA', id: 'cam_D', camera_ids: ['cam_D'], reason: 'FEW_SAMPLES', message: 'x' },
    ];
    // 워커는 관측 수가 모자란 카메라에 FEW_SAMPLES 를 단다(관측은 찼는데 FEW_SAMPLES 면 재투영 표본 부족, S15P31A101-763)
    shortage.cameras.cam_D!.observed_views = 10;
    const retry = deriveCameraWalkView(
      withPhase({
        camera_check: {
          ...shortage,
          attempt: { no: 1, id: 'l-1', started_at_ms: 1, expires_at_ms: 2 },
          user_wait: { until_ms: 1, wait_s: 200 },
        },
        camera_check_phase: 'RETRY_WAIT',
      }),
      CAMS,
    );
    expect(retry.failure).toEqual({
      kind: 'shortage',
      title: '카메라 4에서 사람이 충분히 보이지 않았습니다',
      action: '표시된 구간을 지나며 30초만 다시 걸어 주세요',
    });
    expect(retry.nextAttempt).toBe(2);
    expect(retry.cameras.find((c) => c.id === 'cam_D')!.flagged).toBe(true);

    const geometry = deriveCameraWalkView(
      withPhase({
        camera_check: {
          ...buildCameraCheck(CAMS, 'cal-646', 'FAILED', 100),
          attempt: { no: 2, id: 'l-2', started_at_ms: 1, expires_at_ms: 2 },
          user_wait: { until_ms: 1, wait_s: 100 },
        },
        camera_check_phase: 'RETRY_WAIT',
      }),
      CAMS,
    );
    expect(geometry.failure?.kind).toBe('geometry');
    expect(geometry.failure?.title).toBe('카메라 2, 카메라 3 위치가 보정과 맞지 않습니다');
    expect(geometry.nextAttempt).toBe(3);
  });

  it('걷기 창 단계를 모르는 이전 서버면 창을 열지 않는다', () => {
    const walk = deriveCameraWalkView(
      withPhase({ camera_check: buildCameraCheck(CAMS, 'cal-646', 'MEASURING', 20) }),
      CAMS,
    );
    expect(walk.open).toBe(false);
  });
});

describe('걷기 창 상태 문구(S15P31A101-719)', () => {
  const walking = (observed: Record<string, number>, attemptId = 'lease-01') => {
    const check = buildCameraCheck(CAMS, 'cal-646', 'MEASURING', 0);
    for (const [id, n] of Object.entries(observed)) check.cameras[id]!.observed_views = n;
    return deriveCameraWalkView(
      session({
        status: 'JOINT_BA_AND_VERIFY',
        progress_pct: 65,
        camera_check: {
          ...check,
          attempt: { no: 1, id: attemptId, started_at_ms: 1, expires_at_ms: 2 },
        },
        camera_check_phase: 'WALKING',
      }),
      CAMS,
    );
  };
  const none = { cam_A: 0, cam_B: 0, cam_C: 0, cam_D: 0 };

  it('10초 넘게 어느 카메라도 0 회면 창 안에서 원인과 할 일을 알린다', () => {
    const view = walking(none);
    expect(walkStatus(view, WALK_TARGET_SECONDS - 9).hint).toBeNull();
    const hint = walkStatus(view, WALK_TARGET_SECONDS - 10).hint;
    expect(hint?.title).toBe('10초 동안 어느 카메라에도 사람이 보이지 않았어요');
    expect(hint?.action).toContain('한 사람만 카메라 앞을 천천히 지나가 주세요');
    // 한 카메라라도 보였으면 알리지 않는다
    expect(walkStatus(walking({ ...none, cam_B: 3 }), 0).hint).toBeNull();
  });

  it('카운트다운이 끝나면 덜 보인 카메라 이름을 쓴다', () => {
    const view = walking({ cam_A: 40, cam_B: 12, cam_C: 30, cam_D: 0 });
    expect(walkStatus(view, 0).status).toBe(
      '함께 보인 횟수가 모자라요: 카메라 1–카메라 2, 카메라 1–카메라 4, 카메라 2–카메라 3, 카메라 3–카메라 4. 두 카메라가 함께 보는 곳을 지나가 주세요.',
    );
    expect(walkStatus(view, 12).status).toBe(
      '걷는 중입니다. 카메라 사이 겹치는 곳을 고루 지나가 주세요.',
    );
  });

  it('카운트다운 기준은 세션과 워커 시도 ID 라 다시 시도한 세션의 1번 시도는 새로 센다', () => {
    expect(walking(none, 'lease-01').attemptKey).toBe('s-646:lease-01');
    expect(walking(none, 'lease-02').attemptKey).not.toBe(walking(none, 'lease-01').attemptKey);
  });
});

describe('걷기 안내·지금 보는 카메라(S15P31A101-763)', () => {
  const walkingView = (
    cameras: Record<
      string,
      Partial<{ observed_views: number; loo_samples: number; person_visible: boolean }>
    >,
    patch: Record<string, unknown> = {},
    attemptId = 'lease-01',
  ) => {
    const check = buildCameraCheck(CAMS, 'cal-763', 'MEASURING', 0);
    for (const [id, c] of Object.entries(cameras)) Object.assign(check.cameras[id]!, c);
    return deriveCameraWalkView(
      session({
        status: 'JOINT_BA_AND_VERIFY',
        progress_pct: 65,
        camera_check: {
          ...check,
          attempt: { no: 1, id: attemptId, started_at_ms: 1, expires_at_ms: 2 },
          ...patch,
        },
        camera_check_phase: 'WALKING',
      }),
      CAMS,
    );
  };
  const counts = (a: number, b: number, c: number, d: number) => ({
    cam_A: { observed_views: a },
    cam_B: { observed_views: b },
    cam_C: { observed_views: c },
    cam_D: { observed_views: d },
  });

  it('걷기 전 안내는 한 사람·방 가운데·옆 카메라 쌍 고리·60~90초를 쉬운 문장으로 준다', () => {
    const lines = walkGuide(CAMS);
    expect(lines).toEqual([
      '한 사람만 걸어요. 다른 사람은 카메라 밖에 있어 주세요.',
      '방 가운데(카메라 4대가 모두 보는 곳)를 천천히 크게 돌아요.',
      '옆 카메라 둘이 함께 보는 곳을 한 번씩 지나가요: 카메라 1–카메라 2, 카메라 2–카메라 3, 카메라 3–카메라 4, 카메라 4–카메라 1.',
      '60~90초 걸어요. 확인이 끝나면 창이 저절로 닫혀요.',
    ]);
    const view = deriveCameraWalkView(
      session({
        status: 'JOINT_BA_AND_VERIFY',
        camera_check: buildCameraCheck(CAMS, 'cal-763', 'AWAITING_START', 0),
        camera_check_phase: 'AWAITING_START',
      }),
      CAMS,
    );
    expect(walkStatus(view, WALK_TARGET_SECONDS).status).toBe(
      '보정이 끝났습니다. 아래처럼 걸으면 확인이 끝납니다.',
    );
  });

  it('요약 사이 관측 수가 늘어난 카메라만 켜고, 한동안 늘지 않으면 끈다(처음 받은 값은 기준)', () => {
    const t0 = 1_000_000;
    let tracker = trackLiveCameras(null, walkingView(counts(10, 10, 0, 0)), t0);
    // 창을 늦게 열어 이미 쌓인 수는 지금 보는 것으로 치지 않는다
    expect(liveCameras(tracker, walkingView(counts(10, 10, 0, 0))).liveCount).toBe(0);

    const second = walkingView(counts(14, 10, 3, 0));
    tracker = trackLiveCameras(tracker, second, t0 + 2_000);
    const live = liveCameras(tracker, second);
    expect(live.liveCount).toBe(2);
    expect(live.total).toBe(4);
    expect(live.cameras.filter((c) => c.live).map((c) => c.label)).toEqual([
      '카메라 1',
      '카메라 3',
    ]);
    expect(live.noPerson).toBe(false);

    // 같은 요약을 다시 받아도(워커 2초 주기와 어긋남) 잠깐은 켜 둔다
    tracker = trackLiveCameras(tracker, second, t0 + 2_000 + LIVE_HOLD_MS);
    expect(liveCameras(tracker, second).liveCount).toBe(2);
    tracker = trackLiveCameras(tracker, second, t0 + 2_000 + LIVE_HOLD_MS + 1);
    expect(liveCameras(tracker, second).liveCount).toBe(0);
  });

  it('워커가 최근 보였다고 한 카메라(person_visible)도 켠다', () => {
    const view = walkingView({ cam_B: { observed_views: 5, person_visible: true } });
    const tracker = trackLiveCameras(null, view, 500);
    const live = liveCameras(tracker, view);
    expect(live.cameras.map((c) => c.live)).toEqual([false, true, false, false]);
  });

  it('걷는 중 약 5초 동안 어느 카메라도 늘지 않으면 사람이 안 보인다고 알리고, 늘면 풀린다', () => {
    const t0 = 50_000;
    const still = walkingView(counts(0, 0, 0, 0));
    let tracker = trackLiveCameras(null, still, t0);
    tracker = trackLiveCameras(tracker, still, t0 + NO_PERSON_WARN_MS - 1);
    expect(liveCameras(tracker, still).noPerson).toBe(false);
    tracker = trackLiveCameras(tracker, still, t0 + NO_PERSON_WARN_MS);
    expect(liveCameras(tracker, still).noPerson).toBe(true);

    const moved = walkingView(counts(0, 0, 0, 2));
    tracker = trackLiveCameras(tracker, moved, t0 + NO_PERSON_WARN_MS + 500);
    expect(liveCameras(tracker, moved).noPerson).toBe(false);
    expect(liveCameras(tracker, moved).liveCount).toBe(1);
    // 마지막으로 늘어난 뒤 다시 5초가 지나면 또 알린다
    tracker = trackLiveCameras(tracker, moved, t0 + 2 * NO_PERSON_WARN_MS + 500);
    expect(liveCameras(tracker, moved).noPerson).toBe(true);
  });

  it('시도가 바뀌면(확인만 다시) 처음부터 센다', () => {
    let tracker = trackLiveCameras(null, walkingView(counts(10, 0, 0, 0)), 0);
    tracker = trackLiveCameras(tracker, walkingView(counts(20, 0, 0, 0)), 1_000);
    expect(liveCameras(tracker, walkingView(counts(20, 0, 0, 0))).liveCount).toBe(1);
    const next = walkingView(counts(3, 0, 0, 0), {}, 'lease-02');
    tracker = trackLiveCameras(tracker, next, 2_000);
    expect(tracker.startedMs).toBe(2_000);
    expect(liveCameras(tracker, next).liveCount).toBe(0);
  });

  it('아직 0 인 필수 쌍을 짚고, 사람은 충분히 보였는데 재투영 표본이 모자란 카메라에 방 가운데를 안내한다(응답 기준값 우선)', () => {
    const full = {
      cam_A: { observed_views: 100, loo_samples: 5 },
      cam_B: { observed_views: 100, loo_samples: 25 },
      cam_C: { observed_views: 100, loo_samples: 25 },
      cam_D: { observed_views: 10, loo_samples: 0 },
    };
    const view = walkingView(full, { thresholds: { min_loo_samples: 20 } });
    expect(view.cameras.map((c) => c.looShort)).toEqual([true, false, false, false]);
    expect(view.cameras[0]!.looNeed).toBe(20);
    // buildCameraCheck(0%) 는 쌍 표본이 모두 0 이라 필수(옆) 쌍만 0 으로 짚는다
    expect(view.pairs.filter((p) => p.zero).map((p) => p.label)).toEqual([
      '카메라 1–카메라 2',
      '카메라 1–카메라 4',
      '카메라 2–카메라 3',
      '카메라 3–카메라 4',
    ]);
    // criteria 로 온 기준값도 읽는다
    const relaxed = walkingView(full, { criteria: { min_loo_samples: 4 } });
    expect(relaxed.cameras[0]!.looShort).toBe(false);
    expect(relaxed.cameras[0]!.looNeed).toBe(4);
    // 기준값이 없으면 워커 기본 20
    expect(walkingView(full).cameras[0]!.looNeed).toBe(20);

    // 카운트다운이 끝났는데 쌍·카메라 관측은 찼고 재투영 표본만 모자라면 방 가운데로 안내한다
    const pairsFull = buildCameraCheck(CAMS, 'cal-763', 'MEASURING', 100);
    const onlyLoo = deriveCameraWalkView(
      session({
        status: 'JOINT_BA_AND_VERIFY',
        camera_check: {
          ...pairsFull,
          cameras: {
            ...pairsFull.cameras,
            cam_C: { ...pairsFull.cameras.cam_C!, loo_samples: 3 },
          },
          attempt: { no: 1, id: 'lease-01', started_at_ms: 1, expires_at_ms: 2 },
        },
        camera_check_phase: 'WALKING',
      }),
      CAMS,
    );
    expect(walkStatus(onlyLoo, 0).status).toBe(
      '방 가운데(카메라 4대가 모두 보는 곳)를 지나가 주세요. 아직 모자란 카메라: 카메라 3.',
    );
  });

  it('사람은 충분히 보였는데 FEW_SAMPLES 로 끝난 카메라는 방 가운데로 다시 걷게 안내한다(-759)', () => {
    const check = buildCameraCheck(CAMS, 'cal-763', 'INCOMPLETE', 100);
    check.problems = [
      { kind: 'CAMERA', id: 'cam_B', camera_ids: ['cam_B'], reason: 'FEW_SAMPLES', message: 'x' },
    ];
    const retry = deriveCameraWalkView(
      session({
        status: 'JOINT_BA_AND_VERIFY',
        camera_check: {
          ...check,
          attempt: { no: 1, id: 'l-1', started_at_ms: 1, expires_at_ms: 2 },
          user_wait: { until_ms: 1, wait_s: 200 },
        },
        camera_check_phase: 'RETRY_WAIT',
      }),
      CAMS,
    );
    expect(retry.failure).toEqual({
      kind: 'shortage',
      title: '카메라 2에 다른 카메라와 함께 보인 시간이 모자랐습니다',
      action: '방 가운데(카메라 4대가 모두 보는 곳)를 천천히 돌며 다시 걸어 주세요',
    });
  });
});
