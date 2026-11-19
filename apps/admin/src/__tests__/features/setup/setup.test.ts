import {
  boxOfDraftItem,
  CAMERA_CORNERS,
  CAMERA_HEIGHT_HELP,
  DEFAULT_CAMERA_IDS,
  deriveHeightCheckRows,
  deriveHeightFields,
  deriveHeightWarnings,
  deriveSceneTierStatus,
  deriveStageRows,
  deriveStep1Coverage,
  deriveWaitingView,
  deriveWaitReasonView,
  draftGhostsOf,
  estimateRemainingSeconds,
  formatClock,
  formatMinSec,
  formatRemainingKorean,
  isPreviewSceneReady,
  isSceneMapComplete,
  MAX_CAMERA_HEIGHT_M,
  resolveHeightCameraIds,
  sessionSceneVersion,
  SETUP_TARGET_DURATION_SEC,
  STEPS,
  validateHeightFields,
  WAITING_STAGES,
  ZONE_STAGE,
  zoneMapTitle,
} from '@/features/setup/setup';
import {
  blockedLiveWorkId,
  isSetupBlockedByLiveWork,
  SETUP_LIVE_WORK_BLOCKED_TEXT,
  SETUP_WORKER_UNAVAILABLE_TEXT,
  setupCancelErrorMessage,
  setupErrorMessage,
} from '@/features/setup/setupErrorMessage';
import {
  setupSessionResponseSchema,
  setupWaitReasonSchema,
  setupZoneDraftsResponseSchema,
  type SetupSessionResponse,
} from '@/features/setup/types';
import { ApiError } from '@/lib/http';
import { buildCoverageGuidePayload, buildSetupZoneDraftsResponse } from '@/mocks/setup';
import { describe, expect, it } from 'vitest';

