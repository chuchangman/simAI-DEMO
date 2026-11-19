import { useCctvStore } from '@/features/cctv/cctv.store';
import { CameraCue } from '@/features/setup/CameraCue';
import type { CameraGuideView } from '@/features/setup/cameraGuides';
import { deriveStep1Coverage } from '@/features/setup/setup';
import { CameraVideoPanel } from '@/features/setup/SetupPanels';
import type { CoverageGuideItem, CoverageGuidesResponse } from '@/features/setup/types';
import { buildCoverageGuidePayload } from '@/mocks/setup';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/cctv/useCctvPreview', () => ({
  useCctvPreview: () => ({ attach: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  useCctvStore.getState().reset();
});

const guideView = (patch: Partial<CameraGuideView>): CameraGuideView => ({
  text: '오른쪽으로 더 돌려 주세요 (카메라 2–카메라 3)',
  direction: 'RIGHT',
  magnitude: 'MORE',
  neighborLabel: '카메라 3',
  spot: null,
  ...patch,
});

describe('카메라 영상 위 방향 안내', () => {
  it.each(['LEFT', 'RIGHT', 'UP', 'DOWN'] as const)(
    '%s 방향이면 그 가장자리에 꺾쇠를 둔다(조금 = 하나, 더 = 둘)',
    (direction) => {
      const { container, rerender } = render(
        <CameraCue guide={guideView({ direction, magnitude: 'SMALL' })} aspect={16 / 9} />,
      );
      const arrow = screen.getByTestId('camera-cue-arrow');
      expect(arrow.getAttribute('data-direction')).toBe(direction);
      expect(arrow.querySelectorAll('svg')).toHaveLength(1);
      rerender(<CameraCue guide={guideView({ direction, magnitude: 'MORE' })} aspect={16 / 9} />);
      expect(screen.getByTestId('camera-cue-arrow').querySelectorAll('svg')).toHaveLength(2);
      // 안내는 보기만 하는 것이라 보조 기기에는 숨기고 누름을 막지 않는다.
      expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
    },
  );

  it('같이 보는 곳은 영상 사각형 안의 비율 위치에 동그라미와 이웃 카메라 이름으로 둔다', () => {
    render(<CameraCue guide={guideView({ spot: [0.25, 0.6] })} aspect={4 / 3} />);
    const spot = screen.getByTestId('camera-cue-spot');
    expect(spot.textContent).toBe('카메라 3');
    expect(spot.style.left).toBe('25%');
    expect(spot.style.top).toBe('60%');
    // 위치를 잡는 틀은 영상이 그려지는 비율의 사각형이다.
    expect(parseFloat(spot.parentElement!.style.aspectRatio)).toBeCloseTo(4 / 3);
  });

  it('방향이 없고 같이 보는 곳도 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(
      <CameraCue guide={guideView({ direction: 'NONE', spot: null })} aspect={16 / 9} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('방향이 없어도 같이 보는 곳이 있으면 동그라미만 그린다', () => {
    render(
      <CameraCue guide={guideView({ direction: 'NONE', spot: [0.5, 0.5] })} aspect={16 / 9} />,
    );
    expect(screen.queryByTestId('camera-cue-arrow')).toBeNull();
    expect(screen.getByTestId('camera-cue-spot')).toBeTruthy();
  });
});

describe('카메라 영상 칸의 방향 안내', () => {
  const response = (
    status: 'OK' | 'NO_VIDEO',
    guides: CoverageGuideItem[],
  ): CoverageGuidesResponse => ({
    calibration_version: null,
    guides: [],
    site_id: 'classroom-1',
    status: 'OK',
    stale: false,
    received_at_ms: 100,
    age_ms: 0,
    latest: buildCoverageGuidePayload({
      connectivity: 'DISCONNECTED',
      cameraStatuses: { cam_C: status },
      guides,
    }),
  });
  const cam3Guide: CoverageGuideItem[] = [
    {
      camera_id: 'cam_C',
      pair: ['cam_C', 'cam_D'],
      direction: 'RIGHT',
      magnitude: 'MORE',
      reason_code: 'WEAK_PAIR_EDGE_CLUSTER',
    },
  ];

  it('안내가 가리키는 카메라 영상에만 꺾쇠와 이웃 카메라 동그라미를 얹고 이름표는 카메라 이름이다', () => {
    render(<CameraVideoPanel coverage={deriveStep1Coverage(response('OK', cam3Guide))} />);
    const arrows = screen.getAllByTestId('camera-cue-arrow');
    expect(arrows).toHaveLength(1);
    expect(arrows[0]!.getAttribute('data-direction')).toBe('RIGHT');
    expect(arrows[0]!.querySelectorAll('svg')).toHaveLength(2);
    // 카메라 3 의 칸(오른쪽 열 아래)에 있고, 같이 보는 곳은 쌍 cam_C–cam_D 의 카메라 3 쪽 값이다.
    const tile = screen.getByLabelText('카메라 3 영상').parentElement!;
    expect(within(tile).getByTestId('camera-cue-arrow')).toBe(arrows[0]);
    const spot = within(tile).getByTestId('camera-cue-spot');
    expect(spot.textContent).toBe('카메라 4');
    expect(spot.style.left).toBe('79%');
    expect(spot.style.top).toBe('62%');
    expect(within(tile).getByText('카메라 3')).toBeTruthy();
  });

  it('영상이 그려지는 사각형의 비율은 중계가 알린 영상 크기를 따르고 아직 모르면 16:9 로 본다', () => {
    const { unmount } = render(
      <CameraVideoPanel coverage={deriveStep1Coverage(response('OK', cam3Guide))} />,
    );
    const aspectOf = () =>
      parseFloat(screen.getByTestId('camera-cue-spot').parentElement!.style.aspectRatio);
    expect(aspectOf()).toBeCloseTo(16 / 9);
    unmount();
    useCctvStore.getState().codec('cam_C', 1280, 960);
    render(<CameraVideoPanel coverage={deriveStep1Coverage(response('OK', cam3Guide))} />);
    expect(aspectOf()).toBeCloseTo(4 / 3);
  });

  it('카메라 영상이 끊겼으면 배지는 「연결 끊김」 하나이고 영상 위 안내는 얹지 않는다', () => {
    render(<CameraVideoPanel coverage={deriveStep1Coverage(response('NO_VIDEO', cam3Guide))} />);
    expect(screen.queryByTestId('camera-cue-arrow')).toBeNull();
    const tile = screen.getByLabelText('카메라 3 영상').parentElement!;
    expect(within(tile).getByText('연결 끊김')).toBeTruthy();
  });

  it('안내가 없는 카메라는 꺾쇠도 동그라미도 없다', () => {
    render(<CameraVideoPanel coverage={deriveStep1Coverage(response('OK', []))} />);
    expect(screen.queryByTestId('camera-cue-arrow')).toBeNull();
    expect(screen.queryByTestId('camera-cue-spot')).toBeNull();
  });
});
