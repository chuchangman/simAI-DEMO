// @vitest-environment node
import {
  completeSetupSession,
  createSetupSession,
  importPreviousSetupZones,
  requestSetupSession,
  saveSetupZonePlan,
  seedSetupZonePlan,
} from '@/features/setup/api';
import { confirmPlanItems } from '@/features/setup/setupZonePlan';
import { fetchWorkUnit, putDailyWorkUnit } from '@/features/work/api';
import { commitZone } from '@/features/zones/api';
import { bodyOf, formOf } from '@/features/zones/zoneForm';
import { readZones } from '@/features/zones/zones';
import { ApiError, createHttp } from '@/lib/http';
import { createSetupMock } from '@/mocks/setup';
import { createWorkMock } from '@/mocks/work';
import { createZonesMock, MOCK_ZONES } from '@/mocks/zones';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// 개발 서버의 세팅 끝내기 연결: 세팅 세션에 속한 구역 저장(POST /api/zones/commit 의 setup_session_id)이 발행까지 되면 그 세션이
// COMPLETED 가 되고 zones_committed_at 이 찍힌다(startBackend 의 연결과 같다). 작업 mock 이 그 작업을 SETUP_DONE 으로 보고 보고서
// 초안을 만드는 것은 세팅 완료(POST /api/setup-sessions/{id}/complete, -615)를 받은 뒤다(서버의 setup_completed_at 과 같다).

const BASE = 'http://api.test';
const TODAY = '2026-11-11';
const T0 = new Date(2026, 10, 11, 9, 0).getTime();
const DRAFT_DELAY_MS = 2_500;
const CAMERA_HEIGHTS = { cam_A: 2.7, cam_B: 2.7, cam_C: 2.7, cam_D: 2.7 };

let clock = T0;
const now = () => clock;
let setupMock: ReturnType<typeof createSetupMock>;
let anchored = false;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  clock = T0;
  setupMock = createSetupMock({ now, worldAnchorAccepted: anchored });
  const workMock = createWorkMock({
    now,
    setupSessions: () => setupMock.sessions.values(),
    draftDelayMs: DRAFT_DELAY_MS,
  });
  const zonesMock = createZonesMock({ now, onCommit: setupMock.completeAfterZonesCommit });
  setupMock.bindLiveZones(() => zonesMock.currentZones());
  // 실제 handlers.ts 와 같은 순서: 작업 mock 이 먼저 답하고 모르는 요청은 세팅 mock 으로 넘어간다.
  server.resetHandlers(...workMock.handlers, ...zonesMock.handlers, ...setupMock.handlers);
});

const http = createHttp({ baseUrl: BASE, getToken: () => 'mock-token.admin' });

const z04 = readZones(MOCK_ZONES)[0]!;
/** 새 구역 한 번 저장. 세팅 화면은 세션 id 를 함께 보낸다. */
const newZone = (name: string, setupSessionId?: string) => ({
  zone: { op: 'CREATE' as const, body: bodyOf(z04, { ...formOf(z04), name }, null) },
  setup_session_id: setupSessionId,
});

/** 오늘 작업을 만들고 그 작업의 세팅 세션을 시작한다. */
async function startSetupFor() {
  const work = await putDailyWorkUnit(http, TODAY);
  const session = await createSetupSession(http, {
    work_unit_id: Number(work.work_id),
    camera_heights_m: CAMERA_HEIGHTS,
  });
  return { workId: work.work_id, sessionId: session.setup_session_id };
}

