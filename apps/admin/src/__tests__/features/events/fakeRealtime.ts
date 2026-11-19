import type { RealtimeListeners } from '@/lib/stomp';

type Listener = (...args: never[]) => void;

/**
 * 시험용 실시간 연결. 알림 종류가 늘어도 시험을 고치지 않게 종류를 하드코딩하지 않는다.
 * emit 은 받은 쪽에 알리고, listeners 는 지금 걸린 수를 본다.
 */
export function fakeRealtime() {
  const byType = new Map<string, Set<Listener>>();
  return {
    on<K extends keyof RealtimeListeners>(type: K, listener: RealtimeListeners[K]) {
      const set = byType.get(type) ?? new Set<Listener>();
      set.add(listener);
      byType.set(type, set);
      return () => {
        set.delete(listener);
      };
    },
    emit<K extends keyof RealtimeListeners>(type: K, ...args: Parameters<RealtimeListeners[K]>) {
      for (const listener of byType.get(type) ?? []) {
        (listener as (...a: Parameters<RealtimeListeners[K]>) => void)(...args);
      }
    },
    count: (type: keyof RealtimeListeners) => byType.get(type)?.size ?? 0,
  };
}
