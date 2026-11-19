import { eventSections, mergeEvent, type EventEntry } from '@/features/events/events';
import type { EventItem } from '@/features/events/types';
import {
  EMPTY_TRACK_LIFE,
  noteWatched,
  noteWorldFrame,
  type TrackLifeState,
} from '@/lib/trackLife';
import { describe, expect, it } from 'vitest';

// 잠깐 생겼다 사라진 중복 트랙(유령 트랙)의 「지금 안 보임」 카드 접기(S15P31A101-785).

const T = 1_760_342_400_000;
const SEC = 1_000;

function entry(change: Partial<EventItem> = {}): EventEntry {
  return mergeEvent(undefined, {
    event_id: 'e-1',
    event_sequence: 1,
    rule_id: 'R4',
    source: 'LIVE',
    lifecycle: 'RAISED',
    verification: 'VERIFIED',
    severity: 'CAUTION',
    confidence: 'LOW',
    needs_check: true,
    world_ids: ['w-1'],
    zone_id: null,
    metrics: {},
    rationale: null,
    proposed_severity: null,
    raised_at: T,
    updated_at: T,
    ...change,
  });
}

type Track = { world_id: string; track_lifecycle: string; aliases?: string[] };

/**
 * [시작 초, 끝 초, ID, 병합한 ID] 구간으로 0.1초 프레임을 만든다. 0초부터 마지막 끝 + 1초까지 넣어 생긴 때·끝난 때를 모두 본다.
 */
function lifeOf(spans: [number, number, string, string[]?][], start = 0): TrackLifeState {
  const end = Math.max(...spans.map(([, to]) => to)) + 1;
  let state = EMPTY_TRACK_LIFE;
  for (let t = start; t <= end; t = Math.round((t + 0.1) * 10) / 10) {
    const tracks: Track[] = spans
      .filter(([from, to]) => from <= t && t <= to)
      .map(([, , id, aliases]) => ({ world_id: id, track_lifecycle: 'CONFIRMED', aliases }));
    state = noteWorldFrame(state, tracks as never, T + t * SEC);
  }
  return state;
}

const sections = (entries: EventEntry[], alive: string[], life: TrackLifeState) =>
  eventSections(entries, { alive: new Set(alive), life });

const keys = (cards: { incident: { key: string } }[]) => cards.map((c) => c.incident.key).sort();

