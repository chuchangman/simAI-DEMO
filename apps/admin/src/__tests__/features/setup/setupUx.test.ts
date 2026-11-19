import { cameraText } from '@/features/setup/cameraLabels';
import { failureGuide } from '@/features/setup/setupFailures';
import { draftPublishFailure, draftReason } from '@/features/setup/setupUx';
import {
  confirmUnchangedPlanItems,
  setupZonePlanViewSchema,
  unchangedPendingReviewCount,
} from '@/features/setup/setupZonePlan';
import { setupSessionResponseSchema, zoneDraftItemSchema } from '@/features/setup/types';
import {
  recordValidationAttempt,
  repeatedValidationPairs,
  useValidationRejections,
} from '@/features/setup/useValidationRejections';
import { zoneAiOpinionSchema } from '@/features/zones/types';
import { ApiError } from '@/lib/http';
import { buildDefaultZoneDraftItems } from '@/mocks/setup';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const IDS = ['cam_C', 'cam_A', 'cam_D', 'cam_B'];
const rejected = (
  id: string,
  message = "worsened_pairs=['cam_A-cam_B']",
  code = 'VALIDATION_REJECTED',
  workId = 1,
) =>
  setupSessionResponseSchema.parse({
    setup_session_id: id,
    site_id: 's',
    work_unit_id: workId,
    status: 'FAILED',
    stage: 'FAILED',
    progress_pct: 50,
    camera_heights_m: Object.fromEntries(IDS.map((id) => [id, 2.4])),
    failure_code: code,
    failure_message: message,
    started_at_ms: 1,
    updated_at_ms: 2,
  });

describe('세팅 재시도와 표시 근거(-732)', () => {
  it('같은 세션의 반복 조회는 한 번, 역순으로 온 같은 쌍의 두 번째 거부만 점검 안내한다', () => {
    const first = rejected('1');
    const { result, rerender } = renderHook(
      ({ session }) => useValidationRejections(session, IDS),
      { initialProps: { session: first } },
    );
    expect(result.current).toBe('');
    rerender({ session: { ...first } });
    expect(result.current).toBe('');
    rerender({ session: rejected('2', "worsened_pairs=['cam_B-cam_A']") });
    expect(result.current).toBe('카메라 4–카메라 2');
    const guide = failureGuide('VALIDATION_REJECTED', first.failure_message ?? null, IDS, [], {
      repeatedValidationPairs: result.current,
    });
    expect(guide.fix).toContain('두 번 연속');
    expect(guide.fix).toContain('거치대');
    expect(guide.retry).toBe(true);
  });

  it('다른 쌍·다른 원인·다른 작업·쌍 근거 없음이면 거치대 점검을 요구하지 않는다', () => {
    const first = recordValidationAttempt([], rejected('1'), IDS);
    for (const session of [
      rejected('2', "worsened_pairs=['cam_C-cam_D']"),
      rejected('2', '', 'TIMEOUT'),
      rejected('2', '', 'VALIDATION_REJECTED', 2),
      rejected('2', 'unknown'),
    ]) {
      expect(repeatedValidationPairs(recordValidationAttempt(first, session, IDS), IDS)).toBe('');
    }
    expect(failureGuide('VALIDATION_REJECTED', null, IDS).fix).not.toContain('거치대');
  });

  it('서버 문장 안 카메라 이름은 현재 번호 순서이며 ID 일부는 바꾸지 않는다', () => {
    expect(cameraText(IDS, 'cam_A-cam_B / cam_C / xcam_A / cam_A2')).toBe(
      '카메라 2-카메라 4 / 카메라 1 / xcam_A / cam_A2',
    );
    expect(cameraText([], 'cam_D')).toBe('카메라');
  });

  it.each(['MODIFY', 'REMOVE'])('AI %s 권고 구역은 변화 없음 일괄 확인에서 뺀다', (action) => {
    const plan = setupZonePlanViewSchema.parse({
      setup_session_id: 's',
      revision: 1,
      items: [
        {
          zone_id: 'z',
          source: 'MANUAL',
          needs_review: true,
          height_change: { zone_id: 'z', status: 'UNCHANGED' },
          ai_opinion: { status: 'OPINION', recommended_action: action },
        },
      ],
    });
    expect(plan.items[0]?.height_change?.status).toBe('UNCHANGED');
    expect(unchangedPendingReviewCount(plan)).toBe(0);
    expect(confirmUnchangedPlanItems(plan.items)).toBeNull();
    const keep = {
      ...plan,
      items: plan.items.map((item) => ({
        ...item,
        ai_opinion: zoneAiOpinionSchema.parse({ status: 'OPINION', recommended_action: 'KEEP' }),
      })),
    };
    expect(unchangedPendingReviewCount(keep)).toBe(1);
    expect(confirmUnchangedPlanItems(keep.items)?.[0]?.needs_review).toBe(false);
  });

  it('원인·다시 보낼 시점·계속 실패할 때 결과를 안내하고 서버 내부 원문은 보이지 않는다', () => {
    const text = draftPublishFailure(
      new ApiError(409, { code: 'CURRENT_CALIBRATION_MISSING', serverMessage: 'secret internal' }),
    );
    expect(text).toContain('유효한 카메라 보정이 없어요');
    expect(text).toContain('세팅 완료와 작업 시작 때 다시');
    expect(text).toContain('완료·시작도 멈추므로');
    expect(text).not.toContain('secret');
  });

  it('초안의 기본 근거는 수치 없는 한 문장이고 AI 의견 없음은 확인을 요청한다', () => {
    for (const raw of buildDefaultZoneDraftItems()) {
      const item = zoneDraftItemSchema.parse(raw);
      expect(draftReason(item)).not.toMatch(/%|Z |신뢰도|cam_/);
      expect(draftReason({ ...item, no_opinion: true })).toContain('현장과 비교');
    }
  });
});