describe('설치 · 보정 1단계 카메라 연결 상태·쌍 등급·방향 안내 계산', () => {
  it('보정 단계 순서에서 1단계는 카메라 연결 관리이고 마지막은 구역이며 걷기 보정 단계가 없다', () => {
    expect(STEPS).toEqual(['카메라 연결 관리', '보정·생성', '구역']);
    expect(STEPS[ZONE_STAGE]).toBe('구역');
    expect(DEFAULT_CAMERA_IDS).toEqual(['cam_A', 'cam_B', 'cam_C', 'cam_D']);
    expect(CAMERA_CORNERS).toHaveLength(4);
  });

  it('CONNECTED 이고 정상 수신이면 쌍 등급(충분·약함·부족)을 정리하고 연결 요약에 확인 시각을 붙인다', () => {
    const latest = buildCoverageGuidePayload({
      connectivity: 'CONNECTED',
      guides: [],
    });
    const view = deriveStep1Coverage(
      {
        calibration_version: 'cal-8',
        guides: [],
        site_id: 'classroom-1',
        status: 'OK',
        stale: false,
        received_at_ms: 1_793_690_000_100,
        age_ms: 100,
        latest,
      },
      false,
    );

    expect(view.connectivity).toBe('CONNECTED');
    expect(view.connectivitySummary).toBe('4대 모두 연결 · 방금');
    // 부족한 쌍은 마주 보는 쌍(1–3, 2–4)뿐이라 보정이 실패할 위험은 없다.
    expect(view.riskyPairs).toEqual([]);
    // 지도에는 옆 카메라 4쌍만 있다(마주 보는 쌍은 서버가 등급을 줘도 뺀다).
    expect(view.pairs.map((p) => p.label)).toEqual([
      '카메라 1–카메라 2',
      '카메라 1–카메라 4',
      '카메라 2–카메라 3',
      '카메라 3–카메라 4',
    ]);
    expect(view.pairs.map((p) => p.gradeLabel)).toEqual(['충분', '충분', '충분', '약함']);
    expect(view.cameras.every((c) => c.statusLabel === '정상')).toBe(true);
    expect(view.cameras.map((c) => c.label)).toEqual([
      '카메라 1',
      '카메라 2',
      '카메라 3',
      '카메라 4',
    ]);
    expect(view.pairs[0]!.label).toBe('카메라 1–카메라 2');
  });

  it('CONNECTED 의 선택 보강(OPTIONAL_IMPROVE)은 돌리라는 지시로 보이지 않는다', () => {
    const optional = (camera_id: string, pair: [string, string]) => ({
      camera_id,
      pair,
      direction: 'UP' as const,
      magnitude: 'MORE' as const,
      reason_code: 'OPTIONAL_IMPROVE' as const,
    });
    const latest = buildCoverageGuidePayload({
      connectivity: 'CONNECTED',
      guides: [
        optional('cam_A', ['cam_A', 'cam_B']),
        optional('cam_B', ['cam_A', 'cam_B']),
        optional('cam_C', ['cam_C', 'cam_D']),
      ],
    });
    const view = deriveStep1Coverage(
      {
        calibration_version: 'cal-8',
        guides: latest.guides,
        site_id: 'lobby',
        status: 'OK',
        stale: false,
        received_at_ms: 1_793_690_000_100,
        age_ms: 100,
        latest,
      },
      false,
    );

    expect(view.cameras.map((c) => c.guides)).toEqual([[], [], [], []]);
    expect(view.cameras.map((c) => c.guideLabel)).toEqual([
      '각도 양호',
      '각도 양호',
      '각도 양호',
      '각도 양호',
    ]);
  });

  it('DISCONNECTED 는 갈린 묶음을 보이고, 안내는 카메라 이름 없는 한 줄 문장과 영상 위 표시 값으로 만든다', () => {
    const latest = buildCoverageGuidePayload({
      connectivity: 'DISCONNECTED',
      guides: [
        {
          camera_id: 'cam_C',
          pair: ['cam_C', 'cam_D'],
          direction: 'RIGHT',
          magnitude: 'SMALL',
          reason_code: 'WEAK_PAIR_EDGE_CLUSTER',
        },
      ],
    });
    const view = deriveStep1Coverage(
      {
        calibration_version: null,
        guides: latest.guides,
        site_id: 'classroom-1',
        status: 'OK',
        stale: false,
        received_at_ms: 1_793_690_000_100,
        age_ms: 100,
        latest,
      },
      false,
    );

    expect(view.connectivity).toBe('DISCONNECTED');
    expect(view.connectivitySummary).toBe('카메라 1·카메라 2·카메라 3 / 카메라 4 갈림 · 방금');
    const cam_C = view.cameras.find((c) => c.id === 'cam_C')!;
    expect(cam_C.guideLabel).toBe('오른쪽으로 조금 돌려 주세요 (카메라 3–카메라 4)');
    // 카메라 3 쪽 같이 보는 곳(쌍 cam_C–cam_D 의 centroid_a)과 이웃 이름.
    expect(cam_C.guides).toEqual([
      {
        text: '오른쪽으로 조금 돌려 주세요 (카메라 3–카메라 4)',
        direction: 'RIGHT',
        magnitude: 'SMALL',
        neighborLabel: '카메라 4',
        spot: [0.79, 0.62],
      },
    ]);
  });

  it('한 카메라에 돌릴 안내가 둘이면 카메라 칸에 모두 이어 붙여 보인다', () => {
    const latest = buildCoverageGuidePayload({
      connectivity: 'DISCONNECTED',
      guides: [
        {
          camera_id: 'cam_C',
          pair: ['cam_C', 'cam_D'],
          direction: 'RIGHT',
          magnitude: 'SMALL',
          reason_code: 'WEAK_PAIR_EDGE_CLUSTER',
        },
        {
          camera_id: 'cam_C',
          pair: ['cam_B', 'cam_C'],
          direction: 'LEFT',
          magnitude: 'SMALL',
          reason_code: 'WEAK_PAIR_EDGE_CLUSTER',
        },
      ],
    });
    const view = deriveStep1Coverage(
      {
        calibration_version: null,
        guides: latest.guides,
        site_id: 'classroom-1',
        status: 'OK',
        stale: false,
        received_at_ms: 1_793_690_000_100,
        age_ms: 100,
        latest,
      },
      false,
    );
    expect(view.cameras.find((c) => c.id === 'cam_C')?.guideLabel).toBe(
      '오른쪽으로 조금 돌려 주세요 (카메라 3–카메라 4) · 왼쪽으로 조금 돌려 주세요 (카메라 2–카메라 3)',
    );
  });

  it('NO_VIDEO·STALE·계산 실패(UNKNOWN) 상태를 구분하고 진행을 막지 않는다', () => {
    const latest = buildCoverageGuidePayload({
      connectivity: 'UNKNOWN',
      cameraStatuses: { cam_B: 'NO_VIDEO', cam_D: 'STALE' },
      guides: [
        {
          camera_id: 'cam_B',
          pair: ['cam_B', 'cam_C'],
          direction: 'NONE',
          magnitude: 'NONE',
          reason_code: 'NO_OVERLAP_VISIBLE',
        },
      ],
    });

    const staleView = deriveStep1Coverage(
      {
        calibration_version: null,
        guides: latest.guides,
        site_id: 'classroom-1',
        status: 'STALE',
        stale: true,
        received_at_ms: 1_793_690_000_000,
        age_ms: 12_500,
        latest,
      },
      false,
    );

    expect(staleView.connectivity).toBe('UNKNOWN');
    expect(staleView.connectivitySummary).toBe('연결 확인 중 · 12초 전 확인');
    expect(staleView.stale).toBe(true);
    expect(staleView.calculationFailed).toBe(true);
    expect(staleView.noVideoCameras).toEqual(['cam_B']);
    expect(staleView.staleCameras).toEqual(['cam_D']);
    expect(staleView.cameras.find((c) => c.id === 'cam_B')?.statusLabel).toBe('영상 없음');
    expect(staleView.cameras.find((c) => c.id === 'cam_D')?.statusLabel).toBe('끊김');
    expect(staleView.cameras.find((c) => c.id === 'cam_B')?.guideLabel).toBe(
      '겹치는 곳이 없습니다. 각도를 조정하거나 겹치는 곳에 무늬 있는 물건을 두세요 (카메라 2–카메라 3)',
    );

    const errorView = deriveStep1Coverage(undefined, true);
    expect(errorView.calculationFailed).toBe(true);
    expect(errorView.connectivity).toBe('UNKNOWN');
    // 응답이 없으면 확인 시각을 모르므로 붙이지 않는다.
    expect(errorView.connectivitySummary).toBe('연결 확인 중');
  });
});

