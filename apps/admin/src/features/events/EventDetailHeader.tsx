import { ALARM_BORDER, ALARM_TEXT } from '@/features/events/alarmTone';
import { isActive, needsConfirmation } from '@/features/events/entries';
import { ConfirmBadge, DelayedBadge } from '@/features/events/EventBadges';
import { formatTime } from '@/features/events/format';
import { firstRaisedAt, type Incident } from '@/features/events/incidents';
import {
  resolvedLabel,
  targetFont,
  targetLabel,
  targetShortLabel,
} from '@/features/events/incidentView';
import { SeverityBadge } from '@/features/events/SeverityBadge';
import type { Severity } from '@/features/events/types';
import { usePersonDisplayMap } from '@/features/people/usePersonDisplay';
import { useZoneName } from '@/features/zones/useZoneName';
import { Badge } from '@simai/ui/components/badge';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import type { Ref } from 'react';

/** 머리줄 상태: 진행 중이면 발생·갱신, 모두 해소면 마지막 해소 시각. */
function stateLabel(incident: Incident): string {
  if (!incident.active) return resolvedLabel(incident);
  return incident.entries.some((e) => e.event.lifecycle === 'UPDATED') ? '갱신' : '발생';
}

/** 미확인 경보 표시: 작은 외곽선만 깜빡인다(1 Hz, 움직임 줄이기 설정이면 멈춘다). 색은 사건 등급을 따른다. */
function UnackedMark({ severity }: { severity: Severity }) {
  return (
    <span className={cn('relative rounded-[4px] px-1.5 py-px text-xs', ALARM_TEXT[severity])}>
      <span
        aria-hidden
        className={cn(
          'absolute inset-0 rounded-[4px] border motion-safe:animate-alarm-blink',
          ALARM_BORDER[severity],
        )}
      />
      미확인
    </span>
  );
}

/** 사건 상세 머리줄: 대상 · 등급 · 상태 · 꼬리표들 · 닫기. */
export function EventDetailHeader({
  incident,
  closeRef,
  onClose,
}: {
  incident: Incident;
  closeRef: Ref<HTMLButtonElement>;
  onClose: () => void;
}) {
  const zoneName = useZoneName();
  const personNames = usePersonDisplayMap();
  const events = incident.entries.map((e) => e.event);
  const confirm = events.find((e) => isActive(e) && needsConfirmation(e));

  return (
    <header className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
      <h2 className="text-[22px] leading-[30px] font-bold">
        <span
          title={targetLabel(incident.target, zoneName, personNames)}
          className={targetFont(incident.target, personNames)}
        >
          {targetShortLabel(incident.target, zoneName, personNames)}
        </span>{' '}
        사건
      </h2>
      <SeverityBadge severity={incident.severity} />
      <Badge variant="secondary">{stateLabel(incident)}</Badge>
      {incident.alarming && <UnackedMark severity={incident.severity} />}
      <span className="font-mono text-sm text-muted-foreground">
        발생 {formatTime(firstRaisedAt(incident))}
      </span>
      {confirm && <ConfirmBadge event={confirm} />}
      {events.some((e) => e.verification === 'UNVERIFIABLE') && (
        <Badge variant="outline">해소 확인 불가</Badge>
      )}
      {events.some((e) => e.delivery === 'DELAYED_ACTIVE') && <DelayedBadge />}
      <Button ref={closeRef} variant="secondary" size="sm" className="ml-auto" onClick={onClose}>
        닫기 ✕
      </Button>
    </header>
  );
}
