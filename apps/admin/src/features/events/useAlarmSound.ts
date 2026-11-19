import { useCanAck } from '@/features/events/ack';
import { createAlarmPolicy } from '@/features/events/alarmPolicy';
import type { EventEntry } from '@/features/events/entries';
import { alarmSound, type RingSeverity } from '@/lib/alarmSound';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

/**
 * 울릴 등급: 확인 대기 경보 중 가장 높은 등급 하나(CRITICAL > HIGH). 없으면 null.
 * 열람 계정은 확인 권한이 없어 소리를 끌 수 없으므로 울리지 않는다(배너·점멸로만 본다).
 * EC2 연결이 끊겨도 울린다: 마지막으로 안 확인 상태의 경보가 확인(ACK)될 때까지 끄지 않는다(관제 데모와 같다).
 */
export function ringingSeverity(
  entries: readonly EventEntry[],
  canAck: boolean,
): RingSeverity | null {
  return createAlarmPolicy()(entries, canAck)?.severity ?? null;
}

/** 소리 단계·R3 1회·ACK 30초 억제. 이벤트의 등급과 표시는 유지한다(S15P31A101-497). */
export function useAlarmSound(entries: readonly EventEntry[]) {
  const canAck = useCanAck();
  const policy = useMemo(() => createAlarmPolicy(), []);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const plan = policy(entries, canAck);
    const token = plan ? `${plan.severity}:${plan.once ? plan.key : 'repeat'}` : 'silent';
    if (previous.current === token) return;
    previous.current = token;
    if (plan?.once) alarmSound.ring(plan.severity, { once: true, key: plan.key, keys: plan.keys });
    else alarmSound.ring(plan?.severity ?? null);
  }, [entries, canAck, policy]);
  useEffect(
    () => () => {
      previous.current = null;
      alarmSound.ring(null);
    },
    [],
  );
}

/** 소리 상태(차단됨·꺼짐·울릴 등급). 상단 바 소리 버튼이 쓴다. */
export function useAlarmSoundState() {
  return useSyncExternalStore(alarmSound.subscribe, alarmSound.getSnapshot);
}
