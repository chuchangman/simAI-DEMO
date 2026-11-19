import {
  CAPTURE_SECONDS,
  captureCollecting,
  captureFailed,
  captureStatusText,
  deriveCaptureView,
  remainingSeconds,
} from '@/features/setup/backgroundCapture';
import { setupSessionResponseSchema, type SetupSessionResponse } from '@/features/setup/types';
import { describe, expect, it } from 'vitest';

const IDS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];

function session(patch: Record<string, unknown> = {}): SetupSessionResponse {
  return setupSessionResponseSchema.parse({
    setup_session_id: 's-1',
    site_id: 'site',
    work_unit_id: 1,
    status: 'COLLECTING_BACKGROUND',
    progress_pct: 0,
    camera_heights_m: { cam_A: 2.4, cam_B: 2.4, cam_C: 2.4, cam_D: 2.4 },
    ...patch,
  });
}

const CAPTURE = {
  since_ms: 1_000,
  required_samples: 12,
  cameras: {
    cam_A: { state: 'READY', sample_count: 13 },
    cam_B: { state: 'INSUFFICIENT_SAMPLES', sample_count: 3 },
    cam_C: { state: 'PERSON_OCCLUDED', sample_count: 6, person_visible: true },
    cam_D: { state: 'NO_VIDEO', sample_count: 0, person_visible: null },
  },
};

describe('배경 촬영 창 모양(S15P31A101-686)', () => {
  it('시작 전·시작 중·촬영 중·못 찍고 끝남을 가른다', () => {
    expect(deriveCaptureView(null, IDS, false).phase).toBe('ready');
    expect(deriveCaptureView(null, IDS, true).phase).toBe('starting');
    expect(deriveCaptureView(session(), IDS, false).phase).toBe('capturing');
    const failed = session({ status: 'FAILED', failure_code: 'BACKGROUND_INCOMPLETE' });
    expect(captureFailed(failed) && !captureCollecting(failed)).toBe(true);
    expect(deriveCaptureView(failed, IDS, false).phase).toBe('failed');
    // 다른 까닭으로 끝난 세션은 배경 촬영 실패가 아니다
    expect(captureFailed(session({ status: 'FAILED', failure_code: 'VALIDATION_REJECTED' }))).toBe(
      false,
    );
    expect(captureCollecting(session({ status: 'INITIAL_POSE_AND_WORLD' }))).toBe(false);
  });

  it('카메라별 상태를 사용자 말과 진행으로 바꾸고 다시 찍을 카메라를 모은다', () => {
    const view = deriveCaptureView(session({ background_capture: CAPTURE }), IDS, false);
    expect(view.cameras.map((c) => [c.label, c.state, c.title, c.hint])).toEqual([
      ['카메라 1', 'READY', '완료', null],
      ['카메라 2', 'INSUFFICIENT_SAMPLES', '촬영 중 3/12', null],
      [
        '카메라 3',
        'PERSON_OCCLUDED',
        '카메라 3 앞에 사람이 보입니다',
        '화면 밖으로 이동하면 촬영을 이어갑니다',
      ],
      ['카메라 4', 'NO_VIDEO', '영상이 들어오지 않습니다', '카메라 전원과 연결을 확인해 주세요'],
    ]);
    expect(view.cameras.map((c) => c.progress)).toEqual([1, 0.25, 0.5, 0]);
    expect(view.blockedLabels).toEqual(['카메라 3', '카메라 4']);
  });

  it('워커가 아직 알리지 않았으면 준비 중이고, 어긋난 응답은 버린다', () => {
    const view = deriveCaptureView(session(), IDS, false);
    expect(new Set(view.cameras.map((c) => c.state))).toEqual(new Set(['WAITING']));
    const bad = session({ background_capture: { since_ms: 1, required_samples: 0, cameras: {} } });
    expect(bad.background_capture).toBeNull();
  });

  it('카운트다운은 시작 시각부터 초 단위로 줄고 0 아래로 내려가지 않는다', () => {
    expect(remainingSeconds(null, 5_000)).toBe(CAPTURE_SECONDS);
    expect(remainingSeconds(1_000, 1_999)).toBe(CAPTURE_SECONDS);
    expect(remainingSeconds(1_000, 6_000)).toBe(CAPTURE_SECONDS - 5);
    expect(remainingSeconds(1_000, 60_000)).toBe(0);
  });
});

describe('배경 촬영 상태 한 줄(S15P31A101-719)', () => {
  const capturing = (cameras: Record<string, { state: string; sample_count: number }>) =>
    deriveCaptureView(
      session({ background_capture: { since_ms: 1_000, required_samples: 12, cameras } }),
      IDS,
      false,
    );

  it('카운트다운이 끝나도 덜 찍은 카메라가 있으면 그 이름을 보인다', () => {
    const view = capturing({
      cam_A: { state: 'READY', sample_count: 13 },
      cam_B: { state: 'INSUFFICIENT_SAMPLES', sample_count: 8 },
      cam_C: { state: 'READY', sample_count: 12 },
      cam_D: { state: 'INSUFFICIENT_SAMPLES', sample_count: 3 },
    });
    expect(view.pendingLabels).toEqual(['카메라 2', '카메라 4']);
    expect(captureStatusText(view, 0, false)).toBe(
      '아직 찍는 중: 카메라 2, 카메라 4. 그 카메라 앞을 비우고 조금만 더 기다려 주세요.',
    );
    expect(captureStatusText(view, 5, false)).toBe('촬영 중입니다. 화면 밖에서 기다려 주세요.');
  });

  it('사람 가림·영상 없음이 먼저고, 못 찍고 끝나면 가린 카메라가 없을 때 덜 찍은 카메라를 보인다', () => {
    const blocked = deriveCaptureView(session({ background_capture: CAPTURE }), IDS, false);
    expect(captureStatusText(blocked, 0, false)).toBe(
      '카메라 3, 카메라 4만 이어서 찍습니다. 다른 카메라는 그대로 찍고 있습니다.',
    );
    const failed = deriveCaptureView(
      session({
        status: 'FAILED',
        failure_code: 'BACKGROUND_INCOMPLETE',
        background_capture: {
          since_ms: 1_000,
          required_samples: 12,
          cameras: {
            cam_A: { state: 'READY', sample_count: 13 },
            cam_B: { state: 'INSUFFICIENT_SAMPLES', sample_count: 4 },
            cam_C: { state: 'READY', sample_count: 13 },
            cam_D: { state: 'READY', sample_count: 13 },
          },
        },
      }),
      IDS,
      false,
    );
    expect(captureStatusText(failed, 0, false)).toBe(
      '배경을 다 찍지 못했습니다: 카메라 2. 화면을 비운 뒤 다시 찍어 주세요.',
    );
  });

  it('응답에 촬영 정보가 없으면 덜 찍은 카메라를 지어내지 않는다', () => {
    const view = deriveCaptureView(session(), IDS, false);
    expect(view.pendingLabels).toEqual([]);
    expect(captureStatusText(view, 0, false)).toBe('거의 다 찍었습니다. 조금만 더 기다려 주세요.');
  });
});
