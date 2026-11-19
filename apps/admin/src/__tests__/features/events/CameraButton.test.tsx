import { ANY_CAMERA, useCamSplitStore } from '@/features/cctv/camSplit.store';
import { CameraButton } from '@/features/events/CameraButton';
import { useRealtimeStore } from '@/store/realtime.store';
import type { WorldStatePayload } from '@simai/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const T = 1_760_342_400_000;

const person = { type: 'person', id: 'w-0015' } as const;
const zone = { type: 'zone', id: 'z-04' } as const;

function setTracks(tracks: { world_id: string; cameras: string[] }[]) {
  useRealtimeStore.setState({
    world: { receivedAt: T, payload: { tracks } as unknown as WorldStatePayload },
  });
}

beforeEach(() => {
  useCamSplitStore.getState().close();
  useRealtimeStore.setState({ world: null });
});

afterEach(cleanup);

describe('CameraButton', () => {
  it('사람을 담은 카메라가 있어도 카메라 이름 없이 첫 카메라를 연다', () => {
    setTracks([{ world_id: 'w-0015', cameras: ['cam_B', 'cam_A'] }]);
    render(<CameraButton target={person} variant="card" />);

    expect(screen.queryByText('cam_B')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'CCTV로 확인' }));
    expect(useCamSplitStore.getState().split).toEqual({ cam: ANY_CAMERA, target: person });
  });

  it('추적이 없으면(world 를 못 받음) 카메라 이름 없이 첫 카메라를 연다', () => {
    render(<CameraButton target={person} variant="banner" />);

    fireEvent.click(screen.getByRole('button', { name: 'CCTV로 확인' }));
    expect(useCamSplitStore.getState().split).toEqual({ cam: ANY_CAMERA, target: person });
  });

  it('사람을 놓친 경우와 구역 대상도 같다', () => {
    setTracks([{ world_id: 'w-0015', cameras: [] }]);
    const { rerender } = render(<CameraButton target={person} variant="card" />);
    expect(screen.getByRole('button', { name: 'CCTV로 확인' })).toBeTruthy();

    rerender(<CameraButton target={zone} variant="card" />);
    fireEvent.click(screen.getByRole('button', { name: 'CCTV로 확인' }));
    expect(useCamSplitStore.getState().split).toEqual({ cam: ANY_CAMERA, target: zone });
  });

  it('대상이 없으면 버튼이 없다', () => {
    render(<CameraButton target={null} variant="card" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
