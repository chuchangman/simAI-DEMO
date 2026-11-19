import { useIsDemoAccount } from '@/features/demo/demoAccount';
import { latestAlarmStartAt } from '@/features/demo/demoEvents';
import { EventPhotos } from '@/features/eventPhotos/EventPhotos';
import { CameraButton } from '@/features/events/CameraButton';
import { isActive, isConfirmationPending } from '@/features/events/entries';
import {
  ConfirmBadge,
  DelayedBadge,
  OutsideWorkBadge,
  StateChip,
  type OutsideWorkKind,
} from '@/features/events/EventBadges';
import { entryEtaLine } from '@/features/events/format';
import { firstActiveRaisedAt, topEntry, type Incident } from '@/features/events/incidents';
import { cardChip, cardTitle, targetLabel, targetShortLabel } from '@/features/events/incidentView';
import { SeverityBadge } from '@/features/events/SeverityBadge';
import { Since } from '@/features/events/Since';
import type { Severity } from '@/features/events/types';
import { usePersonDisplayMap } from '@/features/people/usePersonDisplay';
import { useZoneName } from '@/features/zones/useZoneName';
import { cn } from '@simai/ui/lib/utils';
import { useEffect, useRef } from 'react';

/** 둘째 줄 오른쪽 끝(경과·발생 횟수) 글자. */
const TRAILING = 'shrink-0 text-xs whitespace-nowrap text-muted-foreground';

/** 「N회」를 올려 보면 나오는 설명. 트랙 번호가 바뀌며 이어진 경보를 묶었으면(S15P31A101-731) 그 까닭을 알린다. */
const occurrencesTitle = (occurrences: number, people: number) =>
  people > 1
    ? `같은 위험·같은 구역에서 짧은 시간 안에 트랙 번호(작업자 번호)가 바뀌며 이어진 경보 ${occurrences}건(번호 ${people}개)을 한 카드로 묶었습니다. 지금 보이는 서로 다른 두 사람은 묶지 않으며, 기록은 그대로입니다.`
    : `같은 위험·같은 구역에서 ${occurrences}번 발생했습니다.`;

interface IncidentCardProps {
  incident: Incident;
  /** 카드 대표 위험(규칙·구역)의 발생 횟수(S15P31A101-731 화면 묶음 포함). 2 이상이면 「N회」를 보인다. */
  occurrences?: number;
  /** 카드에 묶인 대상(사람 트랙 번호) 수. 2 이상이면 「N회」에 묶은 까닭을 올려 보면 알린다. */
  people?: number;
  selected: boolean;
  /** 대상 사람이 지금 카메라에서 사라졌다(S15P31A101-757). 카드를 흐리게 하고 「지금 안 보임」을 단다. */
  gone?: boolean;
  /** 작업 외 진입 꼬리표의 이유(작업 시간 외·작업 구역 밖). 없으면 꼬리표가 없다. 등급·소리·표시는 그대로다. */
  outsideWork?: OutsideWorkKind | null;
  onSelect: (incident: Incident) => void;
  onOpen: (eventId: string) => void;
}

/** 등급 색: 위험 빨강, 경고 주황, 주의 노랑, 안내 회색. 띠는 늘 있고, 테두리는 진행 중인 묶음에만 있다. */
const SEVERITY_LOOK: Record<Severity, { bar: string; ring?: string }> = {
  CRITICAL: { bar: 'bg-sev-critical', ring: 'ring-1 ring-sev-critical ring-inset' },
  HIGH: { bar: 'bg-sev-high', ring: 'ring-1 ring-sev-high ring-inset' },
  CAUTION: { bar: 'bg-sev-caution', ring: 'ring-1 ring-sev-caution ring-inset' },
  INFO: { bar: 'bg-faint' },
};

