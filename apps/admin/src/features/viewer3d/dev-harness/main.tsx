// 개발 서버에서만 여는 Spatial UI 목업 진입점. 운영 index.html·라우터와 무관하며 운영 빌드에 들어가지 않는다.
// 앱 main.tsx 와 다른 HTML 이라 이 페이지에서는 Spatial 전용 MSW 만 켜진다(앱 로그인 핸들러와 섞이지 않는다).
import '@/features/viewer3d/dev-harness/mock.css';
import '@/index.css';

import { MockApp } from '@/features/viewer3d/dev-harness/MockApp';
import { readDataSource } from '@/features/viewer3d/dev-harness/harnessSource';
import { readGeometryMode } from '@/features/viewer3d/dev-harness/officialFixtures';
import { isScenarioKey } from '@/features/viewer3d/dev-harness/scenarios';
import { startSpatialMocks } from '@/features/viewer3d/dev-harness/startMocks';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const initial = readDataSource(window.location.search);
// MSW 를 켜지 못해도(서비스 워커 차단 등) 화면은 띄우고 REST 없이 스트림만 재생한다.
const mockApi = await startSpatialMocks({
  scenario: isScenarioKey(initial) ? initial : 'normal',
  t0: Date.now(),
  geometry: readGeometryMode(window.location.search),
}).catch((error: unknown) => {
  console.warn('Spatial MSW 를 켜지 못했다', error);
  return null;
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MockApp mockApi={mockApi} restBase={mockApi ? '' : null} />
  </StrictMode>,
);
