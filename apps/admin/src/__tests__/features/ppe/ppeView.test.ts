import {
  evidenceAgeText,
  EXPIRED_REASON,
  itemStates,
  LINK_LOST_REASON,
  personPpe,
  ppeLabel,
  ppeLabels,
  withPpeLabels,
  type PersonPpe,
  type PpeItemDisplay,
} from '@/features/ppe/ppeView';
import { useRealtimeStore, type PpeSnapshot } from '@/store/realtime.store';
import type { PpeViewPayload } from '@simai/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

// 관제 화면 PPE 표시 규칙(명세 13.3, S15P31A101-531): 같은 World ID·identity_revision 에만, 만료·EC2 끊김이면 UNKNOWN.

const T = 1_760_342_400_000;

function payload(overrides: Partial<PpeViewPayload> = {}): PpeViewPayload {
  return {
    tier0_source_id: 'tier0-01',
    snapshot_at_ms: T,
    people: [
      {
        world_id: 'w-1',
        identity_revision: 2,
        capture_time_ms: T - 100,
        received_at_ms: T - 50,
        helmet: {
          state: 'WORN',
          reported_state: 'WORN',
          reason: 'WINDOW_WORN',
          last_evidence_at_ms: T - 100,
          expires_at_ms: T + 9_900,
        },
        vest: {
          state: 'UNKNOWN',
          reported_state: 'UNKNOWN',
          reason: 'NO_OBSERVATION',
          last_evidence_at_ms: null,
          expires_at_ms: null,
        },
      },
    ],
    ...overrides,
  };
}

const RECEIVED = 5_000;
const snapshots = (p = payload()): Record<string, PpeSnapshot> => ({
  [p.tier0_source_id]: { payload: p, receivedAt: RECEIVED },
});

describe('personPpe', () => {
  it('같은 World ID·차수면 보낸 상태와 근거 시각을 보인다', () => {
    const ppe = personPpe(snapshots(), 'w-1', 2, RECEIVED + 1_000, true);
    expect(ppe?.helmet).toEqual({
      state: 'WORN',
      reason: 'WINDOW_WORN',
      lastEvidenceAtMs: T - 100,
    });
    expect(ppe?.vest.state).toBe('UNKNOWN');
  });

  it('identity_revision 이 다르거나 없는 사람이면 붙이지 않는다(이전 ID 상태를 넘기지 않음)', () => {
    expect(personPpe(snapshots(), 'w-1', 3, RECEIVED, true)).toBeNull();
    expect(personPpe(snapshots(), 'w-9', 0, RECEIVED, true)).toBeNull();
  });

  it('다음 스냅샷 전이라도 expires_at_ms 가 지나면 UNKNOWN(EVIDENCE_EXPIRED)이다', () => {
    // 스냅샷 시각 T 에서 10초 지나 만료(T + 9_900)를 넘겼다
    const ppe = personPpe(snapshots(), 'w-1', 2, RECEIVED + 10_000, true);
    expect(ppe?.helmet).toEqual({
      state: 'UNKNOWN',
      reason: EXPIRED_REASON,
      lastEvidenceAtMs: T - 100,
    });
  });

  it('EC2 연결이 끊기면 UNKNOWN 이다', () => {
    const ppe = personPpe(snapshots(), 'w-1', 2, RECEIVED, false);
    expect(ppe?.helmet.state).toBe('UNKNOWN');
    expect(ppe?.helmet.reason).toBe(LINK_LOST_REASON);
  });

  it('EC2 가 이미 만료로 바꾼 값은 그대로 UNKNOWN 이다(보낸 값으로 되돌리지 않음)', () => {
    const p = payload();
    p.people[0]!.helmet = { ...p.people[0]!.helmet, state: 'UNKNOWN', reason: EXPIRED_REASON };
    expect(personPpe(snapshots(p), 'w-1', 2, RECEIVED, true)?.helmet.state).toBe('UNKNOWN');
  });
});

