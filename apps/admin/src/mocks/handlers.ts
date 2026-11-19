import type { ReuseCheck } from '@/features/setup/types';
import { type MockAccount, MOCK_ACCOUNTS } from '@/mocks/accounts';
import { DEMO_FLOW } from '@/mocks/demoFlow';
import { createFloorPlanMock } from '@/mocks/floorPlan';
import { createGpuMock } from '@/mocks/gpu';
import { createHistoryMock } from '@/mocks/history';
import { createRecordingVideoMock } from '@/mocks/recordings';
import { sceneHandlers } from '@/mocks/scenes';
import { buildCoverageGuidePayload, createSetupMock } from '@/mocks/setup';
import { createStaticObjectsMock } from '@/mocks/staticObjects';
import { createTbmMock } from '@/mocks/tbm';
import { createWorkMock } from '@/mocks/work';
import { http, HttpResponse } from 'msw/http';

function readCredentials(body: unknown) {
  if (typeof body !== 'object' || body === null) return undefined;
  if (!('username' in body) || !('password' in body)) return undefined;
  const { username, password } = body;
  if (typeof username !== 'string' || typeof password !== 'string') return undefined;
  return { username, password };
}

// 서버 갱신 쿠키(simai_refresh, 14일) 흉내. 브라우저의 msw 는 응답 쿠키를 저장했다가 credentials: 'include' 요청의
// cookies 로 넘긴다(새로고침해도 남는다). 값은 계정 id 다.
const REFRESH_COOKIE = 'simai_refresh';
const REFRESH_MAX_AGE_S = 14 * 24 * 60 * 60;
const refreshCookie = (value: string, maxAge: number) =>
  `${REFRESH_COOKIE}=${value}; Path=/api/auth; SameSite=Strict; Max-Age=${maxAge}`;

// 발급마다 다른 토큰을 준다. 갱신한 토큰이 이전과 같으면 401 뒤 다시 보내기를 하지 않는다(lib/http).
let issued = 0;
const signedIn = (account: MockAccount) =>
  HttpResponse.json(
    {
      accessToken: `mock-token.${account.id}.${++issued}`,
      user: { id: account.id, role: account.role },
    },
    { headers: { 'Set-Cookie': refreshCookie(account.id, REFRESH_MAX_AGE_S) } },
  );

// simAI-DEMO: 시연 계정 「새 맵 만들기」가 재사용으로 시작할 때 고르는 준비된 맵(카메라 4대 MATCH)
const DEMO_REUSE_CHECK: ReuseCheck = {
  available: true,
  blocked_reason: null,
  scene_version: 'scene-prev-1',
  camera_status: 'UNKNOWN',
  changed_cameras: [],
  camera_source: null,
  recommended_setup_session_id: 'prev-1',
  candidates: [
    {
      setup_session_id: 'prev-1',
      scene_version: 'scene-prev-1',
      calibration_version: 'cal-prev-1',
      completed_at_ms: Date.UTC(2026, 10, 16, 4, 31),
      camera_heights_m: { cam_A: 2.7, cam_B: 2.7, cam_C: 2.7, cam_D: 2.7 },
      status: 'MATCH',
      reason: null,
      selectable: true,
      recommended: true,
      changed_cameras: [],
      shifted_cameras: [],
      unconfirmed_cameras: [],
      camera_source: null,
    },
  ],
};

// simAI-DEMO: 카메라 4대 모두 영상 수신·각도 양호, 옆 카메라 겹침 모두 충분(각도 안내 없음)
const DEMO_COVERAGE_GUIDE = buildCoverageGuidePayload({
  guides: [],
  pairs: buildCoverageGuidePayload().pairs.map((pair) =>
    pair.grade === 'WEAK' ? { ...pair, inliers: 45, inlier_ratio: 0.36, grade: 'ENOUGH' } : pair,
  ),
});

// 작업면은 앱이 살아 있는 동안 상태를 둔다. 구성 묶음 mock(startBackend 의 createZonesMock)이 발행 때 지금 작업면을 싣도록 같은 인스턴스를 나눈다.
export const staticObjectsMock = createStaticObjectsMock();
// 개발 서버에서는 세팅 세션이 시간으로 진행한다(보정 뒤 9초에 카메라 확인 걷기 창에서 멈추고(-687), 「걷기 시작」 뒤 12초 걸으면
// 통과해 약 4초 뒤 구역 단계, 그 26초 뒤 완료). 구역 단계와 맵 보강 촬영 다시 굽기(S15P31A101-607)까지 해 볼 수 있다.
// 새 세션은 World 이어짐(world_anchor.accepted)으로 두어, 구역 단계에서 지금 관제 구역을 확인 필요로 채우는 흐름(-629)을 해 볼 수 있다.
export const setupMock = createSetupMock({
  autoProgress: true,
  worldAnchorAccepted: true,
  cameraCheckWalk: true,
  // simAI-DEMO: 시연 계정 「새 맵 만들기」는 뒤에서 준비된 맵 재사용으로 시작한다. 그 재사용 후보
  ...(DEMO_FLOW ? { reuseCheck: DEMO_REUSE_CHECK, latestGuide: DEMO_COVERAGE_GUIDE } : {}),
});
// 작업 관리 새 흐름(하루 작업·날짜 보고서·서명·제출). 세팅 mock 의 세션으로 세팅 중·끝남을 안다. 같은 경로를 쓰는 옛 TBM mock·세팅 mock·
// 히스토리 mock 보다 먼저 답해야 해서(모르는 작업·요청은 undefined 로 넘긴다) 아래 목록에서 그 앞에 둔다.
export const workMock = createWorkMock({ setupSessions: () => setupMock.sessions.values() });
// 옛 TBM mock(작업 CRUD·레이아웃). 관제가 읽는 작업 목록에는 위 작업 mock 의 날짜 작업이 진행 값과 함께 이어 붙는다.
export const tbmMock = createTbmMock({
  deferDaysToHistory: true,
  dailyWorks: workMock.workItems,
});

