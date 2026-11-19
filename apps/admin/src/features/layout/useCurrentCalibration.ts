import { requestCurrentCalibration } from '@/features/layout/api';
import {
  readCalibrationCameraPoses,
  sameCalibratedCameraPoses,
  type CalibratedCameraPose,
} from '@/features/viewer3d';
import { api } from '@/lib/api';
import { useCameraOrderStore } from '@/lib/cameraNames';
import { useRealtimeStore } from '@/store/realtime.store';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

const NO_CAMERA_POSES: readonly CalibratedCameraPose[] = [];

interface CurrentCalibrationResult {
  readonly calibrationVersion: string | null;
  readonly cameraPoses: readonly CalibratedCameraPose[];
  readonly raw: unknown;
}

function readCalibrationVersion(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const val: unknown = Reflect.get(raw, 'calibration_version');
  return typeof val === 'string' && val.trim() !== '' ? val.trim() : null;
}

/**
 * 현재 보정 상태와 카메라 마커 자세(GET /api/calibrations/current, S15P31A101-522).
 * - 마운트할 때 한 번 조회하고, 실시간 world_state 의 calibration_version 이 바뀌면 다시 받아 갱신한다.
 * - 원시 문자열(calibration_version)만 구독하므로 1 Hz health 나 같은 버전의 10 Hz world_state 로는 다시 그리지 않는다.
 */
export function useCurrentCalibration() {
  const liveCalibrationVersion = useRealtimeStore(
    (s) => s.world?.payload.calibration_version ?? null,
  );
  const lastRefetchedVersion = useRef<string | null>(null);
  const stablePosesRef = useRef<readonly CalibratedCameraPose[]>(NO_CAMERA_POSES);

  const { data, refetch } = useQuery({
    queryKey: ['calibrations', 'current'],
    queryFn: async ({ signal }): Promise<CurrentCalibrationResult> => {
      const raw = await requestCurrentCalibration(api, signal);
      const parsed = readCalibrationCameraPoses(raw);
      useCameraOrderStore.getState().setCalibration(parsed.map((p) => p.cameraId));
      if (parsed.length === 0) {
        stablePosesRef.current = NO_CAMERA_POSES;
      } else if (!sameCalibratedCameraPoses(stablePosesRef.current, parsed)) {
        stablePosesRef.current = parsed;
      }
      return {
        calibrationVersion: readCalibrationVersion(raw),
        cameraPoses: stablePosesRef.current,
        raw,
      };
    },
    staleTime: Infinity,
    gcTime: 0,
  });

  useEffect(() => {
    if (!liveCalibrationVersion || data === undefined) return;
    if (data.calibrationVersion === liveCalibrationVersion) {
      lastRefetchedVersion.current = liveCalibrationVersion;
      return;
    }
    if (lastRefetchedVersion.current === liveCalibrationVersion) return;
    lastRefetchedVersion.current = liveCalibrationVersion;
    void refetch({ cancelRefetch: false });
  }, [liveCalibrationVersion, data, refetch]);

  return {
    calibrationVersion: data?.calibrationVersion ?? null,
    cameraPoses: data?.cameraPoses ?? NO_CAMERA_POSES,
  };
}