describe('카메라 높이 기본값 채움·검증', () => {
  it('마지막 제출 높이를 기본값으로 채우고 값 없는 카메라만 필수 입력으로 표시한다', () => {
    const defaultsResponse = {
      site_id: 'classroom-1',
      height_tolerance_cm: 5,
      camera_heights_m: {
        cam_A: 2.25,
        cam_B: 2.3,
        cam_C: 2.2,
        cam_D: null,
      },
      all_present: false,
    };

    const cameraIds = resolveHeightCameraIds(defaultsResponse);
    expect(cameraIds).toEqual(['cam_A', 'cam_B', 'cam_C', 'cam_D']);

    const fields = deriveHeightFields(cameraIds, defaultsResponse.camera_heights_m, {});
    expect(fields).toEqual([
      {
        cameraId: 'cam_A',
        defaultHeightM: 2.25,
        rawValue: '2.25',
        required: false,
        missing: false,
        invalid: false,
        valueM: 2.25,
      },
      {
        cameraId: 'cam_B',
        defaultHeightM: 2.3,
        rawValue: '2.3',
        required: false,
        missing: false,
        invalid: false,
        valueM: 2.3,
      },
      {
        cameraId: 'cam_C',
        defaultHeightM: 2.2,
        rawValue: '2.2',
        required: false,
        missing: false,
        invalid: false,
        valueM: 2.2,
      },
      {
        cameraId: 'cam_D',
        defaultHeightM: null,
        rawValue: '',
        required: true,
        missing: true,
        invalid: false,
        valueM: null,
      },
    ]);

    expect(validateHeightFields(fields)).toEqual({
      valid: false,
      missingIds: ['cam_D'],
      invalidIds: [],
      cameraHeightsM: {
        cam_A: 2.25,
        cam_B: 2.3,
        cam_C: 2.2,
      },
    });

    const filled = deriveHeightFields(cameraIds, defaultsResponse.camera_heights_m, {
      cam_D: '2.35',
    });
    expect(validateHeightFields(filled)).toEqual({
      valid: true,
      missingIds: [],
      invalidIds: [],
      cameraHeightsM: {
        cam_A: 2.25,
        cam_B: 2.3,
        cam_C: 2.2,
        cam_D: 2.35,
      },
    });
  });

  it(`0 이하이거나 ${MAX_CAMERA_HEIGHT_M}m 초과인 값은 거부한다`, () => {
    const fields = deriveHeightFields(
      DEFAULT_CAMERA_IDS,
      { cam_A: 2.2, cam_B: 2.2, cam_C: 2.2, cam_D: 2.2 },
      { cam_A: '0', cam_B: '25' },
    );
    expect(validateHeightFields(fields)).toEqual({
      valid: false,
      missingIds: [],
      invalidIds: ['cam_A', 'cam_B'],
      cameraHeightsM: {
        cam_C: 2.2,
        cam_D: 2.2,
      },
    });
  });

  it('높이 입력 도움말과 보조 유틸 함수를 유지한다', () => {
    expect(CAMERA_HEIGHT_HELP).toBe(
      '거치대 기둥을 늘 같은 길이로 펴고(테이프 표시 권장), 바꿨을 때만 다시 재세요',
    );
    expect(formatClock(80)).toBe('1:20');
  });
});

