import { calibrateNextStep, step1NextStep, type Step1NextInput } from '@/features/setup/nextStep';
import { deriveStep1Coverage, deriveWaitingView } from '@/features/setup/setup';
import type { CoverageGuidesResponse, SetupSessionResponse } from '@/features/setup/types';
import { buildCoverageGuidePayload } from '@/mocks/setup';
import { describe, expect, it } from 'vitest';

// 「지금 할 일」 카드 한 장(S15P31A101-691): '다음' 을 막는 이유가 먼저, 그다음 카메라 배지 우선순위로 가장 급한 하나.

const CAMS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];
const fresh = (latest = buildCoverageGuidePayload({ guides: [] })): CoverageGuidesResponse => ({
  calibration_version: null,
  guides: [],
  site_id: 'classroom-1',
  status: 'OK',
  stale: false,
  received_at_ms: 100,
  age_ms: 0,
  latest,
});
const input = (patch: Partial<Step1NextInput> = {}): Step1NextInput => ({
  coverage: deriveStep1Coverage(fresh()),
  heights: { missingIds: [], invalidIds: [] },
  heightCameraIds: CAMS,
  modePending: false,
  submitting: false,
  ...patch,
});

describe('1단계 지금 할 일', () => {
  it('모두 좋으면 준비됨과 다음 할 일', () => {
    expect(step1NextStep(input())).toEqual({
      title: '카메라 4대가 준비됐어요',
      detail: '「다음」을 누르면 카메라 앞을 비우고 배경을 찍어요',
      tone: 'ok',
    });
  });

  it("'다음' 을 막는 높이 칸·재사용 확인 중·요청 중은 카메라 문제보다 먼저 이유를 본문에 쓴다", () => {
    const broken = deriveStep1Coverage(
      fresh(buildCoverageGuidePayload({ guides: [], cameraStatuses: { cam_B: 'NO_VIDEO' } })),
    );
    expect(
      step1NextStep(
        input({ coverage: broken, heights: { missingIds: ['cam_C'], invalidIds: [] } }),
      ),
    ).toMatchObject({ title: '카메라 3 높이가 비어 있어요', tone: 'delay' });
    expect(
      step1NextStep(input({ heights: { missingIds: [], invalidIds: ['cam_A', 'cam_D'] } })).title,
    ).toBe('카메라 1, 카메라 4 높이를 다시 확인해 주세요');
    expect(step1NextStep(input({ coverage: broken, modePending: true })).detail).toBe(
      '확인이 끝나면 「다음」이 켜집니다',
    );
    expect(step1NextStep(input({ submitting: true, modePending: true })).title).toBe(
      '세팅을 시작하는 중이에요',
    );
  });

  it('카메라 문제는 배지 우선순위대로 하나만: 끊김 → 달라짐 → 겹침 부족 → 각도', () => {
    const latest = buildCoverageGuidePayload({
      cameraStatuses: { cam_D: 'NO_VIDEO' },
      guides: [
        {
          camera_id: 'cam_A',
          pair: ['cam_A', 'cam_B'],
          direction: 'LEFT',
          magnitude: 'MORE',
          reason_code: 'WEAK_PAIR_EDGE_CLUSTER',
        },
      ],
    });
    const of = (changed: string[] = []) =>
      step1NextStep(
        input({
          coverage: deriveStep1Coverage(fresh(latest), false, CAMS, { changedCameras: changed }),
        }),
      );
    expect(of()).toEqual({
      title: '카메라 4 영상이 들어오지 않아요',
      detail: '카메라 전원과 공유기 연결을 확인해 주세요',
      tone: 'delay',
    });
    const noDisconnect = buildCoverageGuidePayload({
      guides: latest.guides,
      pairs: latest.pairs,
    });
    const without = (changed: string[] = []) =>
      step1NextStep(
        input({
          coverage: deriveStep1Coverage(fresh(noDisconnect), false, CAMS, {
            changedCameras: changed,
          }),
        }),
      );
    expect(without(['cam_B']).title).toBe('카메라 2 위치나 방향이 직전 세팅과 달라졌어요');
    // 기본 목업 쌍에는 옆 쌍 LACK 이 없어 각도 안내가 다음이다
    expect(without()).toEqual({
      title: '카메라 1 각도를 맞춰 주세요',
      detail: '왼쪽으로 더 돌려 주세요 (카메라 1–카메라 2)',
      tone: 'delay',
    });
  });

  it('근거가 오래되면 확인 중이고 진행은 막지 않는다', () => {
    expect(
      step1NextStep(
        input({ coverage: deriveStep1Coverage(fresh(), false, CAMS, { expired: true }) }),
      ),
    ).toEqual({
      title: '카메라 상태를 확인하고 있어요',
      detail: '확인이 끝나지 않아도 「다음」으로 시작할 수 있어요',
      tone: 'idle',
    });
  });
});