describe('구역 저장 → 세팅 완료 → 작업 SETUP_DONE', () => {
  it('세션이 없으면 REPORT, 세션이 시작되면 SETUP 이고 구역을 저장하면 세션이 COMPLETED 가 되며 세팅 완료 뒤 SETUP_DONE 이 된다', async () => {
    const work = await putDailyWorkUnit(http, TODAY);
    expect(work.progress).toBe('REPORT');

    const session = await createSetupSession(http, {
      work_unit_id: Number(work.work_id),
      camera_heights_m: CAMERA_HEIGHTS,
    });
    const running = await fetchWorkUnit(http, work.work_id);
    expect(running.progress).toBe('SETUP');
    expect(running.active_setup_session_id).toBe(session.setup_session_id);

    clock = T0 + 60_000;
    await commitZone(http, newZone('개구부 위험 구역', session.setup_session_id));

    expect(setupMock.sessions.get(session.setup_session_id)).toMatchObject({
      status: 'COMPLETED',
      stage: 'COMPLETED',
      progress_pct: 100,
      zones_committed_at: T0 + 60_000,
      completed_at_ms: T0 + 60_000,
    });
    // 구역 저장만으로는 세팅이 끝나지 않는다
    expect((await fetchWorkUnit(http, work.work_id)).progress).toBe('SETUP');

    const completed = await completeSetupSession(http, session.setup_session_id);
    expect(completed.setup_completed_at_ms).toBe(T0 + 60_000);
    expect(completed.applied_zones).toEqual({ created: [], updated: [], kept: [], archived: [] });
    const done = await fetchWorkUnit(http, work.work_id);
    expect(done.progress).toBe('SETUP_DONE');
    expect(done.active_setup_session_id).toBeNull();
    expect(done.tbm_report?.draft_status).toBe('GENERATING');
  });

  it('세팅이 끝난 뒤 초안 생성 시간이 지나면 보고서 초안이 SUCCEEDED 가 된다', async () => {
    const { workId, sessionId } = await startSetupFor();
    await commitZone(http, newZone('개구부 위험 구역', sessionId));
    await completeSetupSession(http, sessionId);
    // 작업 mock 은 처음 읽을 때 세팅이 끝난 것을 알아채고 그때부터 초안 시간을 잰다.
    expect((await fetchWorkUnit(http, workId)).tbm_report?.draft_status).toBe('GENERATING');

    clock = T0 + DRAFT_DELAY_MS;
    const work = await fetchWorkUnit(http, workId);
    expect(work.progress).toBe('SETUP_DONE');
    expect(work.tbm_report?.draft_status).toBe('SUCCEEDED');
  });

  it('구역 저장이 실패하면(본문이 틀림) 세션은 그대로 진행 중이다', async () => {
    const { workId, sessionId } = await startSetupFor();
    // 바꾸는 것이 없는 저장(작업면 없는 KEEP)은 400 이다.
    const bad = commitZone(http, {
      zone: { op: 'KEEP', zone_id: 'z-04' },
      setup_session_id: sessionId,
    });
    await expect(bad).rejects.toBeInstanceOf(ApiError);

    expect(setupMock.sessions.get(sessionId)).toMatchObject({
      status: 'COLLECTING_BACKGROUND',
      zones_committed_at: null,
    });
    expect((await fetchWorkUnit(http, workId)).progress).toBe('SETUP');
  });

  it('세팅 세션이 없는 저장(관제 구역 편집)이나 발행하지 않은 저장은 세션을 끝내지 않는다', async () => {
    const { workId, sessionId } = await startSetupFor();

    await commitZone(http, newZone('관제에서 만든 구역'));
    await commitZone(http, { ...newZone('발행 전 구역', sessionId), publish: false });

    expect(setupMock.sessions.get(sessionId)).toMatchObject({
      status: 'COLLECTING_BACKGROUND',
      zones_committed_at: null,
    });
    expect((await fetchWorkUnit(http, workId)).progress).toBe('SETUP');
  });

  it('알지 못하는 세션 id 는 건드리지 않는다', async () => {
    const { sessionId } = await startSetupFor();
    await commitZone(http, newZone('다른 세션의 구역', 'unknown-session'));
    expect(setupMock.sessions.get(sessionId)?.status).toBe('COLLECTING_BACKGROUND');
  });

  it('실패한 세션은 그대로 두고, 두 번째 저장은 처음 저장한 시각을 바꾸지 않으며 저장만으로는 SETUP 이다', async () => {
    const { workId, sessionId } = await startSetupFor();
    const failedId = 'failed-session';
    setupMock.sessions.set(failedId, {
      ...setupMock.sessions.get(sessionId)!,
      setup_session_id: failedId,
      status: 'FAILED',
      stage: 'FAILED',
    });

    await commitZone(http, newZone('실패한 세션의 구역', failedId));
    clock = T0 + 10_000;
    await commitZone(http, newZone('첫 구역', sessionId));
    clock = T0 + 20_000;
    await commitZone(http, newZone('둘째 구역', sessionId));

    expect(setupMock.sessions.get(failedId)).toMatchObject({
      status: 'FAILED',
      zones_committed_at: null,
    });
    expect(setupMock.sessions.get(sessionId)?.zones_committed_at).toBe(T0 + 10_000);
    expect((await fetchWorkUnit(http, workId)).progress).toBe('SETUP');
  });
});

