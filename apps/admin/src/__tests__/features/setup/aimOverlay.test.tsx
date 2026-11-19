import { useCctvStore } from '@/features/cctv/cctv.store';
import {
  AIM_ALL_ALIGNED_TEXT,
  AIM_ALL_SETUP_READY_TEXT,
  AIM_OVERLAY_LABEL,
  aimCameraView,
  aimSteps,
  aimViews,
  allAimAligned,
  allAimSetupReady,
} from '@/features/setup/aimCheck';
import { deriveStep1Coverage } from '@/features/setup/setup';
import { CameraVideoPanel } from '@/features/setup/SetupPanels';
import type {
  AimCheck,
  AimCheckItem,
  CoverageGuideItem,
  CoverageGuidesResponse,
} from '@/features/setup/types';
import { coverageGuidesResponseSchema } from '@/features/setup/types';
import { buildCoverageGuidePayload } from '@/mocks/setup';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 기준 시점 맞추기(S15P31A101-765): 카메라마다 기준 사진에 맞추는 각도 안내·겹쳐 보기·초록 표시.

vi.mock('@/features/cctv/useCctvPreview', () => ({
  useCctvPreview: () => ({ attach: vi.fn() }),
}));

const reference = vi.hoisted(() => ({
  urls: {
    cam_A: 'https://bucket.example/cam_A.jpg',
    cam_B: 'https://bucket.example/cam_B.jpg',
    cam_C: 'https://bucket.example/cam_C.jpg',
    cam_D: 'https://bucket.example/cam_D.jpg',
  } as Record<string, string> | undefined,
  scenes: [] as (string | null)[],
}));

vi.mock('@/features/setup/useAimReferenceImages', () => ({
  useAimReferenceImages: (scene: string | null) => {
    reference.scenes.push(scene);
    return reference.urls;
  },
}));

afterEach(() => {
  cleanup();
  useCctvStore.getState().reset();
  reference.scenes = [];
});

const CAMS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];
const rad = (deg: number) => (deg * Math.PI) / 180;
const MAX_AIM = 0.004363;
const MAX_ROLL = 0.017453;

const item = (
  camera_id: string,
  status: AimCheckItem['status'],
  angles: [number, number, number] | null = null,
  patch: Partial<AimCheckItem> = {},
): AimCheckItem => ({
  camera_id,
  status,
  reason: status === 'UNKNOWN' ? 'NOT_ROTATION' : null,
  matches: status === 'UNKNOWN' ? 30 : 300,
  inlier_ratio: status === 'UNKNOWN' ? null : 0.9,
  pan_rad: angles ? rad(angles[0]) : null,
  tilt_rad: angles ? rad(angles[1]) : null,
  roll_rad: angles ? rad(angles[2]) : null,
  target_point: status === 'UNKNOWN' ? null : [0.6, 0.45],
  target_px: status === 'UNKNOWN' ? null : [1382.4, 583.2],
  arrow_rad: status === 'MISALIGNED' ? -0.46 : null,
  ...patch,
});

const check = (cameras: AimCheckItem[]): AimCheck => ({
  scene_version: 'scene-calibrated-1',
  calibration_version: 'cal-calibrated-1',
  max_aim_rad: MAX_AIM,
  max_roll_rad: MAX_ROLL,
  max_setup_aim_rad: 0.02618,
  max_setup_roll_rad: 0.05236,
  hysteresis_rounds: 2,
  cameras,
});

const allAligned = check(CAMS.map((id) => item(id, 'ALIGNED', [0.05, -0.02, 0.1])));
const mixed = check([
  item('cam_A', 'ALIGNED', [0.05, 0.0, 0.1]),
  item('cam_B', 'MISALIGNED', [1.2, 0.4, -0.3]),
  item('cam_C', 'UNKNOWN'),
  item('cam_D', 'MISALIGNED', [-0.1, 0.0, -2.5], { arrow_rad: null }),
]);