describe('설치 · 보정 2단계 이후: 대기 단계·진행률·높이 경고·Scene 단계·AI 초안 계산', () => {
  const baseSession: SetupSessionResponse = {
    setup_session_id: '019a0000-0000-7000-8000-000000000001',
    site_id: 'classroom-1',
    work_unit_id: 1,
    retry_of: null,
    job_id: 'job-setup-1',
    status: 'COLLECTING_BACKGROUND',
    stage: 'COLLECTING_BACKGROUND',
    progress_pct: 0,
    camera_heights_m: { cam_A: 2.25, cam_B: 2.3, cam_C: 2.2, cam_D: 2.35 },
    height_tolerance_cm: 5,
    background_collection_pct: { cam_A: 50, cam_B: 50, cam_C: 40, cam_D: 60 },
    height_checks: null,
    height_warnings: [],
    object_cross_checks: null,
    calibration_version: null,
    preview_scene_version: null,
    scene_version: null,
    config_version: null,
    zones_committed_at: null,
    zone_drafts_ref: null,
    failure_code: null,
    failure_message: null,
  };

  it('대기 5단계(배경 수집 → 3D 공간·좌표계 → 카메라 정밀 보정 → 미리보기 맵·구역 초안 → 정밀 3D 맵)와 목표 90초 기준 남은 시간을 계산한다', () => {
    expect(WAITING_STAGES.map((s) => s.label)).toEqual([
      '배경 수집',
      '3D 공간·좌표계',
      '카메라 정밀 보정',
      '미리보기 맵·구역 초안',
      '정밀 3D 맵',
    ]);
    expect(WAITING_STAGES.map((s) => [s.stage, s.from, s.to])).toEqual([
      ['COLLECTING_BACKGROUND', 0, 15],
      ['INITIAL_POSE_AND_WORLD', 15, 40],
      ['JOINT_BA_AND_VERIFY', 40, 65],
      ['PREVIEW_AND_VLM_DRAFT', 65, 85],
      ['BAKING_TEXTURE', 85, 100],
    ]);
    expect(SETUP_TARGET_DURATION_SEC).toBe(90);
    expect(estimateRemainingSeconds(0)).toBe(90);
    expect(estimateRemainingSeconds(50)).toBe(45);
    expect(estimateRemainingSeconds(100)).toBe(0);
    expect(estimateRemainingSeconds(50, 300)).toBe(300);
    expect(estimateRemainingSeconds(99, 300)).toBe(15);
    expect(estimateRemainingSeconds(100, 300)).toBe(0);
    expect(formatRemainingKorean(90)).toBe('약 1분 30초');
    expect(formatRemainingKorean(45)).toBe('약 45초');
    expect(formatRemainingKorean(0)).toBe('곧 완료');

    const view = deriveWaitingView({
      ...baseSession,
      status: 'JOINT_BA_AND_VERIFY',
      stage: 'JOINT_BA_AND_VERIFY',
      progress_pct: 60,
    });
    expect(view.progressPct).toBe(60);
    expect(view.remainingSec).toBe(36);
    expect(view.remainingClock).toBe('0:36');
    expect(view.failedStageIndex).toBeNull();
  });

  it('높이 불일치 경고(within_tolerance=false)와 미리보기/정밀 Scene 단계를 구분한다', () => {
    const warned = deriveHeightWarnings({
      ...baseSession,
      height_checks: {
        cam_A: {
          input_height_m: 2.25,
          restored_height_m: 2.24,
          difference_cm: 1.0,
          within_tolerance: true,
          guidance: null,
        },
        cam_B: {
          input_height_m: 2.3,
          restored_height_m: 2.15,
          difference_cm: 15.0,
          within_tolerance: false,
          guidance: 'cam_B 입력 높이(2.30m)와 복원 높이(2.15m)가 15.0cm 차이납니다',
        },
      },
    });
    expect(warned).toHaveLength(1);
    expect(warned[0]?.cameraId).toBe('cam_B');
    expect(warned[0]?.differenceCm).toBe(15.0);

    expect(isPreviewSceneReady(baseSession)).toBe(false);
    expect(deriveSceneTierStatus(baseSession).tier).toBe('NONE');

    const previewSession: SetupSessionResponse = {
      ...baseSession,
      status: 'BAKING_TEXTURE',
      stage: 'BAKING_TEXTURE',
      progress_pct: 85,
      preview_scene_version: 'scene-preview-1',
    };
    expect(isPreviewSceneReady(previewSession)).toBe(true);
    expect(deriveSceneTierStatus(previewSession)).toMatchObject({
      tier: 'PREVIEW',
      previewSceneVersion: 'scene-preview-1',
      finalSceneVersion: null,
      bakingTexture: true,
      label: '미리보기 맵',
    });

    const finalSession: SetupSessionResponse = {
      ...previewSession,
      status: 'COMPLETED',
      stage: 'COMPLETED',
      progress_pct: 100,
      scene_version: 'scene-final-1',
    };
    expect(deriveSceneTierStatus(finalSession)).toMatchObject({
      tier: 'FINAL',
      previewSceneVersion: 'scene-preview-1',
      finalSceneVersion: 'scene-final-1',
      bakingTexture: false,
      label: '정밀 3D 맵',
    });

    // 작업 시작으로 정밀 굽기를 회수하고 끝난 세팅(S15P31A101-597): COMPLETED 여도 미리보기 맵으로 보인다
    const skipped = setupSessionResponseSchema.parse({
      ...previewSession,
      status: 'COMPLETED',
      stage: 'COMPLETED',
      progress_pct: 100,
      scene_version: null,
      bake_skipped: 'LIVE_WORK_STARTED',
    });
    expect(deriveSceneTierStatus(skipped)).toMatchObject({
      tier: 'PREVIEW',
      previewSceneVersion: 'scene-preview-1',
      finalSceneVersion: null,
      bakingTexture: false,
      label: '미리보기 맵',
    });
    expect(deriveSceneTierStatus(skipped).description).toContain(
      '이 세팅으로는 완료할 수 없습니다',
    );
    // 모르는 값은 null 로 보고 기존 판정(정식 Scene 없는 COMPLETED)을 따른다
    expect(
      setupSessionResponseSchema.parse({ ...previewSession, bake_skipped: 'SOMETHING_NEW' })
        .bake_skipped,
    ).toBeNull();
  });

  it('3D 맵이 다 만들어진 때(isSceneMapComplete)는 새 모델이면 정밀 3D 맵까지 끝난 세팅이다(-688: 굽기를 회수한 세팅은 아니다)', () => {
    const previewOnly: SetupSessionResponse = {
      ...baseSession,
      status: 'READY_FOR_ZONES',
      stage: 'READY_FOR_ZONES',
      progress_pct: 85,
      preview_scene_version: 'scene-preview-1',
    };
    expect(isSceneMapComplete(null)).toBe(false);
    expect(isSceneMapComplete(baseSession)).toBe(false);
    expect(isSceneMapComplete(previewOnly)).toBe(false);
    expect(
      isSceneMapComplete({ ...previewOnly, status: 'BAKING_TEXTURE', stage: 'BAKING_TEXTURE' }),
    ).toBe(false);

    expect(
      isSceneMapComplete({
        ...previewOnly,
        status: 'COMPLETED',
        stage: 'COMPLETED',
        progress_pct: 100,
        scene_version: 'scene-final-1',
      }),
    ).toBe(true);
    // 정밀 맵 없이 끝난 새 모델(회수)은 맵이 다 만들어지지 않았다. 서버도 완료를 거부한다(SETUP_FINAL_MAP_SKIPPED)
    expect(
      isSceneMapComplete({
        ...previewOnly,
        status: 'COMPLETED',
        stage: 'COMPLETED',
        progress_pct: 100,
        bake_skipped: 'LIVE_WORK_STARTED',
      }),
    ).toBe(false);
    // 이전 맵 재사용은 기존 맵 맞추기가 채택된 미리보기 단계 이후면 맵 조건을 채운다
    const reuse: SetupSessionResponse = {
      ...previewOnly,
      mode: 'REUSE',
      preview_scene_version: null,
    };
    expect(isSceneMapComplete(reuse)).toBe(false);
    expect(isSceneMapComplete({ ...reuse, world_anchor: { accepted: true } })).toBe(true);
    expect(
      isSceneMapComplete({
        ...reuse,
        status: 'JOINT_BA_AND_VERIFY',
        stage: 'JOINT_BA_AND_VERIFY',
        world_anchor: { accepted: true },
      }),
    ).toBe(false);
    // 실패한 세션은 정식 Scene 이 있어도 구역 단계로 넘기지 않는다
    expect(
      isSceneMapComplete({ ...previewOnly, status: 'FAILED', scene_version: 'scene-final-1' }),
    ).toBe(false);
  });

  it('대기 화면 요약(deriveWaitingView)의 mapComplete 는 미리보기 맵과 달리 정밀 3D 맵이 끝나야 켜진다', () => {
    const previewOnly: SetupSessionResponse = {
      ...baseSession,
      status: 'BAKING_TEXTURE',
      stage: 'BAKING_TEXTURE',
      progress_pct: 85,
      preview_scene_version: 'scene-preview-1',
    };
    expect(deriveWaitingView(previewOnly)).toMatchObject({
      previewReady: true,
      mapComplete: false,
    });
    expect(
      deriveWaitingView({
        ...previewOnly,
        status: 'COMPLETED',
        stage: 'COMPLETED',
        progress_pct: 100,
        scene_version: 'scene-final-1',
      }),
    ).toMatchObject({ previewReady: true, mapComplete: true });
    expect(deriveWaitingView(null)).toMatchObject({ previewReady: false, mapComplete: false });
  });

  it('VLM 구역 초안 응답 스키마(no_opinion 포함)를 검증하고 편집 상자(BoxBounds)로 변환한다', () => {
    const built = buildSetupZoneDraftsResponse('019a0000-0000-7000-8000-000000000001');
    const parsed = setupZoneDraftsResponseSchema.parse(built);
    expect(parsed.safety_use).toBe(false);
    expect(parsed.drafts).toHaveLength(2);
    expect(parsed.drafts[0]?.no_opinion).toBe(false);
    expect(parsed.drafts[1]?.vlm_status).toBe('NO_OPINION');
    expect(parsed.drafts[1]?.no_opinion).toBe(true);

    const box = boxOfDraftItem(parsed.drafts[0]!);
    expect(box).toEqual({
      min: [7.0, 8.0, 0],
      max: [8.6, 8.8, 2.0],
    });
  });

  it('수락·버리기 전 AI 초안만 3D 점선 윤곽(편집 초안과 겹치지 않는 id)으로 바꾼다', () => {
    const { drafts } = setupZoneDraftsResponseSchema.parse(
      buildSetupZoneDraftsResponse('019a0000-0000-7000-8000-000000000001'),
    );
    const [first, second] = drafts;
    expect(draftGhostsOf(drafts, [], [])).toEqual([
      { id: `ai-draft:${first!.candidate_id}`, box: boxOfDraftItem(first!) },
      { id: `ai-draft:${second!.candidate_id}`, box: boxOfDraftItem(second!) },
    ]);
    expect(draftGhostsOf(drafts, [first!.candidate_id], [])).toHaveLength(1);
    expect(draftGhostsOf(drafts, [first!.candidate_id], [second!.candidate_id])).toEqual([]);
  });

  it('구역 단계 3D 칸 제목은 세팅 맵 단계 이름뿐이고(Scene 버전은 붙이지 않는다), 세팅 맵이 아직이면 3D 맵이다', () => {
    expect(zoneMapTitle(deriveSceneTierStatus(baseSession))).toBe('3D 맵');
    const preview: SetupSessionResponse = {
      ...baseSession,
      status: 'READY_FOR_ZONES',
      stage: 'READY_FOR_ZONES',
      preview_scene_version: 'scene-preview-1',
    };
    expect(zoneMapTitle(deriveSceneTierStatus(preview))).toBe('미리보기 맵');
    const final: SetupSessionResponse = {
      ...preview,
      status: 'COMPLETED',
      stage: 'COMPLETED',
      scene_version: 'scene-final-1',
    };
    expect(zoneMapTitle(deriveSceneTierStatus(final))).toBe('정밀 3D 맵');
  });
});

