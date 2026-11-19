import { EventDetailHeader } from '@/features/events/EventDetailHeader';
import {
  AiPanel,
  ClipsPanel,
  PhotosPanel,
  ProcessPanel,
  RulesPanel,
  TimelinePanel,
} from '@/features/events/EventDetailPanels';
import type { Incident } from '@/features/events/incidents';
import { useEffect, useRef } from 'react';

interface EventDetailProps {
  incident: Incident;
  /** 눌러서 연 규칙. 근거 목록에서 표시한다. */
  openEventId: string;
  onClose: () => void;
  /** 근거 시각을 눌렀을 때 그 시각으로 이동하는 콜백. 없으면 표시만 한다. */
  onSeekTimestamp?: (timestampMs: number) => void;
}

/**
 * 사건 상세 창(관제 데모와 같다). 한 대상에 걸린 규칙 전부를 장면 위에 띄워 보인다. 바깥을 누르거나 Esc 로 닫는다.
 * 상세 API(GET /api/events/{id}) 형식이 정해지기 전이라 받은 이벤트 값으로 그린다. 조치 요청·조치 단계는 서버 API(M2)가 없어 두지 않는다.
 */
export function EventDetail({ incident, openEventId, onClose, onSeekTimestamp }: EventDetailProps) {
  const close = useRef<HTMLButtonElement>(null);
  const { entries } = incident;

  // 열 때(다른 사건으로 바꿀 때)만 닫기 버튼에 포커스를 둔다. 패널이 다시 그려질 때마다 옮기면 ACK 등에 둔 포커스를 빼앗는다.
  useEffect(() => {
    close.current?.focus();
  }, [incident.key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      data-testid="incident-layer"
      onClick={onClose}
      className="absolute inset-x-0 top-[calc(60px+var(--notices-h,0px))] bottom-[86px] z-[6] flex justify-end bg-foreground/14 p-4 dark:bg-background/45"
    >
      <section
        role="dialog"
        aria-label="사건 상세"
        onClick={(e) => e.stopPropagation()}
        className="flex min-w-0 flex-[0_1_1000px] flex-col gap-3 overflow-auto rounded-[16px] bg-background/97 px-4 py-3.5 shadow-float ring-1 ring-border ring-inset"
      >
        <EventDetailHeader incident={incident} closeRef={close} onClose={onClose} />
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3.5">
          <div className="flex min-h-0 flex-col gap-3 overflow-auto">
            <PhotosPanel entries={entries} />
            <RulesPanel entries={entries} openEventId={openEventId} />
            <AiPanel entries={entries} onSeekTimestamp={onSeekTimestamp} />
            <ClipsPanel entries={entries} />
          </div>
          <div className="flex min-h-0 flex-col gap-3 overflow-auto">
            <ProcessPanel entries={entries} />
            <TimelinePanel incident={incident} />
          </div>
        </div>
      </section>
    </div>
  );
}