describe('이름표 PPE 글(ppeLabel, -656: 착용이 아닐 때만)', () => {
  const NOW = 100_000;
  const item = (
    state: PpeItemDisplay['state'],
    extra: Partial<PpeItemDisplay> = {},
  ): PpeItemDisplay => ({
    state,
    reason:
      state === 'WORN'
        ? 'WINDOW_WORN'
        : state === 'NOT_WORN'
          ? 'WINDOW_NOT_WORN'
          : 'NO_OBSERVATION',
    lastEvidenceAtMs: null,
    ...extra,
  });
  const ppe = (helmet: PpeItemDisplay, vest: PpeItemDisplay): PersonPpe => ({ helmet, vest });

  it('둘 다 착용이면 글이 없다(장비 실물이 보인다)', () => {
    expect(ppeLabel(ppe(item('WORN'), item('WORN')), NOW)).toBeNull();
  });

  it('미착용은 장비 이름으로, 둘 다면 한 번에 쓴다', () => {
    expect(ppeLabel(ppe(item('NOT_WORN'), item('WORN')), NOW)).toBe('안전모 미착용');
    expect(ppeLabel(ppe(item('NOT_WORN'), item('NOT_WORN')), NOW)).toBe('안전모·조끼 미착용');
  });

  it('모름은 마지막 근거 시각을 괄호로 붙이고, 근거가 없으면 붙이지 않는다', () => {
    const old = item('UNKNOWN', { reason: EXPIRED_REASON, lastEvidenceAtMs: NOW - 34_000 });
    expect(ppeLabel(ppe(old, old), NOW)).toBe('안전모·조끼 모름(30초 전)');
    expect(ppeLabel(ppe(item('UNKNOWN'), item('WORN')), NOW)).toBe('안전모 모름');
    expect(ppeLabel(ppe(old, item('UNKNOWN')), NOW)).toBe('안전모 모름(30초 전) · 조끼 모름');
  });

  it('미착용을 먼저, 모름을 뒤에 쓴다', () => {
    expect(ppeLabel(ppe(item('UNKNOWN'), item('NOT_WORN')), NOW)).toBe('조끼 미착용 · 안전모 모름');
  });

  it('EC2 연결이 끊긴 모름은 시각 대신 연결 끊김을 쓴다', () => {
    const lost = item('UNKNOWN', { reason: LINK_LOST_REASON, lastEvidenceAtMs: NOW - 5_000 });
    expect(ppeLabel(ppe(lost, lost), NOW)).toBe('안전모·조끼 모름(연결 끊김)');
  });

  it('경과 시각은 10초·1분·1시간 단위로 끊어 1초마다 바뀌지 않는다', () => {
    expect(evidenceAgeText(3_000)).toBe('방금');
    expect(evidenceAgeText(-1_000)).toBe('방금');
    expect(evidenceAgeText(19_999)).toBe('10초 전');
    expect(evidenceAgeText(59_000)).toBe('50초 전');
    expect(evidenceAgeText(125_000)).toBe('2분 전');
    expect(evidenceAgeText(3_700_000)).toBe('1시간 전');
  });

  it('트랙별로 모으고, 같은 차수·착용이 아닌 사람만 담는다', () => {
    // 스냅샷: w-1 안전모 착용·조끼 모름(근거 없음)
    expect(
      ppeLabels(snapshots(), [{ worldId: 'w-1', identityRevision: 2 }], RECEIVED, true),
    ).toEqual({
      'w-1': '조끼 모름',
    });
    expect(
      ppeLabels(snapshots(), [{ worldId: 'w-1', identityRevision: 3 }], RECEIVED, true),
    ).toEqual({});
    expect(
      ppeLabels(snapshots(), [{ worldId: 'w-1', identityRevision: 2 }], RECEIVED, false),
    ).toEqual({
      'w-1': '안전모·조끼 모름(연결 끊김)',
    });
  });

  it('워치 글 뒤에 이어 붙이고, 한쪽만 있으면 그것만 쓴다', () => {
    expect(
      withPpeLabels(
        { 'w-1': '워치 watch-01', 'w-2': '워치 watch-02' },
        { 'w-1': '안전모 미착용', 'w-3': '조끼 모름' },
      ),
    ).toEqual({
      'w-1': '워치 watch-01 · 안전모 미착용',
      'w-2': '워치 watch-02',
      'w-3': '조끼 모름',
    });
  });
});

describe('itemStates', () => {
  const tracks = [
    { worldId: 'w-1', identityRevision: 2 },
    { worldId: 'w-2', identityRevision: 0 },
  ];

  it('3D 에는 붙일 상태가 있는 사람만 담고, 안전모와 조끼를 따로 준다', () => {
    expect(itemStates(snapshots(), tracks, RECEIVED, true, 'helmet')).toEqual({ 'w-1': 'WORN' });
    expect(itemStates(snapshots(), tracks, RECEIVED, true, 'vest')).toEqual({ 'w-1': 'UNKNOWN' });
  });

  it('EC2 연결이 끊기면 둘 다 UNKNOWN 이고, 차수가 다른 사람은 담지 않는다', () => {
    expect(itemStates(snapshots(), tracks, RECEIVED, false, 'helmet')).toEqual({
      'w-1': 'UNKNOWN',
    });
    const stale = [{ worldId: 'w-1', identityRevision: 9 }];
    expect(itemStates(snapshots(), stale, RECEIVED, true, 'vest')).toEqual({});
  });
});

describe('receivePpe', () => {
  beforeEach(() => useRealtimeStore.setState(useRealtimeStore.getInitialState(), true));

  it('더 새 스냅샷만 받고 Tier 0 마다 따로 둔다', () => {
    const store = useRealtimeStore.getState();
    store.receivePpe({ payload: payload({ snapshot_at_ms: T + 1_000 }), receivedAt: 1 });
    store.receivePpe({ payload: payload({ snapshot_at_ms: T, people: [] }), receivedAt: 2 });
    store.receivePpe({ payload: payload({ tier0_source_id: 'tier0-02' }), receivedAt: 3 });
    const { ppe } = useRealtimeStore.getState();
    expect(ppe['tier0-01']?.payload.people).toHaveLength(1);
    expect(ppe['tier0-02']?.receivedAt).toBe(3);
  });

  it('새 세션(begin)이면 비운다', () => {
    useRealtimeStore.getState().receivePpe({ payload: payload(), receivedAt: 1 });
    useRealtimeStore.getState().begin();
    expect(useRealtimeStore.getState().ppe).toEqual({});
  });
});
