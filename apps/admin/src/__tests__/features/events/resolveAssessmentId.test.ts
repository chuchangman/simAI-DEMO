import { resolveAssessmentId } from '@/features/events/escalation';
import type { EventItem } from '@/features/events/types';
import { describe, expect, it } from 'vitest';

const base = {
  event_id: 'ev-1',
  event_sequence: 2,
  rule_id: 'R1',
  source: 'LIVE',
  lifecycle: 'RAISED',
  verification: 'VERIFIED',
  severity: 'HIGH',
  confidence: 'HIGH',
  needs_check: false,
  world_ids: [],
  zone_id: null,
  metrics: {},
  rationale: '근거',
  proposed_severity: 'CRITICAL',
} as EventItem;

describe('resolveAssessmentId', () => {
  it('서버 assessments 의 결정 전 상향 의견 ID 를 쓴다(-276 형식)', () => {
    const event = {
      ...base,
      assessments: [
        { assessment_id: 12, job_id: 'job-b', proposed_severity: 'CRITICAL', decision: 'NONE' },
        { assessment_id: 7, job_id: 'job-a', proposed_severity: 'CRITICAL', decision: 'REJECTED' },
      ],
    } as EventItem;
    expect(resolveAssessmentId(event)).toBe(12);
  });

  it('결정이 끝난 의견만 있으면 최상위 필드로 물러난다', () => {
    const event = {
      ...base,
      assessment_id: 'job-x',
      assessments: [{ assessment_id: 7, proposed_severity: 'CRITICAL', decision: 'APPROVED' }],
    } as EventItem;
    expect(resolveAssessmentId(event)).toBe('job-x');
  });
});
