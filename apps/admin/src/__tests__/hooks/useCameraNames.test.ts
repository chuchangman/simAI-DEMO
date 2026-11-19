import { useCctvStore } from '@/features/cctv/cctv.store';
import { useCameraNames } from '@/hooks/useCameraNames';
import { cameraOrder, useCameraOrderStore } from '@/lib/cameraNames';
import { useRealtimeStore } from '@/store/realtime.store';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

afterEach(() => {
  cleanup();
  useCctvStore.getState().reset();
  useRealtimeStore.getState().reset();
});

it('현장 목록 순서가 ID 정렬·중계 순서·선택된 카메라 부분집합보다 우선한다', () => {
  useCameraOrderStore.getState().set(['cam_D', 'cam_B', 'cam_A', 'cam_C']);
  useCctvStore.getState().hello(['cam_A', 'cam_B', 'cam_C', 'cam_D']);
  const { result } = renderHook(() => useCameraNames(['cam_C']));
  expect(result.current('cam_C')).toBe('카메라 4');
  expect(result.current('cam_D')).toBe('카메라 1');
  act(() => useCctvStore.getState().reset());
  expect(result.current('cam_C')).toBe('카메라 4');
});

it('목록을 모르면 전체 보정·기록 목록의 ID 순서로 정하고 원문을 표시 이름으로 내보내지 않는다', () => {
  const { result } = renderHook(() => useCameraNames(['cam_Z', 'cam_A', 'cam_Z']));
  expect(result.current('cam_A')).toBe('카메라 1');
  expect(result.current('cam_Z')).toBe('카메라 2');
  expect(result.current('unknown')).toBe('카메라');
  expect(cameraOrder(['cam_Z', 'cam_A'], ['cam_B', 'cam_Z'])).toEqual(['cam_Z', 'cam_A', 'cam_B']);
});

it('새 세션에서 이전 현장 순서를 비운다', () => {
  useCameraOrderStore.getState().set(['old-camera']);
  useRealtimeStore.getState().begin();
  expect(useCameraOrderStore.getState().ids).toEqual([]);
});
