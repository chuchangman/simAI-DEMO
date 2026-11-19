import {
  cameraBadgeOf,
  coverageFreshUntil,
  coverageHelperLost,
  HELPER_LOST_AFTER_MS,
  type CameraBadgeEvidence,
} from '@/features/setup/cameraBadge';
import { deriveStep1Coverage } from '@/features/setup/setup';
import type { CoverageGuidesResponse } from '@/features/setup/types';
import { buildCoverageGuidePayload } from '@/mocks/setup';
import { describe, expect, it } from 'vitest';

// 카메라 칸 배지 하나(S15P31A101-691): 연결 끊김 → 직전 보정과 달라짐 → 겹침 부족 → 각도 확인 필요 → 준비됨, 근거가 없거나 오래되면 확인 중.

const ALL_GOOD: CameraBadgeEvidence = {
  status: 'OK',
  fresh: true,
  judged: true,
  changed: false,
  lowOverlap: false,
  hasGuide: false,
};

describe('cameraBadgeOf 우선순위', () => {
  it.each<[string, Partial<CameraBadgeEvidence>, string]>([
    ['모두 좋음', {}, 'READY'],
    ['각도 안내만', { hasGuide: true }, 'ANGLE'],
    ['겹침 부족 + 각도 안내', { lowOverlap: true, hasGuide: true }, 'LOW_OVERLAP'],
    ['달라짐 + 겹침 부족 + 각도', { changed: true, lowOverlap: true, hasGuide: true }, 'CHANGED'],
    [
      '영상 없음 + 달라짐 + 겹침 + 각도',
      { status: 'NO_VIDEO', changed: true, lowOverlap: true, hasGuide: true },
      'DISCONNECTED',
    ],
    ['끊김(STALE)', { status: 'STALE' }, 'DISCONNECTED'],
    ['근거 없음(카메라 항목 없음)', { status: null, hasGuide: true }, 'CHECKING'],
    [
      '오래된 결과의 영상 없음은 모른다',
      { status: 'NO_VIDEO', fresh: false, judged: false },
      'CHECKING',
    ],
    [
      '오래된 결과라도 달라짐은 따로 받은 근거라 보인다',
      { fresh: false, judged: false, changed: true },
      'CHANGED',
    ],
    [
      '연결 판정 계산 실패(UNKNOWN)면 각도·겹침은 모른다',
      { judged: false, hasGuide: true, lowOverlap: true },
      'CHECKING',
    ],
    [
      '연결 판정 계산 실패여도 영상 없음은 지금 결과라 끊김',
      { status: 'NO_VIDEO', judged: false },
      'DISCONNECTED',
    ],
  ])('%s → %s', (_, patch, kind) => {
    expect(cameraBadgeOf({ ...ALL_GOOD, ...patch }).kind).toBe(kind);
  });

  it('배지 글은 하나이고 정상이라는 말은 없다', () => {
    expect(cameraBadgeOf(ALL_GOOD)).toEqual({ kind: 'READY', label: '준비됨', tone: 'ok' });
    expect(cameraBadgeOf({ ...ALL_GOOD, status: null }).label).toBe('확인 중');
  });
});

describe('각도 안내가 오래되는 때(coverageFreshUntil)', () => {
  it('받은 시각 + 서버 기준 − 받을 때의 나이, 기준을 모르면 10초', () => {
    expect(coverageFreshUntil(100_000, 3_000, 10_000)).toBe(107_000);
    expect(coverageFreshUntil(100_000, null, undefined)).toBe(110_000);
    expect(coverageFreshUntil(100_000, -5, 10_000)).toBe(110_000);
  });
});

