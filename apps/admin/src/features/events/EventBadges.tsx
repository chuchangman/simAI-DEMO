import { ALARM_BORDER, ALARM_TEXT } from '@/features/events/alarmTone';
import { confirmationText } from '@/features/events/format';
import type { CardChip } from '@/features/events/incidentView';
import type { EventItem, Severity } from '@/features/events/types';
import { Badge } from '@simai/ui/components/badge';
import { cn } from '@simai/ui/lib/utils';

/** 조용한 칩: 확인됨 · 조치 단계 · 해소. 눈에 띄는 칩(미확인)과 갈린다. */
const QUIET_CHIP = 'border-border text-muted-foreground';

/** 처리 상태 칩 색. 미확인은 굵은 외곽선이고 그 묶음의 등급 색이며, 나머지는 조용한 칩이다. */
const chipClass = (kind: CardChip['kind'], severity: Severity) =>
  kind === 'unacked'
    ? cn('border-[1.5px] font-bold', ALARM_BORDER[severity], ALARM_TEXT[severity])
    : QUIET_CHIP;

/** 카드 꼬리표(작은 네모). 확인 필요는 회색 바탕, 지연은 채도를 낮춘 주황 외곽선이다. */
const TAG = 'rounded-[4px] px-[7px] py-px text-xs whitespace-nowrap';
const TAG_CONFIRM = `${TAG} bg-surface-3 text-muted-foreground`;
const TAG_DELAYED = `${TAG} text-delay ring-1 ring-delay ring-inset`;
const TAG_OUTSIDE = `${TAG} text-muted-foreground ring-1 ring-border ring-inset`;

/** 카드 머리줄 오른쪽의 처리 상태 칩. */
export function StateChip({ chip, severity }: { chip: CardChip; severity: Severity }) {
  return (
    <span
      data-chip={chip.kind}
      className={cn(
        'shrink-0 rounded-full border px-2 py-px text-xs leading-[18px] whitespace-nowrap tabular-nums',
        chipClass(chip.kind, severity),
      )}
    >
      {chip.label}
    </span>
  );
}

/**
 * 확인 필요 꼬리표. 사건 상세는 첫 이유까지 글자로 붙이고, 카드(compact)는 작은 꼬리표에
 * "확인 필요"만 적고 이유는 올려 보면 나온다.
 */
export function ConfirmBadge({ event, compact }: { event: EventItem; compact?: boolean }) {
  const text = confirmationText(event);
  if (!compact) return <Badge variant="outline">{text}</Badge>;
  return (
    <span title={text} className={TAG_CONFIRM}>
      확인 필요
    </span>
  );
}

/** 작업 외 진입의 이유: 발생 시각에 진행 중인 작업이 없음(NO_WORK), 작업 중이었지만 작업 구역 밖(OUTSIDE_ZONE). */
export type OutsideWorkKind = 'NO_WORK' | 'OUTSIDE_ZONE';

/** 작업 외 진입 꼬리표 문구와 올려 보면 나오는 설명(S15P31A101-731: 「작업 외 진입」 한 가지로는 뜻을 알 수 없었다). */
export const OUTSIDE_WORK_TEXT: Record<OutsideWorkKind, { label: string; title: string }> = {
  NO_WORK: {
    label: '작업 시간 외',
    title: '진행 중인 작업이 없을 때 난 이벤트입니다(작업 시작 전·종료 뒤·실행 사이).',
  },
  OUTSIDE_ZONE: {
    label: '작업 구역 밖',
    title: '작업 중이었지만 그 작업의 구역 밖에서 난 이벤트입니다.',
  },
};

/** 작업 외 진입 꼬리표(S15P31A101-457): 작업 구역 밖이거나 진행 중인 작업이 없을 때 난 이벤트. 등급·소리·표시는 그대로이고 꼬리표만 붙는다. */
export function OutsideWorkBadge({ kind }: { kind: OutsideWorkKind }) {
  const text = OUTSIDE_WORK_TEXT[kind];
  return (
    <span title={text.title} className={TAG_OUTSIDE}>
      {text.label}
    </span>
  );
}

/** 지연 알림 꼬리표(심각도와 함께 보여야 하는 것, 명세 7.3). 색은 지연(채도를 낮춘 주황) 몫이다. */
export function DelayedBadge({ compact }: { compact?: boolean }) {
  if (compact) return <span className={TAG_DELAYED}>지연 알림</span>;
  return (
    <Badge variant="outline" className="border-delay text-delay">
      지연 알림
    </Badge>
  );
}