// 경로 앞의 * 는 VITE_API_BASE_URL 이 무엇이든 맞추려는 것이다.
export const handlers = [
  http.get('*/api/sites/current', () =>
    HttpResponse.json({
      site_id: 'classroom-1',
      name: '교실 테스트베드',
      world_origin: null,
      established_calibration_version: 'cal-8',
      created_at_ms: 1_793_690_000_000,
    }),
  ),
  // 현재 보정 상태와 카메라 마커 자세(-522). 워치 배정·표시 이름 핸들러는 startBackend 의 peopleNames mock 이 맡는다(-658).
  http.get('*/api/calibrations/current', () =>
    HttpResponse.json({
      calibration_state: 'CALIBRATED',
      calibration_version: 'cal-7',
      previous_calibration_version: 'cal-6',
      provider_source: 'G1_AUTO',
      reason: 'INITIAL',
      effective_at: 1_760_342_400_000,
      updated_at: 1_760_342_400_000,
      cameras: [
        { camera_id: 'cam_A', reprojection_error_px: { median: 1.2, p95: 3.4 } },
        { camera_id: 'cam_B', reprojection_error_px: { median: 1.4, p95: 3.9 } },
        { camera_id: 'cam_C', reprojection_error_px: { median: 1.1, p95: 3.1 } },
        { camera_id: 'cam_D', reprojection_error_px: { median: 1.6, p95: 4.2 } },
      ],
      document_uploaded: true,
      latest_uploaded_version: 'cal-7',
      camera_poses: [
        {
          camera_id: 'cam_A',
          position_xyz: [0.2, 0.2, 2.5],
          forward_xyz: [0.7574, 0.5581, -0.3388],
          hfov_rad: 1.5204,
        },
        {
          camera_id: 'cam_B',
          position_xyz: [7.8, 0.2, 2.5],
          forward_xyz: [-0.7574, 0.5581, -0.3388],
          hfov_rad: 1.5204,
        },
        {
          camera_id: 'cam_C',
          position_xyz: [7.8, 5.8, 2.5],
          forward_xyz: [-0.7574, -0.5581, -0.3388],
          hfov_rad: 1.5204,
        },
        {
          camera_id: 'cam_D',
          position_xyz: [0.2, 5.8, 2.5],
          forward_xyz: [0.7574, -0.5581, -0.3388],
          hfov_rad: 1.5204,
        },
      ],
    }),
  ),
  http.post('*/api/auth/login', async ({ request }) => {
    const credentials = readCredentials(await request.json().catch(() => undefined));
    const account =
      credentials &&
      MOCK_ACCOUNTS.find(
        (a) => a.username === credentials.username && a.password === credentials.password,
      );
    if (!account) {
      return HttpResponse.json(
        { message: '아이디 또는 비밀번호가 맞지 않습니다' },
        { status: 401 },
      );
    }
    return signedIn(account);
  }),
  http.post('*/api/auth/refresh', ({ cookies }) => {
    const account = MOCK_ACCOUNTS.find((a) => a.id === cookies[REFRESH_COOKIE]);
    if (!account) {
      return HttpResponse.json(
        { status: 401, detail: '다시 로그인하세요', code: 'INVALID_REFRESH_TOKEN' },
        { status: 401, headers: { 'Set-Cookie': refreshCookie('', 0) } },
      );
    }
    return signedIn(account);
  }),
  http.post(
    '*/api/auth/logout',
    () => new HttpResponse(null, { status: 204, headers: { 'Set-Cookie': refreshCookie('', 0) } }),
  ),
  // 구성 묶음 발행·ACK 는 startBackend 의 구역 mock 이 맡는다.
  ...staticObjectsMock.handlers,
  ...sceneHandlers,
  ...createFloorPlanMock().handlers,
  ...workMock.handlers,
  ...tbmMock.handlers,
  ...setupMock.handlers,
  // 히스토리 작업 목록·구간 기록(그때그때 합성한다). 오늘 작업은 TBM 목의 작업이라 시작·종료가 따라온다.
  ...createHistoryMock({ liveWorks: () => tbmMock.works }).handlers,
  // 관제 녹화 작업 구간 영상(끝난 작업의 카메라별 mp4 조각, S15P31A101-668).
  ...createRecordingVideoMock({ liveWorks: () => tbmMock.works }).handlers,
  // GPU 켜기·끄기·설정(S15P31A101-702).
  ...createGpuMock({ startConnected: DEMO_FLOW }).handlers,
];
