import { mergeEvent, type EventEntry } from '@/features/events/events';
import type { EventItem } from '@/features/events/types';
import {
  markFor,
  planMarks,
  ROOM,
  severityTone,
  sigmaRadius,
  toPlan,
  trackIds,
  trackLook,
} from '@/features/plan/plan';
import { describe, expect, it } from 'vitest';

const T = 1_760_342_400_000;

function entry(change: Partial<EventItem> = {}): EventEntry {
  return mergeEvent(undefined, {
    event_id: 'e-1',
    event_sequence: 1,
    rule_id: 'R2',
    source: 'LIVE',
    lifecycle: 'RAISED',
    verification: 'VERIFIED',
    severity: 'CRITICAL',
    confidence: 'HIGH',
    needs_check: false,
    world_ids: ['w-1'],
    zone_id: 'z-04',
    metrics: {},
    rationale: null,
    proposed_severity: null,
    raised_at: T,
    updated_at: T,
    ...change,
  });
}

describe('평면 좌표', () => {
  it('World +Y 가 화면 위쪽이 되게 뒤집는다', () => {
    expect(toPlan(0, 0)).toEqual([0, ROOM.depth]);
    expect(toPlan(2, ROOM.depth)).toEqual([2, 0]);
  });
});

describe('사람 모양', () => {
  it('관측·예측·확인 불가로 나누고, LOST 는 확인 불가로 본다', () => {
    expect(trackLook({ observation_state: 'OBSERVED', track_lifecycle: 'CONFIRMED' })).toBe(
      'observed',
    );
    expect(trackLook({ observation_state: 'PREDICTED', track_lifecycle: 'OCCLUDED' })).toBe(
      'predicted',
    );
    expect(trackLook({ observation_state: 'UNKNOWN', track_lifecycle: 'OCCLUDED' })).toBe(
      'unknown',
    );
    expect(trackLook({ observation_state: 'OBSERVED', track_lifecycle: 'LOST' })).toBe('unknown');
  });

  it('작은 위치 불확실성은 그리지 않는다', () => {
    expect(sigmaRadius({ position_xy_sigma: [0.08, 0.1] })).toBeNull();
    expect(sigmaRadius({ position_xy_sigma: [0.2, 1.4] })).toBe(1.4);
  });
});

describe('planMarks', () => {
  it('지금 Tier 0 가 들고 있지 않은 지난 관제 이벤트는 표시하지 않는다(S15P31A101-595)', () => {
    const marks = planMarks([
      entry({ event_id: 'old', severity: 'CRITICAL', zone_id: 'z-04', held_by_tier0: false }),
      entry({
        event_id: 'now',
        severity: 'HIGH',
        world_ids: ['w-2'],
        zone_id: null,
        held_by_tier0: true,
      }),
    ]);
    expect(marks.people.get('w-1')).toBeUndefined();
    expect(marks.zones.get('z-04')).toBeUndefined();
    expect(marks.people.get('w-2')).toEqual({ severity: 'HIGH', alarming: true });
  });

  it('사람·구역마다 진행 중 이벤트 중 가장 높은 등급과 확인 대기 여부를 모은다', () => {
    const marks = planMarks([
      entry({ event_id: 'a', severity: 'HIGH', zone_id: 'z-02' }),
      entry({ event_id: 'b', severity: 'CRITICAL', zone_id: 'z-04' }),
      entry({ event_id: 'c', severity: 'CAUTION', world_ids: ['w-2'], zone_id: null }),
    ]);
    expect(marks.people.get('w-1')).toEqual({ severity: 'CRITICAL', alarming: true });
    expect(marks.people.get('w-2')).toEqual({ severity: 'CAUTION', alarming: false });
    expect(marks.zones.get('z-02')).toEqual({ severity: 'HIGH', alarming: true });
  });

  it('해소된 이벤트와 INFO 는 표시하지 않고, 확인한 경보는 확인 대기가 아니다', () => {
    const acked = entry({
      acks: [
        {
          ack_id: 'k',
          channel: 'CONTROL_ROOM',
          actor_role: 'ADMIN',
          actor_id: 'a',
          acked_at: T + 1,
        },
      ],
      updated_at: T + 1,
    });
    const marks = planMarks([
      acked,
      entry({ event_id: 'r', lifecycle: 'RESOLVED', world_ids: ['w-9'] }),
      entry({ event_id: 'i', severity: 'INFO', world_ids: ['w-8'] }),
    ]);
    expect(marks.people.get('w-1')).toEqual({ severity: 'CRITICAL', alarming: false });
    expect(marks.people.has('w-9')).toBe(false);
    expect(marks.people.has('w-8')).toBe(false);
  });

  it('병합으로 합쳐진 이전 ID(aliases)에 걸린 경보도 그 사람에게 보인다', () => {
    const marks = planMarks([
      entry({ event_id: 'a', severity: 'HIGH', world_ids: ['w-old'] }),
      entry({ event_id: 'b', severity: 'CAUTION', world_ids: ['w-new'], zone_id: null }),
    ]);
    const ids = trackIds({ world_id: 'w-new', aliases: ['w-old'] });
    expect(ids).toEqual(['w-new', 'w-old']);
    expect(markFor(marks.people, ids)).toEqual({ severity: 'HIGH', alarming: true });
    expect(markFor(marks.people, trackIds({ world_id: 'w-none' }))).toBeUndefined();
  });

  it('색은 위험 빨강, 경고 주황, 주의 노랑이고 안내는 색이 없다', () => {
    expect(severityTone('CRITICAL')).toBe('critical');
    expect(severityTone('HIGH')).toBe('high');
    expect(severityTone('CAUTION')).toBe('caution');
    expect(severityTone('INFO')).toBeUndefined();
  });
});