describe('개발 서버 세팅 mock: 시간이 지나면 미리보기 맵이 준비된다(previewReadyAfterMs)', () => {
  const READY_AFTER_MS = 6_000;
  const heights = { work_unit_id: 9001, camera_heights_m: CAMERA_HEIGHTS };

  it('옵션이 없으면 시간이 아무리 지나도 세션은 수집 중 그대로다', async () => {
    const { sessionId } = await startSetupFor();
    clock = T0 + 60 * 60_000;
    expect((await requestSetupSession(http, sessionId)).status).toBe('COLLECTING_BACKGROUND');
  });

  it('옵션이 있으면 시간이 지난 뒤 처음 조회에서 미리보기 맵이 준비된 모양이 되고, 구역을 저장하면 끝난다', async () => {
    const timed = createSetupMock({ now, previewReadyAfterMs: READY_AFTER_MS });
    const zonesMock = createZonesMock({ now, onCommit: timed.completeAfterZonesCommit });
    server.use(...zonesMock.handlers, ...timed.handlers);
    const { setup_session_id: id } = await createSetupSession(http, heights);

    clock = T0 + READY_AFTER_MS - 1;
    expect((await requestSetupSession(http, id)).status).toBe('COLLECTING_BACKGROUND');

    clock = T0 + READY_AFTER_MS;
    expect(await requestSetupSession(http, id)).toMatchObject({
      status: 'PREVIEW_AND_VLM_DRAFT',
      stage: 'PREVIEW_AND_VLM_DRAFT',
      progress_pct: 92,
      preview_scene_version: 'scene-preview-1',
      calibration_version: 'cal-8',
    });

    await commitZone(http, newZone('개구부 위험 구역', id));
    expect(await requestSetupSession(http, id)).toMatchObject({
      status: 'COMPLETED',
      zones_committed_at: T0 + READY_AFTER_MS,
    });
  });
});

describe('개발 서버 세팅 mock: 세팅 완료(POST .../complete, -615)', () => {
  it('미리보기 맵 전에는 SETUP_NOT_READY_TO_COMPLETE, 미리보기만 있으면 SETUP_FINAL_MAP_NOT_READY(-688), 완료 뒤 다시 누르면 SETUP_ALREADY_COMPLETED 이고 보강은 막힌다', async () => {
    const { sessionId } = await startSetupFor();
    await expect(completeSetupSession(http, sessionId)).rejects.toMatchObject({
      code: 'SETUP_NOT_READY_TO_COMPLETE',
    });

    setupMock.updateSession(sessionId, {
      status: 'READY_FOR_ZONES',
      stage: 'READY_FOR_ZONES',
      preview_scene_version: 'scene-preview-1',
      calibration_version: 'cal-8',
    });
    await expect(completeSetupSession(http, sessionId)).rejects.toMatchObject({
      code: 'SETUP_FINAL_MAP_NOT_READY',
    });
    setupMock.updateSession(sessionId, {
      status: 'COMPLETED',
      stage: 'COMPLETED',
      scene_version: 'scene-final-1',
    });
    await completeSetupSession(http, sessionId);
    await expect(completeSetupSession(http, sessionId)).rejects.toMatchObject({
      code: 'SETUP_ALREADY_COMPLETED',
    });
    const session = await requestSetupSession(http, sessionId);
    expect(session.supplement?.can_upload).toBe(false);
    expect(session.supplement?.rebake_blocked_reason).toBe('SETUP_COMPLETED');
  });
});

describe('새 모델 + World 이어짐의 확인 필요 구역(S15P31A101-629, -758)', () => {
  beforeAll(() => {
    anchored = true;
  });
  afterAll(() => {
    anchored = false;
  });

  it('처음 채우기는 이전 구역을 이어 오지 않고, 불러오기로 확인 필요로 더하며, 남아 있으면 완료를 409 로 거부하고 모두 확인하면 완료한다', async () => {
    const { sessionId } = await startSetupFor();
    setupMock.updateSession(sessionId, {
      status: 'COMPLETED',
      stage: 'COMPLETED',
      scene_version: 'scene-final-1',
    });
    // 새 모델은 처음 채우기가 이전 구역을 이어 오지 않는다(S15P31A101-758)
    const empty = await seedSetupZonePlan(http, sessionId);
    expect(empty).toMatchObject({ revision: 0, items: [] });

    const seeded = await importPreviousSetupZones(http, sessionId);
    expect(seeded.revision).toBe(1);
    expect(seeded.items.length).toBe(readZones(MOCK_ZONES).length);
    expect(seeded.items.every((item) => item.needs_review)).toBe(true);
    expect(seeded.import_skipped).toEqual([]);
    // 다시 불러도 이미 있는 구역은 더하지 않는다
    expect((await importPreviousSetupZones(http, sessionId)).revision).toBe(1);

    const rejected = await completeSetupSession(http, sessionId).catch((e: unknown) => e);
    expect(rejected).toBeInstanceOf(ApiError);
    expect((rejected as ApiError).code).toBe('SETUP_ZONES_UNCONFIRMED');
    expect((rejected as ApiError).serverMessage).toContain(`${seeded.items.length}개`);

    await saveSetupZonePlan(http, sessionId, confirmPlanItems(seeded.items)!, seeded.revision);
    const done = await completeSetupSession(http, sessionId);
    expect(done.setup_completed_at_ms).not.toBeNull();
  });
});