describe('보정·생성 지금 할 일', () => {
  const session = (patch: Partial<SetupSessionResponse>) =>
    ({
      setup_session_id: 's1',
      status: 'COLLECTING_BACKGROUND',
      stage: 'COLLECTING_BACKGROUND',
      progress_pct: 5,
      camera_heights_m: { cam_A: 2.4 },
      ...patch,
    }) as SetupSessionResponse;
  const step = (
    patch: Partial<SetupSessionResponse>,
    extra: { walkOpen?: boolean; blocked?: string | null } = {},
  ) =>
    calibrateNextStep({
      waiting: deriveWaitingView(session(patch)),
      pollingError: false,
      walkOpen: extra.walkOpen ?? false,
      cameraCheckBlocked: extra.blocked ?? null,
    });

  it('단계마다 무엇이 / 어떻게 한 장', () => {
    expect(step({})?.title).toBe('사람 없는 배경을 찍고 있어요');
    expect(
      step({ status: 'JOINT_BA_AND_VERIFY', stage: 'JOINT_BA_AND_VERIFY', progress_pct: 50 })
        ?.detail,
    ).toBe('끝나면 카메라 확인 걷기 창이 열려요');
    expect(step({}, { walkOpen: true })?.title).toBe('카메라 확인 걷기를 해 주세요');
    const baking = step({
      status: 'BAKING_TEXTURE',
      stage: 'BAKING_TEXTURE',
      progress_pct: 90,
      preview_scene_version: 'p1',
    });
    expect(baking?.title).toBe('3D 맵을 만들고 있어요');
    expect(baking?.detail).toMatch(/^다 만들면 「다음」이 켜집니다 · 약 .+ 남음$/);
  });

  it("맵이 다 됐으면 '다음' 안내, 카메라 확인 미통과면 그 이유를 본문에 쓴다", () => {
    const done = {
      status: 'COMPLETED',
      stage: 'COMPLETED',
      progress_pct: 100,
      scene_version: 'f1',
    } as const;
    expect(step(done)).toEqual({
      title: '3D 맵이 준비됐어요',
      detail: '「다음」을 눌러 위험 구역을 확인하세요',
      tone: 'ok',
    });
    expect(step(done, { blocked: '카메라 확인을 마치면 넘어갈 수 있어요' })?.detail).toBe(
      '맵 생성 작업이 끝나 걷기만 다시 할 수 없어요. 「카메라 연결 관리로」 돌아가 세팅을 다시 시작해 주세요.',
    );
  });

  it('실패면 없음(실패 안내가 대신), 조회 실패·대기 이유가 단계보다 먼저', () => {
    expect(step({ status: 'FAILED', stage: 'FAILED' })).toBeNull();
    expect(
      calibrateNextStep({
        waiting: deriveWaitingView(session({})),
        pollingError: true,
        walkOpen: false,
        cameraCheckBlocked: null,
      })?.title,
    ).toBe('진행 상태를 받지 못하고 있어요');
    expect(
      step({
        wait_reason: {
          code: 'NO_WORKER',
          since_ms: 1,
          tier0_lag_ms: null,
          previous_error_code: null,
          worker_last_seen_ms: null,
        } as unknown as SetupSessionResponse['wait_reason'],
      })?.title,
    ).toBe('GPU 서버(분석 워커)가 연결돼 있지 않습니다');
  });
});

describe('1단계: 게이트웨이 헬퍼 끊김(S15P31A101-719)', () => {
  it('「확인 중」 대신 끊김 이유와 다음 행동을 말한다', () => {
    const stale: CoverageGuidesResponse = {
      ...fresh(),
      status: 'STALE',
      stale: true,
      age_ms: 90_000,
    };
    const step = step1NextStep(
      input({ coverage: deriveStep1Coverage(stale, false, CAMS, { helperLost: true }) }),
    );
    expect(step.title).toBe('현장 게이트웨이와 연결이 끊겨 카메라를 확인할 수 없어요');
    expect(step.detail).toContain('「다음」으로 시작할 수 있어요');
    expect(step.tone).toBe('delay');
    expect(step1NextStep(input({ coverage: deriveStep1Coverage(stale, false, CAMS) })).title).toBe(
      '카메라 상태를 확인하고 있어요',
    );
  });
});
