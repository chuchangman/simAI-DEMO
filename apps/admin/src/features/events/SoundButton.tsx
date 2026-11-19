import { useCanAck } from '@/features/events/ack';
import { ALARM_TEXT } from '@/features/events/alarmTone';
import { useAlarmSoundState } from '@/features/events/useAlarmSound';
import { alarmSound } from '@/lib/alarmSound';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { Bell, BellOff } from 'lucide-react';

/** 버튼 이름과 툴팁. 꺼짐은 차단 여부를 덧붙인다(꺼져 있어도 브라우저가 막고 있는지는 알아야 한다). */
export function soundLabel(muted: boolean, blocked: boolean) {
  if (muted) return blocked ? '경보 소리 꺼짐 · 차단됨' : '경보 소리 꺼짐';
  return blocked ? '경보 소리 차단됨' : '경보 소리 켜짐';
}

/** 모서리 「!」에 올리면 뜨는 설명: 브라우저가 소리를 막고 있고, 화면을 한 번 누르면 풀린다. */
export const BLOCKED_HINT = '소리 꺼짐 · 화면을 한 번 누르세요';

/**
 * 상단 바 경보 소리 버튼(관제 데모 c-sound). 끄고 켠다(시간 제한 없음, 브라우저에 저장).
 * 확인 권한이 없는 열람 계정은 소리를 내지 않으므로 버튼도 없다.
 * 브라우저가 소리를 막고 있으면(첫 입력 전·절전 복귀 뒤) 모서리에 「!」가 붙는다.
 * 색은 위험 등급(빨강·주황·노랑)·지연 몫이라 꺼짐·차단은 모양(BellOff, 속이 빈 테두리, 반전 배지)으로만 가른다.
 */
export function SoundButton() {
  const canAck = useCanAck();
  const { muted, ready, want } = useAlarmSoundState();
  if (!canAck) return null;

  const blocked = !ready;
  // 울릴 경보가 있고 켜져 있을 때만 종이 흔들린다(차단 중이어도 있는 경보는 알린다). 값은 울리는 등급이다.
  const ringingSeverity = muted ? null : want;
  const label = soundLabel(muted, blocked);
  const Icon = muted ? BellOff : Bell;

  return (
    <Button
      variant="secondary"
      size="icon-lg"
      aria-pressed={!muted}
      aria-label={label}
      title={label}
      onClick={() => alarmSound.toggle()}
      className={cn(
        'relative overflow-visible',
        muted &&
          'border-muted-foreground bg-transparent text-muted-foreground hover:bg-surface-3 hover:text-foreground',
        ringingSeverity && ALARM_TEXT[ringingSeverity],
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-flex origin-[50%_10%]',
          ringingSeverity && 'motion-safe:animate-bell-ring',
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      {blocked && (
        <span
          aria-hidden
          title={BLOCKED_HINT}
          // 막힌 채 경보가 있으면 느리게(2초 주기) 깜박여 눌러 달라고 알린다.
          className={cn(
            'absolute -top-[5px] -right-[5px] grid size-4 place-items-center rounded-full bg-foreground font-mono text-[11px] leading-none font-bold text-background ring-2 ring-card',
            ringingSeverity && 'motion-safe:animate-pulse',
          )}
        >
          !
        </span>
      )}
    </Button>
  );
}