/**
 * 한 사람(또는 구역)에 걸린 규칙 묶음 카드(명세 7.4, 관제 데모의 IncCard). 세 줄이다.
 * - 첫 줄: 등급 배지 · 대표 규칙(가장 높은 등급) 이름 · 구역, 오른쪽에 처리 상태 칩 하나.
 * - 둘째 줄: 대상(사람은 「작업자 #N」, 구역은 이름) · 꼬리표(확인 필요 · 지연 알림 · 작업 시간 외/작업 구역 밖), 오른쪽 끝에
 *   발생 횟수 「N회」(두 번 이상일 때, S15P31A101-731 화면 묶음 포함)와 경과(진행 중일 때 N초 전). 확인 필요는 운영자가 확인하기 전에만 보인다.
 * - 진입 예측일 때만 한 줄을 더하고, 진행 중이면 카메라 버튼이 맨 아래에 온다.
 * - 지난 관제(지금 Tier 0 가 들고 있지 않음, S15P31A101-595)는 등급 테두리·점멸·카메라 버튼 없이 흐리게 보인다(경과는 보인다).
 * 나머지 규칙 · 개구부 수치 · 처리는 사건 상세에서 본다. 머리는 처음 누르면 선택(3D 초점),
 * 이미 선택된 카드를 다시 누르면 사건 상세를 연다.
 */
export function IncidentCard({
  incident,
  occurrences = 1,
  people = 1,
  selected,
  gone = false,
  outsideWork = null,
  onSelect,
  onOpen,
}: IncidentCardProps) {
  const zoneName = useZoneName();
  const personNames = usePersonDisplayMap();
  const top = topEntry(incident);
  const look = SEVERITY_LOOK[incident.severity];
  const chip = cardChip(incident);
  const live = incident.entries.filter((e) => isActive(e.event));
  const check = live.find(isConfirmationPending);
  const delayed = live.some((e) => e.event.delivery === 'DELAYED_ACTIVE');
  const demo = useIsDemoAccount();
  // 시연 계정은 경보 배너가 없어 카드가 새 경보를 알린다: 확인 대기 경보가 있으면 그 경보가 울린 때부터 센다(features/demo/demoEvents)
  const raisedAt = incident.active
    ? ((demo ? latestAlarmStartAt(incident) : null) ?? firstActiveRaisedAt(incident))
    : null;
  // 지금 관제 중인 사건만 등급 테두리·카메라 버튼을 쓴다. 지난 관제의 사람은 지금 카메라에 없다.
  const current = incident.active && !incident.stale && !gone;
  const eta = entryEtaLine(top.event);
  const target = targetShortLabel(incident.target, zoneName, personNames);
  const fullTarget = targetLabel(incident.target, zoneName, personNames);

  // 3D·2D 에서 사람을 눌러 이 묶음이 선택되면 긴 목록에서도 보이게 한다.
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) card.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  return (
    <li>
      <article
        ref={card}
        aria-label={`${fullTarget} 이벤트`}
        className={cn(
          'relative flex flex-col gap-1 overflow-hidden rounded-[10px] bg-surface-2 py-3 pr-3.5 pl-[18px]',
          'hover:ring-1 hover:ring-point-soft hover:ring-inset',
          current && look.ring,
          !incident.active && 'opacity-55',
          incident.stale && 'opacity-75',
          gone && 'opacity-60',
          selected && 'outline-2 outline-offset-1 outline-primary',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-0 left-0 w-1',
            look.bar,
            incident.alarming && 'motion-safe:animate-alarm-blink',
          )}
        />
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => (selected ? onOpen(top.event.event_id) : onSelect(incident))}
          className="-mx-1 flex flex-col gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-surface-3"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 items-start gap-2">
              <SeverityBadge severity={top.event.severity} />
              <b className="line-clamp-2 min-w-0">{cardTitle(incident, zoneName)}</b>
            </span>
            {chip && <StateChip chip={chip} severity={incident.severity} />}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span title={target === fullTarget ? undefined : fullTarget} className="text-sm">
                {target}
              </span>
              {gone && (
                <span
                  title="이 사람은 지금 카메라에 보이지 않습니다. 위험이 끝난 것이 아니라 확인·해소를 기다리는 중입니다."
                  className="text-xs text-muted-foreground"
                >
                  지금 안 보임
                </span>
              )}
              {check && <ConfirmBadge event={check.event} compact />}
              {delayed && <DelayedBadge compact />}
              {outsideWork && <OutsideWorkBadge kind={outsideWork} />}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {occurrences > 1 && (
                <span title={occurrencesTitle(occurrences, people)} className={TRAILING}>
                  {occurrences}회
                </span>
              )}
              {raisedAt !== null && <Since raisedAt={raisedAt} className={TRAILING} />}
            </span>
          </span>
        </button>
        {eta && <p className="text-sm">{eta}</p>}
        {selected && <EventPhotos event={top.event} compact />}
        <CameraButton target={current ? incident.target : null} variant="card" />
      </article>
    </li>
  );
}