describe('세팅 대기 이유 안내(S15P31A101-583)', () => {
  const reason = (over: Record<string, unknown>) =>
    setupWaitReasonSchema.parse({ code: 'WAITING_FOR_WORKER', since_ms: 1_000, ...over });

  it('없으면 null 이고, 실패한 세션에는 대기 이유를 보이지 않는다', () => {
    expect(deriveWaitReasonView(null)).toBeNull();
    expect(deriveWaitReasonView(undefined)).toBeNull();
    const session = setupSessionResponseSchema.parse({
      setup_session_id: 's1',
      site_id: 'classroom-1',
      work_unit_id: 1,
      status: 'FAILED',
      progress_pct: 0,
      camera_heights_m: { cam_A: 2.4 },
      wait_reason: { code: 'WORKER_NOT_POLLING', since_ms: 1 },
    });
    expect(deriveWaitingView(session).waitReason).toBeNull();
    expect(
      deriveWaitingView({ ...session, status: 'COLLECTING_BACKGROUND' }).waitReason?.code,
    ).toBe('WORKER_NOT_POLLING');
  });

  it('Tier 0 우선 접수 중지는 근거(워커 알림/기록 추정)와 참고 지연을 덧붙인다', () => {
    const released = deriveWaitReasonView(
      reason({
        code: 'WORKER_PAUSED_TIER0',
        basis: 'WORKER_RELEASE',
        detail: 'Tier 0 우선으로 시작하지 않았다: 표시 파일이 120s 전 것이다',
        tier0_lag_ms: 1450.4,
      }),
    )!;
    expect(released.title).toBe('GPU 서버가 관제를 먼저 처리하느라 세팅 시작을 기다리고 있습니다');
    expect(released.notes).toEqual([
      'GPU 서버가 알려 옴: Tier 0 우선으로 시작하지 않았다: 표시 파일이 120s 전 것이다',
      '참고: 최근 관제 지연 1450 ms',
    ]);
    expect(released.hint).toContain('GPU 서버 상태를 확인');
    expect(released.tone).toBe('delay');

    const inferred = deriveWaitReasonView(
      reason({ code: 'WORKER_PAUSED_TIER0', basis: 'TIER0_HEALTH' }),
    )!;
    expect(inferred.notes).toEqual(['관제 지연을 알 수 없다는 기록으로 추정']);
  });

  it('배경 미완료는 덜 모인 카메라와 비켜 달라는 안내를, 재시도는 앞 실패를 보인다', () => {
    const bg = deriveWaitReasonView(
      reason({
        code: 'BACKGROUND_INCOMPLETE',
        cameras: [{ camera_id: 'cam_C', collection_pct: 15.4 }],
      }),
    )!;
    expect(bg.title).toBe('사람 없는 배경을 아직 다 모으지 못했습니다 (카메라 15%)');
    expect(bg.hint).toBe('사람이 카메라 앞에서 잠시 비켜 주세요.');

    const retry = deriveWaitReasonView(reason({ previous_error_code: 'BACKGROUND_INCOMPLETE' }))!;
    expect(retry.tone).toBe('idle');
    expect(retry.notes[0]).toContain('앞 시도에서 배경을 다 모으지 못해');
    const other = deriveWaitReasonView(reason({ previous_error_code: 'BA_DIVERGED' }))!;
    expect(other.notes).toEqual(['앞 시도가 실패(BA_DIVERGED)해 다시 시도합니다.']);
  });

  it.each([
    ['NO_WORKER', 'GPU 서버(분석 워커)가 연결돼 있지 않습니다', 'delay'],
    ['WAITING_FOR_WORKER', 'GPU 서버가 세팅 작업을 가져가기를 기다리고 있습니다', 'idle'],
    ['WORKER_NOT_POLLING', 'GPU 서버가 세팅 작업을 가져가지 않고 있습니다', 'delay'],
    ['WORKER_STARTING', 'GPU 서버가 세팅 작업을 받아 시작을 준비하고 있습니다', 'idle'],
    ['SOMETHING_NEW', '세팅이 기다리는 중입니다 (SOMETHING_NEW)', 'idle'],
  ])('%s 는 짧은 안내와 할 일을 준다', (code, title, tone) => {
    const view = deriveWaitReasonView(reason({ code }))!;
    expect(view.title).toBe(title);
    expect(view.tone).toBe(tone);
    expect(view.hint.length).toBeGreaterThan(0);
    expect(view.showLastSeen).toBe(code === 'WORKER_NOT_POLLING');
  });

  it('다른 작업 처리 중이면 그 작업을 쉬운 이름으로 보인다', () => {
    expect(
      deriveWaitReasonView(
        reason({ code: 'WORKER_BUSY_OTHER_JOB', other_job_type: 'scene_regenerate' }),
      )!.title,
    ).toBe('GPU 서버가 다른 작업(3D 맵 다시 만들기)을 먼저 처리하고 있습니다');
    expect(formatMinSec(125)).toBe('2분 05초');
  });
});

