import { ec2Now } from '@/features/events/format';
import {
  endPhase,
  monitoringPhase,
  startPhase,
  tier0LinkOf,
  type MonitoringPhase,
  type Tier0Link,
} from '@/features/monitor/monitoringPhase';
import { useMonitorWorks } from '@/features/monitor/useMonitorWorks';
import { useRecentBundles } from '@/features/zones/useRecentBundles';
import { useLinkAlive } from '@/hooks/useLinkAlive';
import { useRealtimeStore } from '@/store/realtime.store';
import { useEffect, useState } from 'react';

// 관제 단계(monitoringPhase)를 화면에 잇는 훅(S15P31A101-692). health 는 1초마다 새 객체라 연결 상태 글자만 구독하고,
// 지연 경계는 매 초 다시 그리지 않고 그 시각에 한 번 깨운다.

/** EC2 ↔ Tier 0 연결. EC2 와 끊겼으면(health 가 낡음) 모른다. 값이 바뀔 때만 다시 그린다. */
export function useTier0Link(): Tier0Link {
  const alive = useLinkAlive();
  return useRealtimeStore((s) => tier0LinkOf(alive ? s.health?.payload : undefined));
}

/**
 * 판정에 쓸 지금 시각(EC2 ms)과, 판정이 알려 준 다음 경계(recheckAt)에 다시 그리게 하는 함수. 경계가 없으면 타이머를 두지 않는다.
 * 시계 차이(clockOffsetMs)는 health 마다 조금씩 바뀌므로 구독하지 않고 그 순간 값을 읽는다(매 초 다시 그리지 않게).
 */
function usePhaseClock(): [number, (recheckAt: number | null) => void] {
  const [now, setNow] = useState(() => Date.now());
  const [recheckAt, setRecheckAt] = useState<number | null>(null);
  useEffect(() => {
    if (recheckAt === null) return undefined;
    const offset = useRealtimeStore.getState().health?.clockOffsetMs;
    const wait = Math.max(0, recheckAt - ec2Now(Date.now(), offset)) + 50;
    const id = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(id);
    // now 도 본다: 타이머가 경계보다 조금 일찍 깨워 경계가 그대로면 다시 건다
  }, [recheckAt, now]);
  return [ec2Now(now, useRealtimeStore.getState().health?.clockOffsetMs), setRecheckAt];
}

/** 판정 결과의 다음 경계를 시계에 알린다(렌더 중이 아니라 effect 에서). */
function useRecheck(phase: MonitoringPhase, schedule: (recheckAt: number | null) => void) {
  useEffect(() => schedule(phase.recheckAt), [phase.recheckAt, schedule]);
}

/** 실시간 관제의 관제 단계. 작업 목록은 캐시만 구독한다(관제 화면의 대기 화면이 받는다). */
export function useMonitoringPhase(): MonitoringPhase {
  const works = useMonitorWorks({ passive: true });
  const bundles = useRecentBundles().data;
  const link = useTier0Link();
  const [now, schedule] = usePhaseClock();
  const phase = monitoringPhase(
    works.state === 'ready' ? works.works : undefined,
    bundles,
    link,
    now,
  );
  useRecheck(phase, schedule);
  return phase;
}

/** 작업 관리의 진행 중 작업 하나의 시작 단계. 묶음 목록을 모르면 unknown. */
export function useWorkStartPhase(work: {
  work_id: string;
  startedAt: number | null;
}): MonitoringPhase {
  const bundles = useRecentBundles().data;
  const link = useTier0Link();
  const [now, schedule] = usePhaseClock();
  const phase = bundles
    ? startPhase(work, bundles, link, now)
    : { stage: 'unknown' as const, problem: null, workId: work.work_id, recheckAt: null };
  useRecheck(phase, schedule);
  return phase;
}

/** 작업 관리의 끝난 작업 하나의 종료 단계(ending, 끝났으면 idle). 묶음 목록을 모르면 unknown. */
export function useWorkEndPhase(work: {
  work_id: string;
  endedAt: number | null;
}): MonitoringPhase {
  const bundles = useRecentBundles().data;
  const link = useTier0Link();
  const [now, schedule] = usePhaseClock();
  const phase = bundles
    ? endPhase(work, bundles, link, now)
    : { stage: 'unknown' as const, problem: null, workId: work.work_id, recheckAt: null };
  useRecheck(phase, schedule);
  return phase;
}