describe('유령 트랙 카드 접기', () => {
  it('11-16: 실제 두 사람 곁에 몇 초 살다 사라진 번호의 카드는 진행 중에서 빠져 접힌 칸으로 간다', () => {
    const life = lifeOf([
      [0, 60, 'w-1'],
      [0, 60, 'w-2'],
      [5, 7, 'w-212'],
      [10, 30, 'w-231'],
    ]);
    const { active, ghost } = sections(
      [
        entry({ event_id: 'a', world_ids: ['w-1'] }),
        entry({ event_id: 'b', world_ids: ['w-212'], rule_id: 'R1', zone_id: 'z-04' }),
        entry({ event_id: 'c', world_ids: ['w-231'], rule_id: 'R3', zone_id: 'z-05' }),
      ],
      [],
      life,
    );
    expect(keys(active)).toEqual(['person:w-1']);
    expect(keys(ghost)).toEqual(['person:w-212', 'person:w-231']);
  });

  it('충분히 오래(30초 이상) 보였다 사라진 사람은 그대로 둔다', () => {
    const life = lifeOf([[2, 32, 'w-5']]);
    const { active, ghost } = sections([entry({ world_ids: ['w-5'] })], [], life);
    expect(keys(active)).toEqual(['person:w-5']);
    expect(ghost).toEqual([]);
  });

  it('언제 생겼는지 모르면(화면을 연 때 이미 있었음) 짧아 보여도 그대로 둔다', () => {
    const life = lifeOf([[0, 3, 'w-5']]);
    expect(life.lives['w-5']!.bornSeen).toBe(false);
    const { active, ghost } = sections([entry({ world_ids: ['w-5'] })], [], life);
    expect(keys(active)).toEqual(['person:w-5']);
    expect(ghost).toEqual([]);
  });

  it('이 브라우저가 본 적 없는 번호는 그대로 둔다', () => {
    const { active, ghost } = sections(
      [entry({ world_ids: ['w-7'] })],
      [],
      lifeOf([[1, 2, 'w-1']]),
    );
    expect(keys(active)).toEqual(['person:w-7']);
    expect(ghost).toEqual([]);
  });

  it('워치가 붙었던 사람은 잠깐 보였어도 그대로 둔다', () => {
    const life = noteWatched(lifeOf([[1, 3, 'w-5']]), ['w-5']);
    const { active, ghost } = sections([entry({ world_ids: ['w-5'] })], [], life);
    expect(keys(active)).toEqual(['person:w-5']);
    expect(ghost).toEqual([]);
  });

  it('확인 대기 경보(위험·경고, 확인 전)가 있으면 잠깐 보였어도 그대로 두고, 확인한 뒤에는 접는다', () => {
    const life = lifeOf([[1, 3, 'w-5']]);
    const alarm = entry({ world_ids: ['w-5'], severity: 'CRITICAL' });
    expect(keys(sections([alarm], [], life).active)).toEqual(['person:w-5']);
    const acked = entry({
      world_ids: ['w-5'],
      severity: 'CRITICAL',
      acks: [
        {
          ack_id: 'k',
          channel: 'CONTROL_ROOM',
          actor_role: 'ADMIN',
          actor_id: 'a',
          acked_at: T + SEC,
        },
      ],
    });
    expect(keys(sections([acked], [], life).ghost)).toEqual(['person:w-5']);
  });

  it('지금 보이는 사람의 카드와 사람 수를 모를 때(World 수신 전)는 접지 않는다', () => {
    const life = lifeOf([[1, 3, 'w-5']]);
    expect(sections([entry({ world_ids: ['w-5'] })], ['w-5'], life).ghost).toEqual([]);
    expect(eventSections([entry({ world_ids: ['w-5'] })], { alive: null, life }).ghost).toEqual([]);
  });

  it('기록을 주지 않으면 접지 않는다(지금 동작)', () => {
    expect(eventSections([entry({ world_ids: ['w-5'] })], { alive: new Set() }).ghost).toEqual([]);
  });

  it('병합으로 흡수된 번호는 흡수한 사람이 지금 보이면 접는다', () => {
    // w-9 가 w-1 에 합쳐졌다. 살아 있는 사람 집합에는 w-1 만 있다(지금 프레임의 aliases 에서 빠져도 병합 기록은 남는다)
    const life = lifeOf([
      [0, 120, 'w-1', ['w-9']],
      [10, 50, 'w-9'],
    ]);
    const { active, ghost } = sections([entry({ world_ids: ['w-9'] })], ['w-1'], life);
    expect(active).toEqual([]);
    expect(keys(ghost)).toEqual(['person:w-9']);
  });

  it('흡수한 사람도 사라졌으면 그 사람의 카드가 남을 때만 흡수된 번호의 카드를 접는다', () => {
    const merged = lifeOf([
      [2, 60, 'w-1', ['w-9']],
      [10, 50, 'w-9'],
    ]);
    const both = sections(
      [
        entry({ event_id: 'a', world_ids: ['w-1'] }),
        entry({ event_id: 'b', world_ids: ['w-9'], rule_id: 'R1', zone_id: 'z-04' }),
      ],
      [],
      merged,
    );
    expect(keys(both.active)).toEqual(['person:w-1']);
    expect(keys(both.ghost)).toEqual(['person:w-9']);
    // 흡수한 사람의 카드가 없으면 흡수된 번호의 카드가 그 사람을 대신하므로 남긴다(둘 다 흡수된 번호여도 서로 기대지 않는다)
    const twoAbsorbed = lifeOf([
      [2, 60, 'w-1', ['w-8', 'w-9']],
      [10, 40, 'w-8'],
      [10, 50, 'w-9'],
    ]);
    const alone = sections(
      [
        entry({ event_id: 'a', world_ids: ['w-8'] }),
        entry({ event_id: 'b', world_ids: ['w-9'], rule_id: 'R1', zone_id: 'z-04' }),
      ],
      [],
      twoAbsorbed,
    );
    expect(keys(alone.active)).toEqual(['person:w-8', 'person:w-9']);
    expect(alone.ghost).toEqual([]);
  });
});