describe('deriveStep1Coverage 의 카메라 배지(상태 조합)', () => {
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
  const response = (latest: ReturnType<typeof buildCoverageGuidePayload> | null) =>
    ({
      calibration_version: null,
      guides: [],
      site_id: 'classroom-1',
      status: latest ? 'OK' : 'EMPTY',
      stale: false,
      received_at_ms: 100,
      age_ms: 0,
      latest,
    }) satisfies CoverageGuidesResponse;
  const badges = (view: ReturnType<typeof deriveStep1Coverage>) =>
    Object.fromEntries(view.cameras.map((c) => [c.id, c.badge.kind]));

  // 15차 모순: 카메라 1 은 영상이 오는데(OK) "왼쪽으로 더 돌려 주세요" 안내가 있었다 → 「정상」이 아니라 각도 확인 필요
  const mixed = buildCoverageGuidePayload({
    connectivity: 'DISCONNECTED',
    cameraStatuses: { cam_D: 'NO_VIDEO' },
    pairs: [
      pair('cam_A', 'cam_B', 'ENOUGH'),
      pair('cam_B', 'cam_C', 'LACK'),
      pair('cam_C', 'cam_D', 'ENOUGH'),
      pair('cam_A', 'cam_D', 'ENOUGH'),
    ],
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

  it('카메라마다 우선순위대로 하나: 끊김·겹침 부족·각도 확인 필요, 달라진 카메라는 겹침보다 앞', () => {
    expect(badges(deriveStep1Coverage(response(mixed)))).toEqual({
      cam_A: 'ANGLE',
      cam_B: 'LOW_OVERLAP',
      cam_C: 'LOW_OVERLAP',
      cam_D: 'DISCONNECTED',
    });
    expect(
      badges(
        deriveStep1Coverage(response(mixed), false, undefined, {
          changedCameras: ['cam_C', 'cam_D'],
        }),
      ),
    ).toEqual({ cam_A: 'ANGLE', cam_B: 'LOW_OVERLAP', cam_C: 'CHANGED', cam_D: 'DISCONNECTED' });
  });

  it('응답이 없거나·조회 실패·서버 stale·브라우저에서 오래됨이면 모두 확인 중(달라진 카메라만 보인다)', () => {
    const allChecking = {
      cam_A: 'CHECKING',
      cam_B: 'CHECKING',
      cam_C: 'CHECKING',
      cam_D: 'CHECKING',
    };
    expect(badges(deriveStep1Coverage(undefined))).toEqual(allChecking);
    expect(badges(deriveStep1Coverage(response(null)))).toEqual(allChecking);
    expect(badges(deriveStep1Coverage(response(mixed), true))).toEqual(allChecking);
    expect(badges(deriveStep1Coverage({ ...response(mixed), stale: true }))).toEqual(allChecking);
    expect(
      badges(deriveStep1Coverage(response(mixed), false, undefined, { expired: true })),
    ).toEqual(allChecking);
    expect(
      badges(
        deriveStep1Coverage(response(mixed), false, undefined, {
          expired: true,
          changedCameras: ['cam_B'],
        }),
      ),
    ).toEqual({ ...allChecking, cam_B: 'CHANGED' });
    expect(deriveStep1Coverage(response(mixed), false, undefined, { expired: true }).fresh).toBe(
      false,
    );
  });

  it('응답에 없는 카메라는 정상으로 미루지 않고 확인 중이다', () => {
    const view = deriveStep1Coverage(
      response(buildCoverageGuidePayload({ guides: [], cameraIds: ['cam_A', 'cam_B', 'cam_C'] })),
      false,
    );
    // 응답의 카메라 순서가 목록이 되므로 빠진 카메라는 칸이 없다. 목록은 높이 기본값 순서로 주고 응답에는 3대만 있을 때를 본다
    const listed = deriveStep1Coverage(
      {
        ...response(buildCoverageGuidePayload({ guides: [] })),
        latest: {
          ...buildCoverageGuidePayload({ guides: [] }),
          cameras: [],
        },
      },
      false,
      ['cam_A', 'cam_B', 'cam_C', 'cam_D'],
    );
    expect(view.cameras).toHaveLength(3);
    expect(listed.cameras.map((c) => c.badge.kind)).toEqual([
      'CHECKING',
      'CHECKING',
      'CHECKING',
      'CHECKING',
    ]);
    expect(listed.cameras.every((c) => c.status === null && c.statusLabel === '확인 중')).toBe(
      true,
    );
  });

  it('모두 좋으면 준비됨', () => {
    expect(
      Object.values(
        badges(deriveStep1Coverage(response(buildCoverageGuidePayload({ guides: [] })))),
      ),
    ).toEqual(['READY', 'READY', 'READY', 'READY']);
  });
});

describe('게이트웨이 헬퍼 끊김(S15P31A101-719)', () => {
  it('지금 결과가 없고 헬퍼가 끊겼으면 「확인 중」 대신 「확인 못 함」이고, 직전 보정과 달라짐이 먼저다', () => {
    const stale = { ...ALL_GOOD, fresh: false, judged: false };
    expect(cameraBadgeOf({ ...stale, helperLost: true }).label).toBe('확인 못 함');
    expect(cameraBadgeOf({ ...stale, helperLost: false }).label).toBe('확인 중');
    expect(cameraBadgeOf({ ...stale, helperLost: true, changed: true }).kind).toBe('CHANGED');
    // 지금 결과가 있으면 헬퍼 끊김 표시는 쓰지 않는다
    expect(cameraBadgeOf({ ...ALL_GOOD, helperLost: true }).kind).toBe('READY');
  });

  it('마지막 헬퍼 결과 나이가 60초를 넘으면 끊김, 결과를 한 번도 못 받았으면 첫 빈 응답부터 잰다', () => {
    expect(coverageHelperLost({ age_ms: HELPER_LOST_AFTER_MS - 1 }, 1_000, null)).toBe(false);
    expect(coverageHelperLost({ age_ms: HELPER_LOST_AFTER_MS }, 1_000, null)).toBe(true);
    expect(coverageHelperLost({ age_ms: null }, 50_000, 1)).toBe(false);
    expect(coverageHelperLost({ age_ms: null }, 70_000, 5_000)).toBe(true);
    expect(coverageHelperLost({ age_ms: null }, 70_000, null)).toBe(false);
    expect(coverageHelperLost(undefined, 70_000, 1)).toBe(false);
  });

  it('deriveStep1Coverage: 오래된 결과 + 헬퍼 끊김이면 카메라마다 「확인 못 함」과 helperLost', () => {
    const response: CoverageGuidesResponse = {
      calibration_version: null,
      guides: [],
      status: 'STALE',
      stale: true,
      received_at_ms: 1,
      age_ms: 90_000,
      latest: buildCoverageGuidePayload({ guides: [] }),
    };
    const view = deriveStep1Coverage(response, false, undefined, { helperLost: true });
    expect(view.helperLost).toBe(true);
    expect(view.cameras.every((c) => c.badge.kind === 'NO_HELPER')).toBe(true);
    expect(deriveStep1Coverage(response).helperLost).toBe(false);
  });
});
