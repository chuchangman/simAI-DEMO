import { setupSessionResponseSchema } from '@/features/setup/types';
import { createSetupMock } from '@/mocks/setup';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 개발 서버용 세팅 mock 의 autoProgress(시간으로 단계 진행)와 보강 촬영 상태 싣기(S15P31A101-607).

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

const AUTH = { Authorization: 'Bearer mock-token.admin', 'Content-Type': 'application/json' };

describe('세팅 mock autoProgress', () => {
  it('시작 뒤 시간이 지나면 미리보기·정식 맵까지 단계가 앞으로만 넘어가고 supplement 를 싣는다', async () => {
    let clock = 1_000;
    // 입력 높이를 현장 실제 높이와 같게 둬 -670 의 높이 불일치 멈춤(정밀 보정 진입)에 걸리지 않게 한다.
    const mock = createSetupMock({
      now: () => clock,
      autoProgress: true,
      cameraHeightsM: { cam_A: 2.4 },
    });
    server.resetHandlers(...mock.handlers);
    const created = (await (
      await fetch('http://api.test/api/setup-sessions', {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ work_unit_id: 1, camera_heights_m: { cam_A: 2.4 } }),
      })
    ).json()) as { setup_session_id: string };
    const get = async () =>
      setupSessionResponseSchema.parse(
        await (
          await fetch(`http://api.test/api/setup-sessions/${created.setup_session_id}`, {
            headers: AUTH,
          })
        ).json(),
      );

    const first = await get();
    expect(first.status).toBe('COLLECTING_BACKGROUND');
    expect(first.supplement).toMatchObject({
      can_upload: false,
      can_rebake: false,
      rebake_blocked_reason: 'SESSION_NOT_READY',
    });

    clock += 5_000;
    const initial = await get();
    clock += 1_000;
    const initialNext = await get();
    expect(initial.status).toBe('INITIAL_POSE_AND_WORLD');
    expect(initialNext.status).toBe(initial.status);
    expect(initial.progress_pct).toBeGreaterThan(15);
    expect(initialNext.progress_pct).toBeGreaterThan(initial.progress_pct);
    expect(initialNext.progress_pct).toBeLessThan(40);
    expect((await get()).progress_pct).toBe(initialNext.progress_pct);

    clock += 8_000;
    const ready = await get();
    expect(ready.status).toBe('READY_FOR_ZONES');
    expect(ready.preview_scene_version).toBeTruthy();
    expect(ready.supplement).toMatchObject({
      can_upload: true,
      rebake_blocked_reason: 'SETUP_JOB_RUNNING',
    });

    clock += 12_000;
    const baking = await get();
    clock += 1_000;
    const bakingNext = await get();
    expect(baking.status).toBe('BAKING_TEXTURE');
    expect(baking.progress_pct).toBeGreaterThan(85);
    expect(bakingNext.status).toBe(baking.status);
    expect(bakingNext.progress_pct).toBeGreaterThan(baking.progress_pct);
    expect(bakingNext.progress_pct).toBeLessThan(95);

    clock += 17_000;
    const done = await get();
    expect(done.status).toBe('COMPLETED');
    expect(done.scene_version).toBeTruthy();
    expect(done.supplement?.rebake_blocked_reason).toBe('NO_MEDIA');
  });

  it('카메라 확인 걷기(-687)를 켜면 보정 뒤 맵 단계 전에 멈추고, 걷기 시작·표본 부족·확인만 다시·통과 뒤에야 미리보기로 간다', async () => {
    let clock = 1_000;
    const mock = createSetupMock({
      now: () => clock,
      autoProgress: true,
      cameraCheckWalk: true,
      cameraCheckIncompleteAttempts: 1,
      cameraHeightsM: { cam_A: 2.4 },
    });
    server.resetHandlers(...mock.handlers);
    const created = (await (
      await fetch('http://api.test/api/setup-sessions', {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ work_unit_id: 1, camera_heights_m: { cam_A: 2.4 } }),
      })
    ).json()) as { setup_session_id: string };
    const url = `http://api.test/api/setup-sessions/${created.setup_session_id}`;
    const get = async () =>
      setupSessionResponseSchema.parse(await (await fetch(url, { headers: AUTH })).json());
    const start = (attempt: number) =>
      fetch(`${url}/camera-check/start`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ attempt }),
      });

    clock += 20_000;
    const waiting = await get();
    expect(waiting.status).toBe('JOINT_BA_AND_VERIFY');
    expect(waiting.preview_scene_version).toBeNull();
    expect(waiting.camera_check_phase).toBe('AWAITING_START');
    expect(waiting.paused_reason).toBe('CAMERA_CHECK');
    clock += 60_000;
    expect((await get()).status).toBe('JOINT_BA_AND_VERIFY'); // 기다리는 동안 맵 단계가 흐르지 않는다

    expect((await start(2)).status).toBe(409); // 다음 번호가 아니다
    expect((await start(1)).status).toBe(200);
    clock += 5_000;
    expect((await get()).camera_check_phase).toBe('WALKING');
    clock += 10_000;
    const retry = await get();
    expect(retry.camera_check_phase).toBe('RETRY_WAIT');
    expect(retry.camera_check?.problems[0]?.reason).toBe('FEW_SAMPLES');
    expect(retry.preview_scene_version).toBeNull();

    expect((await start(2)).status).toBe(200);
    clock += 13_000;
    const passed = await get();
    expect(passed.camera_check_phase).toBe('PASSED');
    expect(passed.camera_check_passed).toBe(true);
    clock += 5_000;
    const ready = await get();
    expect(ready.status).toBe('READY_FOR_ZONES');
    expect(ready.preview_scene_version).toBeTruthy();
  });
});