describe('setupErrorMessage: 진행 중 작업 409 안내 매핑', () => {
  it('SETUP_BLOCKED_BY_LIVE_WORK(409)에 작업 이름이 없으면 일반 안내 문구를 돌려준다', () => {
    const error = new ApiError(409, {
      code: 'SETUP_BLOCKED_BY_LIVE_WORK',
      serverMessage:
        '같은 현장에 진행 중(IN_PROGRESS)인 작업이 있어 현장 세팅을 시작할 수 없습니다',
    });
    expect(isSetupBlockedByLiveWork(error)).toBe(true);
    expect(blockedLiveWorkId(error)).toBeNull();
    expect(setupErrorMessage(error)).toBe(SETUP_LIVE_WORK_BLOCKED_TEXT);
  });

  it('SETUP_BLOCKED_BY_LIVE_WORK(409)에 작업 이름·ID가 있으면 이름 포함 문구와 작업 ID를 돌려준다', () => {
    const error = new ApiError(409, {
      code: 'SETUP_BLOCKED_BY_LIVE_WORK',
      workId: 2,
      workName: '배관 점검',
      serverMessage:
        '같은 현장에 진행 중(IN_PROGRESS)인 작업이 있어 현장 세팅을 시작할 수 없습니다',
    });
    expect(isSetupBlockedByLiveWork(error)).toBe(true);
    expect(blockedLiveWorkId(error)).toBe(2);
    expect(setupErrorMessage(error)).toBe(
      '진행 중인 작업(배관 점검)이 있어 세팅을 시작할 수 없습니다. 작업을 종료한 뒤 다시 시도하세요',
    );
  });

  it('다른 409(SETUP_ALREADY_IN_PROGRESS)는 진행 중 작업 차단으로 보지 않고 서버 문구를 유지한다', () => {
    const error = new ApiError(409, {
      code: 'SETUP_ALREADY_IN_PROGRESS',
      serverMessage: '이미 진행 중인 현장 세팅 세션이 있습니다',
    });
    expect(isSetupBlockedByLiveWork(error)).toBe(false);
    expect(setupErrorMessage(error)).toBe('이미 진행 중인 현장 세팅 세션이 있습니다');
  });

  it('SETUP_WORKER_UNAVAILABLE(409)는 진행 중 작업 차단이 아니라 GPU 서버 연결 안내를 돌려준다', () => {
    const error = new ApiError(409, {
      code: 'SETUP_WORKER_UNAVAILABLE',
      serverMessage: '현장 세팅(site_setup)을 처리할 활성 워커가 없습니다',
    });
    expect(isSetupBlockedByLiveWork(error)).toBe(false);
    expect(blockedLiveWorkId(error)).toBeNull();
    expect(setupErrorMessage(error)).toBe(SETUP_WORKER_UNAVAILABLE_TEXT);
  });

  it.each([
    [
      'SETUP_CAMERAS_INSUFFICIENT',
      '현장에 활성 카메라가 2대 이상 있어야 세팅을 시작할 수 있습니다',
    ],
    ['WORK_NOT_TODAY', '작업 날짜가 오늘(Asia/Seoul)일 때만 할 수 있습니다'],
    ['WORK_INVALID_STATE', '현재 작업 상태에서는 요청한 전이를 수행할 수 없습니다'],
    [undefined, '서버가 코드 없이 준 409 문구'],
  ])('%s(409)도 진행 중 작업 차단으로 보지 않고 서버 문구를 유지한다', (code, serverMessage) => {
    const error = new ApiError(409, { code, serverMessage });
    expect(isSetupBlockedByLiveWork(error)).toBe(false);
    expect(setupErrorMessage(error)).toBe(serverMessage);
  });
});

