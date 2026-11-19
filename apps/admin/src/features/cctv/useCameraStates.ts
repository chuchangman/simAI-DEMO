import { cameraState, type CameraState } from '@/features/cctv/cctv';
import { healthCameras } from '@/features/cctv/cctvCameras';
import { useWorldFresh } from '@/features/plan/useWorldFresh';
import { useLinkAlive } from '@/hooks/useLinkAlive';
import { useRealtimeStore } from '@/store/realtime.store';
import { useCallback, useMemo } from 'react';

/** health 의 카메라 상태. EC2 와 끊겼으면 health 를 지금 값으로 보지 않는다(모든 카메라가 정지). */
export function useCameraStates() {
  const alive = useLinkAlive();
  const health = useRealtimeStore((s) => (alive ? s.health : null));
  const fresh = useWorldFresh();
  const cameras = useMemo(() => healthCameras(health), [health]);
  const stateOf = useCallback(
    (id: string): CameraState =>
      cameraState(
        cameras.find((camera) => camera.id === id),
        fresh,
      ),
    [cameras, fresh],
  );
  return { cameras, fresh, stateOf };
}