const response = (
  aim: AimCheck | null,
  stale = false,
  guides: CoverageGuideItem[] = [],
): CoverageGuidesResponse =>
  coverageGuidesResponseSchema.parse({
    status: stale ? 'STALE' : 'OK',
    stale,
    received_at_ms: 100,
    age_ms: stale ? 90_000 : 0,
    latest: { ...buildCoverageGuidePayload({ guides }), schema_version: '1.4.0', aim_check: aim },
  });

describe('각도 문장', () => {
  it('교정량 부호: 오른쪽·위·시계 방향이 + 이고 소수 첫째 자리 도로 쓴다', () => {
    const view = aimCameraView(mixed.cameras[1]!, mixed);
    expect(view.steps).toEqual(['오른쪽으로 1.2°', '위로 0.4°']);
    expect(view.text).toBe('오른쪽으로 1.2° · 위로 0.4° 돌려 주세요');
    expect(view.aligned).toBe(false);
    expect(view.arrowRad).toBeCloseTo(-0.46);
    expect(
      aimSteps(item('cam_A', 'MISALIGNED', [-0.8, -0.3, 1.6]), {
        max_aim_rad: MAX_AIM,
        max_roll_rad: MAX_ROLL,
      }),
    ).toEqual(['왼쪽으로 0.8°', '아래로 0.3°', '시계 방향으로 1.6° (뒤에서 볼 때)']);
  });

  it('허용 오차 안인 축은 쓰지 않는다(광축은 크기로, 기울기는 따로)', () => {
    // 광축 0.1° 는 허용 오차 안, 기울기 −2.5° 만 밖
    expect(aimCameraView(mixed.cameras[3]!, mixed).steps).toEqual([
      '반시계 방향으로 2.5° (뒤에서 볼 때)',
    ]);
    // 광축 크기 0.28° > 0.25°: 좌우·상하 0.2° 를 둘 다 쓴다
    expect(
      aimSteps(item('cam_A', 'MISALIGNED', [0.2, 0.2, 0.0]), {
        max_aim_rad: MAX_AIM,
        max_roll_rad: MAX_ROLL,
      }),
    ).toEqual(['오른쪽으로 0.2°', '위로 0.2°']);
  });

  it('같음·모름 문장', () => {
    expect(aimCameraView(allAligned.cameras[0]!, allAligned).text).toBe(
      '기준과 같음 (재사용 가능)',
    );
    const unknown = aimCameraView(mixed.cameras[2]!, mixed);
    expect(unknown.text).toBe('돌려서는 맞출 수 없음 (위치가 바뀌었거나 가려짐)');
    expect(unknown.target).toBeNull();
    expect(
      aimCameraView(item('cam_A', 'UNKNOWN', null, { reason: 'NO_REFERENCE' }), mixed).text,
    ).toBe('기준 사진 없음');
  });

  it('4대 모두 ALIGNED 일 때만 모두 같음이다', () => {
    expect(allAimAligned(CAMS, aimViews(allAligned))).toBe(true);
    expect(allAimAligned(CAMS, aimViews(mixed))).toBe(false);
    expect(allAimAligned(CAMS, aimViews(check(allAligned.cameras.slice(0, 3))))).toBe(false);
    expect(allAimAligned(CAMS, aimViews(null))).toBe(false);
  });
});