describe('보정·생성 실패 단계(마지막 서버 진행률로 추정)', () => {
  const session = (over: Record<string, unknown>) =>
    setupSessionResponseSchema.parse({
      setup_session_id: 's1',
      site_id: 'classroom-1',
      work_unit_id: 1,
      status: 'FAILED',
      stage: 'FAILED',
      progress_pct: 0,
      camera_heights_m: { cam_A: 2.4, cam_B: 2.4 },
      ...over,
    });

  it.each([
    [0, 0],
    [14, 0],
    [15, 1],
    [39, 1],
    [40, 2],
    [64, 2],
    [65, 3],
    [84, 3],
    [85, 4],
    [100, 4],
  ])(
    '서버가 stage 를 FAILED 로 덮으면 진행률 %i%% 는 %i번째 단계에서 실패한 것이다',
    (pct, index) => {
      const view = deriveWaitingView(session({ progress_pct: pct }));
      expect(view.failed).toBe(true);
      expect(view.failedStageIndex).toBe(index);
    },
  );

  it('stage 가 FAILED 로 덮이지 않았으면 그 stage 가 실패 단계이고, 실패가 아니면 실패 단계가 없다', () => {
    expect(
      deriveWaitingView(session({ stage: 'BAKING_TEXTURE', progress_pct: 10 })).failedStageIndex,
    ).toBe(4);
    expect(
      deriveWaitingView(
        session({ status: 'JOINT_BA_AND_VERIFY', stage: 'JOINT_BA_AND_VERIFY', progress_pct: 50 }),
      ).failedStageIndex,
    ).toBeNull();
  });
});

describe('보정·생성 5단계 막대 표시(deriveStageRows)', () => {
  const summary = (shown: number, failed: number | null = null) =>
    deriveStageRows(shown, failed).map((r) => `${r.status}:${r.stagePct}`);

  it('끝난 단계는 완료, 지금 단계는 구간 안 비율, 남은 단계는 대기다', () => {
    expect(summary(0)).toEqual([
      'current:0',
      'upcoming:0',
      'upcoming:0',
      'upcoming:0',
      'upcoming:0',
    ]);
    // 배경 수집 7.5/15 = 50%
    expect(summary(7.5)[0]).toBe('current:50');
    // 3D 공간·좌표계 구간(15~40)의 절반
    expect(summary(27.5)).toEqual([
      'done:100',
      'current:50',
      'upcoming:0',
      'upcoming:0',
      'upcoming:0',
    ]);
  });

  it('구간 경계에서는 앞 단계가 완료되고 다음 단계가 0% 에서 시작한다', () => {
    expect(summary(15).slice(0, 2)).toEqual(['done:100', 'current:0']);
    expect(summary(85).slice(3, 5)).toEqual(['done:100', 'current:0']);
    expect(summary(100)).toEqual(['done:100', 'done:100', 'done:100', 'done:100', 'done:100']);
  });

  it('실패한 단계는 실패, 앞 단계는 완료, 뒤 단계는 대기이고 실패 단계 막대는 멈춘 곳까지 찬다', () => {
    expect(summary(52, 2)).toEqual([
      'done:100',
      'done:100',
      'failed:48',
      'upcoming:0',
      'upcoming:0',
    ]);
    expect(summary(0, 0)[0]).toBe('failed:0');
  });
});

