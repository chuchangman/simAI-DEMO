import {
  heightCheckNotes,
  heightCheckPending,
  heightCheckSummary,
  heightCheckWaitNote,
  heightsChanged,
  heightSettled,
} from '@/features/setup/heightCheck';
import { deriveWaitingView } from '@/features/setup/setup';
import { setupSessionResponseSchema, type HeightReview } from '@/features/setup/types';
import { describe, expect, it } from 'vitest';

// 카메라 높이 빠른 확인(S15P31A101-690): 세션 응답 → 높이 확인 창 글·결과 화면 안내.

const CAMS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];

const review = (status: HeightReview['status']): HeightReview => ({
  status,
  max_relative_diff: 0.03,
  wait_s: 180,
  camera_heights_m: { cam_A: 2.45, cam_B: 2.44, cam_C: 2.48, cam_D: 2.48 },
  cameras: {
    cam_A: { restored_height_m: 2.39, difference_cm: -6, relative_diff: -0.0245, verdict: 'OK' },
    cam_B: { restored_height_m: 2.45, difference_cm: 1, relative_diff: 0.004, verdict: 'OK' },
    cam_C: { restored_height_m: 2.3, difference_cm: -18.4, relative_diff: -0.074, verdict: 'LOW' },
    cam_D: { restored_height_m: 2.6, difference_cm: 12.2, relative_diff: 0.049, verdict: 'HIGH' },
  },
});

const session = (patch: Record<string, unknown>) =>
  setupSessionResponseSchema.parse({
    setup_session_id: 's-1',
    site_id: 'classroom-1',
    work_unit_id: 3,
    status: 'INITIAL_POSE_AND_WORLD',
    progress_pct: 39,
    camera_heights_m: { cam_A: 2.45, cam_B: 2.44, cam_C: 2.48, cam_D: 2.48 },
    ...patch,
  });

describe('높이 확인 창 글', () => {
  it('카메라마다 맞음 또는 다른 카메라보다 약 n cm 낮게·높게 보임을 보인다', () => {
    expect(heightCheckNotes(review('AWAITING_CONFIRMATION'))).toEqual({
      cam_A: { text: '맞음', warn: false },
      cam_B: { text: '맞음', warn: false },
      cam_C: { text: '다른 카메라보다 약 18 cm 낮게 보임', warn: true },
      cam_D: { text: '다른 카메라보다 약 12 cm 높게 보임', warn: true },
    });
    expect(heightCheckSummary(review('AWAITING_CONFIRMATION'), CAMS)).toContain(
      '카메라 3, 카메라 4 높이가 다른 카메라와 맞지 않습니다',
    );
    expect(heightCheckWaitNote(review('AWAITING_CONFIRMATION'))).toBe(
      '약 3분 안에 답하지 않으면 입력한 높이로 진행합니다.',
    );
    expect(heightCheckWaitNote({ ...review('PASSED'), wait_s: undefined })).toBeNull();
  });

  it('입력 칸이 워커가 쓰는 높이와 다를 때만 고친 값이다', () => {
    const current = { cam_A: 2.45, cam_B: 2.44 };
    expect(heightsChanged(current, { cam_A: 2.45, cam_B: 2.44 })).toBe(false);
    expect(heightsChanged(current, { cam_A: 2.45, cam_B: 2.5 })).toBe(true);
  });
});

describe('세션 → 창·결과 화면', () => {
  it('워커가 기다리고 결정이 없을 때만 창을 띄운다', () => {
    const waiting = session({
      paused_reason: 'HEIGHT_CHECK',
      height_review: review('AWAITING_CONFIRMATION'),
    });
    expect(heightCheckPending(waiting)).toBe(true);
    expect(deriveWaitingView(waiting).heightCheckPending).toBe(true);
    expect(
      heightCheckPending(
        session({ paused_reason: null, height_review: review('AWAITING_CONFIRMATION') }),
      ),
    ).toBe(false);
    expect(
      heightCheckPending(
        session({
          status: 'FAILED',
          paused_reason: 'HEIGHT_CHECK',
          height_review: review('AWAITING_CONFIRMATION'),
        }),
      ),
    ).toBe(false);
    // 모르는 모양은 없는 것으로 본다(창을 띄우지 않는다)
    expect(session({ height_review: { status: 'WHATEVER' } }).height_review).toBeNull();
  });

  it('앞에서 확인한 높이(맞음·실측 확인·수정)는 결과 화면이 다시 고치라고 하지 않는다. 시간 초과는 그대로 알린다', () => {
    const mismatch = {
      progress_pct: 65,
      status: 'JOINT_BA_AND_VERIFY',
      height_checks: {
        cam_C: {
          input_height_m: 2.48,
          restored_height_m: 2.3,
          difference_cm: -18,
          within_tolerance: false,
        },
      },
    };
    for (const status of ['PASSED', 'CONFIRMED', 'CORRECTED'] as const) {
      const s = session({ ...mismatch, height_review: review(status) });
      expect(heightSettled(s)).toBe(true);
      expect(deriveWaitingView(s).showHeightNotice).toBe(false);
    }
    const timedOut = session({ ...mismatch, height_review: review('TIMED_OUT') });
    expect(heightSettled(timedOut)).toBe(false);
    expect(deriveWaitingView(timedOut).showHeightNotice).toBe(true);
  });
});
