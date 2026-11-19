import {
  formatPersonFull,
  formatPersonShort,
  formatWatchBindHighlight,
  formatWatchBindNotice,
  normalizeDisplayName,
  resolvePersonDisplayMap,
  workerLabel,
} from '@/features/people/personDisplay';
import { buildPersonLabelCells } from '@/features/people/personLabelCells';
import {
  overridesOf,
  usePersonNameOverrideStore,
} from '@/features/people/personNameOverride.store';
import { createPeopleNamesMock } from '@/mocks/peopleNames';
import { afterEach, describe, expect, it } from 'vitest';

describe('normalizeDisplayName 입력 검증(-658)', () => {
  it('앞뒤 공백을 제거하고 1~20자 표시 이름을 통과시킨다', () => {
    expect(normalizeDisplayName('  김철수  ')).toEqual({ ok: true, value: '김철수' });
    expect(normalizeDisplayName('가'.repeat(20))).toEqual({ ok: true, value: '가'.repeat(20) });
  });

  it('빈 값·20자 초과·제어문자·서식문자를 거부한다', () => {
    expect(normalizeDisplayName('   ').ok).toBe(false);
    expect(normalizeDisplayName('가'.repeat(21)).ok).toBe(false);
    expect(normalizeDisplayName('김\n철수').ok).toBe(false);
    expect(normalizeDisplayName('김\t철수').ok).toBe(false);
    expect(normalizeDisplayName('김\u200B철수').ok).toBe(false);
  });
});

describe('단일 사람 표시 어댑터 resolvePersonDisplayMap(-658)', () => {
  afterEach(() => {
    usePersonNameOverrideStore.getState().reset();
  });

  it('우선순위 WORLD_MANUAL > WATCH_DEVICE > UNIDENTIFIED > FALLBACK 순서로 해석한다', () => {
    const map = resolvePersonDisplayMap({
      activeWorldIds: ['w-1', 'w-2', 'w-3', 'w-4'],
      watchRows: [
        { deviceId: 'watch-01', connected: true, worldId: 'w-1' },
        { deviceId: 'watch-02', connected: false, worldId: 'w-2' },
      ],
      watchNames: [
        { device_id: 'watch-01', display_name: '워치이름1' },
        { device_id: 'watch-02', display_name: '이영희' },
      ],
      personNames: [
        { world_id: 'w-1', display_name: '관리자지정', name_source: 'WORLD_MANUAL' },
        { world_id: 'w-2', display_name: '이영희', name_source: 'WATCH_DEVICE' },
        { world_id: 'w-3', display_name: '미확인 1', name_source: 'UNIDENTIFIED' },
      ],
    });

    expect(map['w-1']).toMatchObject({
      displayName: '관리자지정',
      nameSource: 'WORLD_MANUAL',
      watch: { status: 'connected', deviceId: 'watch-01' },
    });
    expect(map['w-2']).toMatchObject({
      displayName: '이영희',
      nameSource: 'WATCH_DEVICE',
      watch: { status: 'disconnected', deviceId: 'watch-02' },
    });
    expect(map['w-3']).toMatchObject({
      // 서버의 자동 번호 이름은 화면에서 「작업자 #N」(S15P31A101-731: 확인 상태 배지 「미확인」과 헷갈렸다)
      displayName: '작업자 #1',
      nameSource: 'UNIDENTIFIED',
      watch: { status: 'none', deviceId: null },
    });
    expect(map['w-4']).toMatchObject({
      displayName: '미확인',
      nameSource: 'FALLBACK',
      watch: { status: 'none', deviceId: null },
    });
  });

  it('동명이인이 함께 있으면 isDuplicateName 이 켜지고 텍스트 목록에서는 구분자를 붙인다', () => {
    const map = resolvePersonDisplayMap({
      activeWorldIds: ['w-0012', 'w-0015'],
      watchRows: [{ deviceId: 'watch-01', connected: true, worldId: 'w-0012' }],
      personNames: [
        { world_id: 'w-0012', display_name: '김철수', name_source: 'WATCH_DEVICE' },
        { world_id: 'w-0015', display_name: '김철수', name_source: 'WORLD_MANUAL' },
      ],
    });

    expect(map['w-0012']?.isDuplicateName).toBe(true);
    expect(map['w-0015']?.isDuplicateName).toBe(true);
    expect(formatPersonShort('w-0012', map)).toBe('김철수 (0012)');
    expect(formatPersonFull('w-0012', map)).toBe('김철수 (w-0012)');
    expect(formatWatchBindHighlight(map['w-0012']!.displayName)).toBe('⌚ 김철수 연결됨');
    expect(formatWatchBindNotice(map['w-0012']!, '자동')).toBe('⌚ 김철수(watch-01) 연결됨(자동)');
  });

  it('낙관적 갱신은 즉시 반영되고 실패 시 롤백되며 서버 health 동기화 후 정리된다', () => {
    const store = usePersonNameOverrideStore.getState();
    const rollback = store.beginWatchOverride('watch-01', { kind: 'SET', displayName: '홍길동' });

    const optimistic = resolvePersonDisplayMap({
      watchRows: [{ deviceId: 'watch-01', connected: true, worldId: 'w-1' }],
      watchNames: [{ device_id: 'watch-01', display_name: '작업자 A' }],
      watchOverrides: overridesOf(usePersonNameOverrideStore.getState().watchEntries),
    });
    expect(optimistic['w-1']?.displayName).toBe('홍길동');

    rollback();
    expect(usePersonNameOverrideStore.getState().watchEntries).toEqual({});

    store.beginWatchOverride('watch-01', { kind: 'SET', displayName: '김철수' });
    store.confirmWatchOverride('watch-01', { kind: 'SET', displayName: '김철수' });
    store.reconcile([{ device_id: 'watch-01', display_name: '김철수' }], []);
    expect(usePersonNameOverrideStore.getState().watchEntries).toEqual({});
  });
});

