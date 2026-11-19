import { STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import { BUNDLES_KEY, ZONES_KEY } from '@/features/zones/api';
import { bindConfigCache } from '@/features/zones/configCache';
import { MOCK_CONFIG, viewerHealthAt, type MockConfig } from '@/mocks/realtimeScenario';
import { useRealtimeStore } from '@/store/realtime.store';
import { clearZoneDrafts, updateZoneDraft } from '@/store/zoneEdit.store';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 다른 브라우저의 구역·작업면 저장·발행을 /topic/health 의 config 로 알아채 목록을 다시 받는다(S15P31A101-638).
// 목록은 캐시에 넣어 두고, 다시 받기는 invalidateQueries 가 표시한 isInvalidated 로 본다(받는 쪽이 없어 실제 요청은 없다).

const NOW = 1_760_342_450_000;
const LISTS = [ZONES_KEY, STATIC_OBJECTS_KEY, BUNDLES_KEY] as const;

/** 지금 발행·적용 버전이 모두 cfg-12 이고 동기 상태가 정상인 health 를 받는다. config 는 칸만 바꿔 덮는다. */
const receive = (config: Partial<MockConfig> = {}) =>
  useRealtimeStore.getState().receiveHealth({
    payload: viewerHealthAt(NOW, { config: { ...MOCK_CONFIG, ...config } }).payload,
    receivedAt: NOW,
    clockOffsetMs: 0,
  });

/** 다른 관리자가 cfg-13 을 발행해 Tier 0 가 적용하는 중인 health. */
const PUBLISHED_13 = { published_version: 'cfg-13', sync: 'PENDING' } as const;

const unbinds: (() => void)[] = [];

/** 세 목록을 캐시에 둔 클라이언트에 바인딩한다. 묶음 목록 맨 앞 버전은 headVersion 이다. */
function setup(headVersion = 'cfg-12') {
  const queryClient = new QueryClient();
  for (const key of LISTS) queryClient.setQueryData(key, []);
  queryClient.setQueryData(BUNDLES_KEY, [{ config_version: headVersion }]);
  unbinds.push(bindConfigCache(queryClient));
  return queryClient;
}

const invalidatedKeys = (queryClient: QueryClient) =>
  LISTS.filter((key) => queryClient.getQueryState(key)?.isInvalidated);

const draft = () => updateZoneDraft('z-1', () => ({ patch: { name: '임시 초안' }, box: null }));

beforeEach(() => {
  useRealtimeStore.getState().reset();
  clearZoneDrafts();
});

afterEach(() => {
  unbinds.splice(0).forEach((unbind) => unbind());
  clearZoneDrafts();
});

describe('bindConfigCache', () => {
  it('처음 받은 구성은 기준으로만 삼고, 값이 그대로면 다시 받지 않는다', () => {
    const queryClient = setup();

    receive();
    receive();
    expect(invalidatedKeys(queryClient)).toEqual([]);
  });

  it('발행 버전이 바뀌면 구역·작업면·묶음 목록을 모두 다시 받게 한다', () => {
    const queryClient = setup();
    receive();

    receive(PUBLISHED_13);
    expect(invalidatedKeys(queryClient)).toEqual([ZONES_KEY, STATIC_OBJECTS_KEY, BUNDLES_KEY]);
  });

  it.each([{ applied_version: 'cfg-11' }, { sync: 'STALE' } as const])(
    '적용 버전·동기 상태만 바뀌면 묶음 목록만 다시 받게 한다 (%o)',
    (change) => {
      const queryClient = setup();
      receive();

      receive(change);
      expect(invalidatedKeys(queryClient)).toEqual([BUNDLES_KEY]);
    },
  );

  it('묶음 목록이 이미 그 버전을 가졌어도(내가 발행했거나 다른 화면이 묶음만 먼저 받았다) 구역·작업면을 다시 받는다', () => {
    const queryClient = setup('cfg-13');
    receive();

    receive(PUBLISHED_13);
    expect(invalidatedKeys(queryClient)).toEqual([ZONES_KEY, STATIC_OBJECTS_KEY, BUNDLES_KEY]);
  });

  it('구역 편집 초안이 있으면 구역·작업면은 미루고 묶음만 받는다. 초안이 비면 미룬 것을 한 번 받는다', () => {
    const queryClient = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    receive();
    draft();

    receive(PUBLISHED_13);
    expect(invalidatedKeys(queryClient)).toEqual([BUNDLES_KEY]);
    expect(invalidate).toHaveBeenCalledTimes(1);

    clearZoneDrafts();
    expect(invalidatedKeys(queryClient)).toEqual([ZONES_KEY, STATIC_OBJECTS_KEY, BUNDLES_KEY]);
    expect(invalidate).toHaveBeenCalledTimes(3);

    // 미룬 것은 한 번만 받는다
    draft();
    clearZoneDrafts();
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it('health 가 비었다가(끊김·로그아웃) 다른 버전으로 다시 오면 그 사이 놓친 변경으로 보고 받는다', () => {
    const queryClient = setup();
    receive();
    useRealtimeStore.getState().reset();
    expect(invalidatedKeys(queryClient)).toEqual([]);

    receive(PUBLISHED_13);
    expect(invalidatedKeys(queryClient)).toEqual([ZONES_KEY, STATIC_OBJECTS_KEY, BUNDLES_KEY]);
  });

  it('해제하면 구성이 바뀌어도 받지 않고, 미룬 것도 받지 않는다', () => {
    const queryClient = setup();
    receive();
    draft();
    receive(PUBLISHED_13);
    unbinds.splice(0).forEach((unbind) => unbind());
    for (const key of LISTS) queryClient.setQueryData(key, []);

    clearZoneDrafts();
    receive({ published_version: 'cfg-14' });
    expect(invalidatedKeys(queryClient)).toEqual([]);
  });
});
