import type { SpatialMockApi } from '@/features/viewer3d/dev-harness/mswHandlers';
import type { GeometryMode } from '@/features/viewer3d/dev-harness/officialFixtures';
import type { ScenarioKey } from '@/features/viewer3d/dev-harness/scenarios';

let started: Promise<SpatialMockApi | null> | null = null;

/**
 * 개발 화면에서 Spatial REST Mock(MSW)을 켠다. 개발 서버에서만 켜고 운영 빌드에서는 아무것도 하지 않는다.
 * 앱 진입점(main.tsx)의 MSW 와는 다른 HTML 이라 두 곳이 한 페이지에서 함께 켜지지 않는다. 여러 번 불러도 한 번만 켠다.
 */
export function startSpatialMocks(initial: {
  scenario: ScenarioKey;
  t0: number;
  geometry?: GeometryMode;
}): Promise<SpatialMockApi | null> {
  if (!import.meta.env.DEV) return Promise.resolve(null);
  started ??= (async () => {
    const [{ network }, { createSpatialMockApi }] = await Promise.all([
      import('virtual:msw'),
      import('@/features/viewer3d/dev-harness/mswHandlers'),
    ]);
    const api = createSpatialMockApi(initial);
    network.configure({ handlers: api.handlers, onUnhandledFrame: 'bypass' });
    await network.enable();
    api.setReactivator(async () => {
      await network.disable();
      await network.enable();
    });
    return api;
  })();
  return started;
}