describe('보정 검증 결과·높이 안내 표시 시점', () => {
  const check = (over: Record<string, unknown> = {}) => ({
    input_height_m: 2.25,
    restored_height_m: 2.26,
    difference_cm: 1,
    within_tolerance: true,
    guidance: null,
    ...over,
  });
  const session = (over: Record<string, unknown> = {}) =>
    setupSessionResponseSchema.parse({
      setup_session_id: 's1',
      site_id: 'classroom-1',
      work_unit_id: 1,
      status: 'JOINT_BA_AND_VERIFY',
      stage: 'JOINT_BA_AND_VERIFY',
      progress_pct: 50,
      camera_heights_m: { cam_A: 2.25, cam_B: 2.3 },
      height_tolerance_cm: 5,
      height_checks: {
        cam_A: check(),
        cam_B: check({
          input_height_m: 2.3,
          restored_height_m: null,
          difference_cm: null,
          within_tolerance: false,
        }),
      },
      ...over,
    });

  it('세션의 height_checks 를 서버 판정 그대로 행으로 바꾸고 없으면 빈 배열이다', () => {
    expect(deriveHeightCheckRows(session())).toEqual([
      {
        cameraId: 'cam_A',
        inputHeightM: 2.25,
        restoredHeightM: 2.26,
        differenceCm: 1,
        withinTolerance: true,
      },
      {
        cameraId: 'cam_B',
        inputHeightM: 2.3,
        restoredHeightM: null,
        differenceCm: null,
        withinTolerance: false,
      },
    ]);
    expect(deriveHeightCheckRows(session({ height_checks: null }))).toEqual([]);
    expect(deriveHeightCheckRows(null)).toEqual([]);
  });

  it('허용 오차 안에 있어도 서버가 안 맞다고 하면 안 맞는 행이다(허용값으로 다시 계산하지 않는다)', () => {
    const rows = deriveHeightCheckRows(
      session({
        height_checks: { cam_A: check({ difference_cm: 0.5, within_tolerance: false }) },
      }),
    );
    expect(rows[0]!.withinTolerance).toBe(false);
  });

  it('카메라 id 와 허용 오차는 세션에서 읽는다', () => {
    const view = deriveWaitingView(session());
    expect(view.cameraIds).toEqual(['cam_A', 'cam_B']);
    expect(view.heightToleranceCm).toBe(5);
    expect(
      deriveWaitingView(session({ height_tolerance_cm: undefined })).heightToleranceCm,
    ).toBeNull();
  });

  it('높이 불일치 안내는 서버가 높이를 확인한 뒤(40%~)나 미리보기 맵이 준비된 뒤에만, 실패가 아닐 때 보인다', () => {
    const mismatch = { cam_B: check({ within_tolerance: false, difference_cm: 41 }) };
    const noticeAt = (over: Record<string, unknown>) =>
      deriveWaitingView(session({ height_checks: mismatch, ...over })).showHeightNotice;
    expect(noticeAt({ progress_pct: 39 })).toBe(false);
    expect(noticeAt({ progress_pct: 40 })).toBe(true);
    expect(noticeAt({ progress_pct: 20, preview_scene_version: 'scene-preview-1' })).toBe(true);
    expect(noticeAt({ progress_pct: 70, status: 'FAILED', stage: 'FAILED' })).toBe(false);
    expect(
      deriveWaitingView(session({ height_checks: { cam_A: check() }, progress_pct: 70 }))
        .showHeightNotice,
    ).toBe(false);
  });
});

describe('세팅 세션의 Scene 버전', () => {
  const tier = (preview: string | null, final: string | null = null) =>
    deriveSceneTierStatus(
      setupSessionResponseSchema.parse({
        setup_session_id: 's1',
        site_id: 'classroom-1',
        work_unit_id: 1,
        status: final ? 'COMPLETED' : 'BAKING_TEXTURE',
        stage: final ? 'COMPLETED' : 'BAKING_TEXTURE',
        progress_pct: 90,
        camera_heights_m: { cam_A: 2.4 },
        preview_scene_version: preview,
        scene_version: final,
      }),
    );

  it('미리보기 맵이면 미리보기 버전이고, 정밀 3D 맵으로 바뀐 뒤에는 정밀 버전이다', () => {
    expect(sessionSceneVersion(tier('scene-preview-1'))).toBe('scene-preview-1');
    expect(sessionSceneVersion(tier('scene-preview-1', 'scene-final-1'))).toBe('scene-final-1');
  });

  it('맵이 아직 없으면 null 이다', () => {
    expect(sessionSceneVersion(tier(null))).toBeNull();
    expect(sessionSceneVersion(deriveSceneTierStatus(null))).toBeNull();
  });
});

describe('setupErrorMessage: 진행 중 작업 때문이 아닌 409', () => {
  it.each([
    'SETUP_RETRY_NOT_ALLOWED',
    'SETUP_CANCEL_NOT_ALLOWED',
    'WORK_NOT_TODAY',
    'WORK_INVALID_STATE',
    'SETUP_CAMERAS_INSUFFICIENT',
  ])('%s(409)는 진행 중 작업 차단으로 보지 않고 서버 문구를 유지한다', (code) => {
    const error = new ApiError(409, { code, serverMessage: '지금은 할 수 없는 상태입니다' });
    expect(isSetupBlockedByLiveWork(error)).toBe(false);
    expect(setupErrorMessage(error)).toBe('지금은 할 수 없는 상태입니다');
  });
});

describe('setupCancelErrorMessage: 세팅 취소 실패 안내', () => {
  it('알 수 없는 4xx 는 서버 문구를 그대로 보인다', () => {
    const error = new ApiError(409, {
      code: 'SETUP_CANCEL_NOT_ALLOWED',
      serverMessage: '이미 끝난 세팅 세션은 취소할 수 없습니다',
    });
    expect(setupCancelErrorMessage(error)).toBe('이미 끝난 세팅 세션은 취소할 수 없습니다');
  });

  it('서버 문구가 없거나 4xx 가 아니면 취소 실패 기본 문구를 보인다(세팅 시작 문구가 아니다)', () => {
    const fallback = '세팅을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요';
    expect(setupCancelErrorMessage(new ApiError(500, { serverMessage: '내부 오류' }))).toBe(
      fallback,
    );
    expect(setupCancelErrorMessage(new ApiError(404))).toBe(fallback);
    expect(setupCancelErrorMessage(new Error('x'))).toBe(fallback);
  });
});