describe('두 단계(초록 재사용 가능·노랑 새 맵 세팅엔 충분)', () => {
  const near = check([
    item('cam_A', 'ALIGNED', [0.05, 0.0, 0.1]),
    item('cam_B', 'NEAR', [0.4, 0.1, 0.0]),
    item('cam_C', 'NEAR', [0.0, 0.0, 2.0]),
    item('cam_D', 'ALIGNED', [0.0, 0.1, 0.0]),
  ]);

  it('노랑은 「새 맵 세팅엔 충분」과 재사용까지 남은 각도를 쓴다', () => {
    const view = aimCameraView(near.cameras[1]!, near);
    expect(view.text).toBe('새 맵 세팅엔 충분 · 재사용하려면 오른쪽으로 0.4° · 위로 0.1°');
    expect(view.setupReady).toBe(true);
    expect(view.aligned).toBe(false);
    expect(aimCameraView(near.cameras[2]!, near).text).toBe(
      '새 맵 세팅엔 충분 · 재사용하려면 시계 방향으로 2.0° (뒤에서 볼 때)',
    );
    expect(aimCameraView(mixed.cameras[1]!, mixed).setupReady).toBe(false);
  });

  it('4칸 모두 노랑 이상이면 「새 맵 세팅 시작해도 됨」, 모두 초록이면 「재사용도 안전」만', () => {
    expect(allAimSetupReady(CAMS, aimViews(near))).toBe(true);
    expect(allAimAligned(CAMS, aimViews(near))).toBe(false);
    expect(allAimSetupReady(CAMS, aimViews(mixed))).toBe(false);
    render(<CameraVideoPanel coverage={deriveStep1Coverage(response(near), false, CAMS)} />);
    expect(screen.getByTestId('aim-all-setup-ready').textContent).toBe(AIM_ALL_SETUP_READY_TEXT);
    expect(screen.queryByTestId('aim-all-aligned')).toBeNull();
    const tiles = screen.getAllByTestId('setup-camera-tile');
    expect(tiles.filter((t) => t.className.includes('after:ring-delay'))).toHaveLength(2);
    expect(tiles.filter((t) => t.className.includes('after:ring-ok'))).toHaveLength(2);
    cleanup();
    render(<CameraVideoPanel coverage={deriveStep1Coverage(response(allAligned), false, CAMS)} />);
    expect(screen.queryByTestId('aim-all-setup-ready')).toBeNull();
    expect(screen.getByTestId('aim-all-aligned')).toBeTruthy();
  });
});

describe('1단계 표시 모델', () => {
  it('지금 결과면 카메라마다 기준 시점 표시를 싣는다', () => {
    const coverage = deriveStep1Coverage(response(mixed), false, CAMS);
    expect(coverage.aimSceneVersion).toBe('scene-calibrated-1');
    expect(coverage.cameras.map((c) => c.aim?.status)).toEqual([
      'ALIGNED',
      'MISALIGNED',
      'UNKNOWN',
      'MISALIGNED',
    ]);
    expect(coverage.aimAllAligned).toBe(false);
    expect(deriveStep1Coverage(response(allAligned), false, CAMS).aimAllAligned).toBe(true);
  });

  it('오래된 결과면 각도·초록은 지우고 겹쳐 볼 기준 맵은 둔다', () => {
    const coverage = deriveStep1Coverage(response(allAligned, true), false, CAMS);
    expect(coverage.cameras.every((c) => c.aim === null)).toBe(true);
    expect(coverage.aimAllAligned).toBe(false);
    expect(coverage.aimSceneVersion).toBe('scene-calibrated-1');
  });

  it('기준이 없으면(옛 헬퍼·CALIBRATED 세팅 없음) 지금 화면 그대로', () => {
    const coverage = deriveStep1Coverage(
      coverageGuidesResponseSchema.parse({ status: 'OK', latest: buildCoverageGuidePayload() }),
      false,
      CAMS,
    );
    expect(coverage.aimSceneVersion).toBeNull();
    expect(coverage.aimAllAligned).toBe(false);
    expect(coverage.cameras.every((c) => c.aim === null)).toBe(true);
  });
});