describe('이름 없는 사람 표시(S15P31A101-731)', () => {
  it('서버 자동 번호 이름 「미확인 N」은 「작업자 #N」, 그 밖의 이름은 그대로다', () => {
    expect(workerLabel('미확인 205')).toBe('작업자 #205');
    expect(workerLabel('미확인205')).toBe('작업자 #205');
    expect(workerLabel('김철수')).toBe('김철수');
    expect(workerLabel('미확인')).toBe('미확인');
  });

  it('이름 목록이 없으면 짧은 표시는 「작업자 #끝번호」이고 전체 표시는 World ID 그대로다', () => {
    expect(formatPersonShort('w-mw8y3hai-0722')).toBe('작업자 #0722');
    expect(formatPersonFull('w-mw8y3hai-0722')).toBe('w-mw8y3hai-0722');
  });

  it('같은 자동 번호가 둘이어도 짧은 표시에는 괄호 번호를 붙이지 않는다(S15P31A101-757)', () => {
    const map = resolvePersonDisplayMap({
      activeWorldIds: ['w-a-0060', 'w-b-0061'],
      personNames: [
        { world_id: 'w-a-0060', name_source: 'UNIDENTIFIED', display_name: '미확인 60' },
        { world_id: 'w-b-0061', name_source: 'UNIDENTIFIED', display_name: '미확인 60' },
      ],
    });
    expect(formatPersonShort('w-a-0060', map)).toBe('작업자 #60');
    expect(formatPersonFull('w-a-0060', map)).toBe('작업자 #60 (w-a-0060)');
  });
});

describe('3D 이름표 칸 목록 조립 buildPersonLabelCells(-658 A안)', () => {
  it('연결·끊김·미배정 3상태와 PPE 칸을 배열로 조립하며 World ID·기기 ID·워치 단어를 넣지 않는다', () => {
    const map = resolvePersonDisplayMap({
      activeWorldIds: ['w-0012', 'w-0015', 'w-0021'],
      watchRows: [
        { deviceId: 'watch-01', connected: true, worldId: 'w-0012' },
        { deviceId: 'watch-02', connected: false, worldId: 'w-0015' },
      ],
      personNames: [
        { world_id: 'w-0012', display_name: '김철수', name_source: 'WATCH_DEVICE' },
        { world_id: 'w-0015', display_name: '이영희', name_source: 'WATCH_DEVICE' },
        { world_id: 'w-0021', display_name: '미확인 1', name_source: 'UNIDENTIFIED' },
      ],
    });
    const cells = buildPersonLabelCells(map, {
      'w-0015': '안전모 미착용 · 조끼 모름(30초 전)',
    });

    expect(cells['w-0012']).toEqual([
      { kind: 'watch', status: 'connected' },
      { kind: 'text', text: '김철수' },
    ]);
    expect(cells['w-0015']).toEqual([
      { kind: 'watch', status: 'disconnected' },
      { kind: 'text', text: '이영희' },
      { kind: 'text', text: '안전모 미착용' },
      { kind: 'text', text: '조끼 모름(30초 전)' },
    ]);
    expect(cells['w-0021']).toEqual([{ kind: 'text', text: '작업자 #1' }]);

    const serialized = JSON.stringify(Object.values(cells));
    expect(serialized).not.toContain('w-00');
    expect(serialized).not.toContain('watch-0');
    expect(serialized).not.toContain('워치');
  });
});

describe('목업 createPeopleNamesMock(-658)', () => {
  it('초기 스냅샷은 연결·끊김·미확인 3상태를 싣고 새 워치 배정 시 이름을 이어간다', () => {
    const mock = createPeopleNamesMock(() => 1_760_342_500_000);
    const snap1 = mock.snapshotAt(1_760_342_500_000);
    expect(snap1.personNames).toEqual([
      { world_id: 'w-0012', display_name: '김철수', name_source: 'WATCH_DEVICE' },
      { world_id: 'w-0015', display_name: '이영희', name_source: 'WATCH_DEVICE' },
      { world_id: 'w-0021', display_name: '미확인 1', name_source: 'UNIDENTIFIED' },
    ]);

    mock.bindWatch('watch-03', 'w-0021');
    const snap2 = mock.snapshotAt(1_760_342_501_000);
    expect(snap2.personNames.find((p) => p.world_id === 'w-0021')).toEqual({
      world_id: 'w-0021',
      display_name: '박민수',
      name_source: 'WATCH_DEVICE',
    });
  });
});
