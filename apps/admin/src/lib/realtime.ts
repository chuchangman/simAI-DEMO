import { demoHidesFromViewer } from '@/features/demo/demoPpe';
import { env } from '@/lib/env';
import { createRealtime } from '@/lib/stomp';
import { useRealtimeStore } from '@/store/realtime.store';

// 앱의 STOMP 연결은 이 인스턴스 하나다. 로그인·로그아웃에 맞춰 bindSession(main.tsx)이 열고 닫는다.
// 시연 계정은 조끼 이벤트를 3D 에 넘기지 않는다(features/demo/demoPpe).
export const realtime = createRealtime({
  url: env.VITE_STOMP_URL,
  store: useRealtimeStore,
  hideFromViewer: demoHidesFromViewer,
});
