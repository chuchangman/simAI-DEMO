import { formatPersonFull } from '@/features/people/personDisplay';
import { usePersonDisplayMap } from '@/features/people/usePersonDisplay';
import { realtime } from '@/lib/realtime';
import { SEVERITY_LABEL } from '@/lib/ruleNames';
import type { WatchEscalationPayload } from '@simai/contracts';
import { useEffect, useState } from 'react';

/** 한 번에 보이는 격상 수와 보이는 시간(ms). 격상은 한 알림에 한 번만 온다 */
const MAX_ITEMS = 3;
const SHOW_MS = 60_000;

const REASON_TEXT = { NO_ACK: '진동 뒤 확인 없음', SEND_FAILED: '워치로 보내지 못함' } as const;

/**
 * 워치 진동 알림 격상(watch_escalation, /topic/watch, S15P31A101-338·-342·-658). 확인 기한 안에 워치 ACK 가 없거나 보내지
 * 못하면 관제 화면에 알린다. 워치 ACK·격상은 운영자 확인이 아니라 이벤트 상태를 바꾸지 않는다.
 */
export function WatchEscalationNotice() {
  const [items, setItems] = useState<{ e: WatchEscalationPayload; at: number }[]>([]);
  const personNames = usePersonDisplayMap();

  useEffect(
    () =>
      realtime.on('watchEscalation', (e, at) =>
        setItems((prev) =>
          [{ e, at }, ...prev.filter((p) => p.e.alert_msg_id !== e.alert_msg_id)].slice(
            0,
            MAX_ITEMS,
          ),
        ),
      ),
    [],
  );

  useEffect(() => {
    if (items.length === 0) return;
    const oldest = Math.min(...items.map((i) => i.at));
    const timer = setTimeout(
      () => setItems((prev) => prev.filter((p) => Date.now() - p.at < SHOW_MS)),
      Math.max(0, oldest + SHOW_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [items]);

  if (items.length === 0) return null;
  return (
    <div className="pointer-events-auto flex flex-col gap-1">
      {items.map(({ e }) => (
        <div
          key={e.alert_msg_id}
          role="alert"
          className="flex items-center gap-3 rounded-lg bg-card px-4 py-2 text-sm text-foreground shadow-float"
        >
          <span className="font-semibold text-destructive">워치 {REASON_TEXT[e.reason]}</span>
          <span>
            {e.device_id}
            {e.world_id ? ` · ${formatPersonFull(e.world_id, personNames)}` : ''} ·{' '}
            {SEVERITY_LABEL[e.severity]}
          </span>
          <button
            type="button"
            className="ml-2 text-xs text-muted-foreground underline"
            onClick={() =>
              setItems((prev) => prev.filter((p) => p.e.alert_msg_id !== e.alert_msg_id))
            }
          >
            닫기
          </button>
        </div>
      ))}
    </div>
  );
}