describe('카메라 영상 칸', () => {
  it('허용 오차 안인 칸은 초록 테두리, 어긋난 칸은 화살표·목표 점·각도를 보인다', () => {
    render(<CameraVideoPanel coverage={deriveStep1Coverage(response(mixed), false, CAMS)} />);
    const tiles = screen.getAllByTestId('setup-camera-tile');
    const byAim = (status: string) => tiles.find((t) => t.dataset.aim === status)!;
    expect(byAim('ALIGNED').className).toContain('after:ring-ok');
    expect(byAim('MISALIGNED').className).not.toContain('after:ring-ok');
    expect(screen.getAllByTestId('aim-arrow')).toHaveLength(1); // cam_D 는 광축이 허용 오차 안이라 화살표 없음
    expect(screen.getAllByTestId('aim-target')).toHaveLength(3); // 모름(cam_C) 칸은 표시 없음
    const texts = screen.getAllByTestId('aim-text').map((t) => t.textContent);
    expect(texts).toContain('오른쪽으로 1.2° · 위로 0.4° 돌려 주세요');
    expect(texts).toContain('기준과 같음 (재사용 가능)');
    expect(screen.queryByTestId('aim-all-aligned')).toBeNull();
  });

  it('기준 사진 겹쳐 보기는 기본 끔이고 단추로 켜고 끈다', () => {
    render(<CameraVideoPanel coverage={deriveStep1Coverage(response(mixed), false, CAMS)} />);
    expect(reference.scenes).toContain('scene-calibrated-1');
    expect(screen.queryAllByTestId('aim-reference-image')).toHaveLength(0);
    const toggle = screen.getByRole('button', { name: AIM_OVERLAY_LABEL });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    const images = screen.getAllByTestId('aim-reference-image');
    expect(images).toHaveLength(4);
    expect(images.map((img) => img.getAttribute('src'))).toContain(
      'https://bucket.example/cam_B.jpg',
    );
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.queryAllByTestId('aim-reference-image')).toHaveLength(0);
  });

  it('4칸 모두 초록이면 「이전 맵 재사용도 안전」 한 줄을 보인다', () => {
    render(<CameraVideoPanel coverage={deriveStep1Coverage(response(allAligned), false, CAMS)} />);
    expect(screen.getByTestId('aim-all-aligned').textContent).toBe(AIM_ALL_ALIGNED_TEXT);
    expect(
      screen.getAllByTestId('setup-camera-tile').every((t) => t.className.includes('ring-ok')),
    ).toBe(true);
  });

  it('기준 시점을 아는 칸은 옆 쌍 꺾쇠 대신 기준 시점 표시만, 모르는 칸은 기존 꺾쇠를 둔다', () => {
    const guides: CoverageGuideItem[] = [
      {
        camera_id: 'cam_B',
        pair: ['cam_B', 'cam_C'],
        direction: 'RIGHT',
        magnitude: 'MORE',
        reason_code: 'WEAK_PAIR_EDGE_CLUSTER',
      },
      {
        camera_id: 'cam_C',
        pair: ['cam_B', 'cam_C'],
        direction: 'LEFT',
        magnitude: 'MORE',
        reason_code: 'WEAK_PAIR_EDGE_CLUSTER',
      },
    ];
    render(
      <CameraVideoPanel
        coverage={deriveStep1Coverage(response(mixed, false, guides), false, CAMS)}
      />,
    );
    const arrows = screen.getAllByTestId('camera-cue-arrow');
    expect(arrows.map((a) => a.dataset.direction)).toEqual(['LEFT']); // cam_C(모름)만
  });

  it('기준이 없으면 단추·표시가 없다(지금 화면 그대로)', () => {
    const coverage = deriveStep1Coverage(
      coverageGuidesResponseSchema.parse({ status: 'OK', latest: buildCoverageGuidePayload() }),
      false,
      CAMS,
    );
    render(<CameraVideoPanel coverage={coverage} />);
    expect(reference.scenes).toEqual([]);
    expect(screen.queryByRole('button', { name: AIM_OVERLAY_LABEL })).toBeNull();
    expect(screen.queryAllByTestId('aim-text')).toHaveLength(0);
  });

  it('기준 사진이 없으면 겹쳐 보기 단추를 숨기고 각도 표시는 둔다', () => {
    reference.urls = undefined;
    try {
      render(<CameraVideoPanel coverage={deriveStep1Coverage(response(mixed), false, CAMS)} />);
      expect(screen.queryByRole('button', { name: AIM_OVERLAY_LABEL })).toBeNull();
      expect(screen.getAllByTestId('aim-text').length).toBeGreaterThan(0);
    } finally {
      reference.urls = {
        cam_A: 'https://bucket.example/cam_A.jpg',
        cam_B: 'https://bucket.example/cam_B.jpg',
        cam_C: 'https://bucket.example/cam_C.jpg',
        cam_D: 'https://bucket.example/cam_D.jpg',
      };
    }
  });
});
