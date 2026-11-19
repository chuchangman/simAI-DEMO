import { SEVERITY_RANK } from '@/features/events/constants';
import {
  acknowledgedAt,
  isAlarming,
  isCurrent,
  isStale,
  type EventEntry,
} from '@/features/events/entries';
import type { RingSeverity } from '@/lib/alarmSound';

export interface AlarmPlan {
  severity: RingSeverity;
  once: boolean;
  key: string;
  keys?: readonly string[];
}

/** 같은 사람·구역·규칙이 소리 낸 뒤 같거나 낮은 단계로 다시 걸려도 화면만 보이는 시간(ms, 사용자 결정 2026-11-05). Tier 0 `SOUND_COOLDOWN_MS` 와 같다. */
export const SOUND_COOLDOWN_MS = 60_000;
const ACK_QUIET_MS = 30_000;

/** 위험 이벤트는 그대로 두고 이 화면에서 소리 낸 단계·ACK 30초·소리 뒤 60초만 기억한다. 위험(CRITICAL)은 시간 억제를 받지 않는다. */
export function createAlarmPolicy() {
  const stages = new Map<string, { rank: number; allowed: boolean; once: boolean; key: string }>();
  const levels = new Map<string, { worlds: readonly string[]; rank: number }>();
  const acks = new Map<string, { at: number; rank: number }>();
  const sounded = new Map<string, { at: number; rank: number }>();
  const ackKey = (world: string, zone: string | null) => JSON.stringify([world, zone]);
  const soundKey = (world: string, zone: string | null, rule: string) =>
    JSON.stringify([world, zone, rule]);
  return (entries: readonly EventEntry[], canAck: boolean): AlarmPlan | null => {
    if (!canAck) return null;
    // 지금 Tier 0 가 들고 있지 않은 「지난 관제」 이벤트는 소리에도, 다른 경보를 누르는 확인 기록에도 쓰지 않는다(S15P31A101-595).
    const live = entries.filter(({ event }) => event.source === 'LIVE' && !isStale(event));
    const activeIds = new Set(
      live.filter(({ event }) => isCurrent(event)).map(({ event }) => event.event_id),
    );
    for (const id of levels.keys()) if (!activeIds.has(id)) levels.delete(id);
    for (const id of stages.keys()) if (!activeIds.has(id)) stages.delete(id);
    for (const entry of live) {
      const level = levels.get(entry.event.event_id);
      if (level) level.worlds = entry.event.world_ids;
      const at = acknowledgedAt(entry);
      if (at === null) continue;
      if (entry.event.lifecycle !== 'RESOLVED' && !levels.has(entry.event.event_id)) {
        levels.set(entry.event.event_id, {
          worlds: entry.event.world_ids,
          rank: SEVERITY_RANK[entry.event.severity],
        });
      }
      for (const world of entry.event.world_ids) {
        const key = ackKey(world, entry.event.zone_id);
        const prev = acks.get(key);
        if (!prev || at > prev.at) acks.set(key, { at, rank: SEVERITY_RANK[entry.event.severity] });
      }
    }
    // 같은 묶음에 들어온 경보는 높은 단계부터 판단한다.
    const alarms = live
      .filter(isAlarming)
      .sort(
        (a, b) =>
          SEVERITY_RANK[b.event.severity] - SEVERITY_RANK[a.event.severity] ||
          a.event.rule_id.localeCompare(b.event.rule_id),
      );
    const plans: AlarmPlan[] = [];
    for (const entry of alarms) {
      const event = entry.event;
      if (event.severity !== 'HIGH' && event.severity !== 'CRITICAL') continue;
      const rank = SEVERITY_RANK[event.severity];
      const key = `${event.event_id}:${event.resume_count ?? 0}:${entry.stageStartedAt ?? 'unknown'}:${event.severity}`;
      let stage = stages.get(event.event_id);
      if (stage?.key !== key) {
        const at = entry.stageStartedAt ?? event.raised_at ?? event.updated_at;
        const quietAllowed = event.severity !== 'CRITICAL';
        const blocked =
          [...levels.values()].some(
            (prior) => prior.rank >= rank && event.world_ids.some((w) => prior.worlds.includes(w)),
          ) ||
          (quietAllowed &&
            event.world_ids.some((world) => {
              const ack = acks.get(ackKey(world, event.zone_id));
              return (
                ack &&
                at !== undefined &&
                at >= ack.at &&
                at - ack.at < ACK_QUIET_MS &&
                rank <= ack.rank
              );
            })) ||
          (quietAllowed &&
            event.world_ids.some((world) => {
              const prior = sounded.get(soundKey(world, event.zone_id, event.rule_id));
              return (
                prior &&
                at !== undefined &&
                at >= prior.at &&
                at - prior.at < SOUND_COOLDOWN_MS &&
                rank <= prior.rank
              );
            }));
        stage = { rank, allowed: !blocked, once: event.rule_id === 'R3', key };
        stages.set(event.event_id, stage);
        if (!blocked) {
          levels.set(event.event_id, { worlds: event.world_ids, rank });
          if (at !== undefined) {
            for (const [key, prior] of sounded)
              if (at - prior.at >= SOUND_COOLDOWN_MS) sounded.delete(key);
            for (const world of event.world_ids)
              sounded.set(soundKey(world, event.zone_id, event.rule_id), { at, rank });
          }
        }
      }
      // 높은 단계가 새로 생겼으면 이전 낮은 소리도 돌아오지 않는다.
      if (
        [...levels.entries()].some(
          ([id, prior]) =>
            id !== event.event_id &&
            prior.rank > rank &&
            event.world_ids.some((w) => prior.worlds.includes(w)),
        )
      )
        stage.allowed = false;
      if (stage.allowed) plans.push({ severity: event.severity, once: stage.once, key });
    }
    // 반복 경보가 같은 등급의 1회 경보도 함께 알린다.
    plans.sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || Number(a.once) - Number(b.once),
    );
    const top = plans[0];
    if (!top?.once) return top ?? null;
    const keys = plans
      .filter((p) => p.once && p.severity === top.severity)
      .map((p) => p.key)
      .sort();
    return { ...top, key: keys.join('|'), keys };
  };
}
