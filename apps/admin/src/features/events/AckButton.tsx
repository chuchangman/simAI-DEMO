import { useCanAck } from '@/features/events/ack';
import { entryStatus, type EventEntry } from '@/features/events/entries';
import { eventRuleName, eventSubject } from '@/features/events/format';
import type { EventItem } from '@/features/events/types';
import { useAckEvent } from '@/features/events/useAckEvent';
import type { PersonDisplayMap } from '@/features/people/personDisplay';
import type { ZoneNameOf } from '@/features/zones/zoneName';
import { Button } from '@simai/ui/components/button';

/** 보내는 중에도 포커스를 잃지 않게 막기만 한다. 실패하면 문구를 보인다. */
function AckControl({
  event,
  label,
  zoneName,
  personNames,
}: {
  event: EventItem;
  label: string;
  zoneName: ZoneNameOf;
  personNames?: PersonDisplayMap;
}) {
  const { ack, pending, error } = useAckEvent(event.event_id);
  const text = pending ? '확인 중…' : label;
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        disabled={pending}
        focusableWhenDisabled
        // 목록에 「확인」이 여러 개라 어느 경보인지 함께 읽힌다.
        aria-label={`${eventRuleName(event)} ${eventSubject(event, zoneName, personNames)} ${text}`}
        onClick={() => ack(event.event_sequence)}
      >
        {text}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-muted-foreground">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * 경보 확인 버튼. 확인 대기 경보이고 권한(반장·관리자)이 있을 때만 보인다.
 * 연결이 끊겨 화면이 마지막으로 받은 상태로 멈춰 있어도 누를 수 있다(useAckEvent 가 멈춘 화면에 확인을 쓴다).
 */
export function AckButton({
  entry,
  label = '확인',
  zoneName,
  personNames,
}: {
  entry: EventEntry;
  label?: string;
  /** 읽는 이름(aria-label)에 넣을 구역 이름 조회. 목록은 한 번 구해 내려준다. */
  zoneName: ZoneNameOf;
  personNames?: PersonDisplayMap;
}) {
  const canAck = useCanAck();
  if (!canAck || entryStatus(entry).kind !== 'alarm') return null;
  return (
    <AckControl event={entry.event} label={label} zoneName={zoneName} personNames={personNames} />
  );
}
