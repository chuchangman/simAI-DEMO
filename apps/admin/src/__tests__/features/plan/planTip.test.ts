import { resolvePersonDisplayMap } from '@/features/people/personDisplay';
import { planMarks, type PlanZone } from '@/features/plan/plan';
import { planTip } from '@/features/plan/planTip';
import type { WorldTrack } from '@simai/contracts';
import { describe, expect, it } from 'vitest';

// 2D 평면 말풍선 글자: 구역은 번호 없이 이름만 보인다.

const zone = (change: Partial<PlanZone> = {}): PlanZone => ({
  zoneId: 'z-04',
  name: '개구부 구역',
  min: [5.8, 1.2, 0],
  max: [8.6, 3.8, 2.4],
  ...change,
});

const tipOf = (z: PlanZone) => planTip(`zone:${z.zoneId}`, [], [z], planMarks([]))?.text;

describe('planTip 구역', () => {
  it('구역은 이름만 보이고 구역 번호는 보이지 않는다', () => {
    expect(tipOf(zone())).toBe('개구부 구역');
  });

  it('유형과 등급이 있으면 이름 뒤에 붙는다', () => {
    expect(tipOf(zone({ zoneType: 'OPENING', severity: 'HIGH' }))).toBe(
      '개구부 구역 · 개구부 · ▲ 경고',
    );
  });

  it('이름이 비었으면 `구역`이다', () => {
    expect(tipOf(zone({ name: '  ' }))).toBe('구역');
  });

  it('목록에 없는 구역이면 말풍선이 없다', () => {
    expect(planTip('zone:z-99', [], [zone()], planMarks([]))).toBeUndefined();
  });

  it('사람 말풍선은 해석된 표시 이름이 있으면 이름과 World ID 를 함께 보인다(-658)', () => {
    const track = {
      world_id: 'w-0012',
      observation_state: 'OBSERVED',
      track_lifecycle: 'CONFIRMED',
    } as unknown as WorldTrack;
    const map = resolvePersonDisplayMap({
      personNames: [{ world_id: 'w-0012', display_name: '김철수', name_source: 'WATCH_DEVICE' }],
    });
    expect(planTip('person:w-0012', [track], [], planMarks([]), map)?.text).toBe('김철수 (w-0012)');
  });
});
