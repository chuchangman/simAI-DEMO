import { useWatchBindEffectStore } from '@/features/watch/watchBindEffect.store';

/**
 * 새로 이어진 워치 알림 배너("⌚ 김철수 연결됨(자동)", S15P31A101-509·-658).
 * 관제 화면 상단 알림 영역에 잠시 떴다가 NOTICE_MS 뒤 스스로 사라진다.
 */
export function WatchBindNotice() {
  const notice = useWatchBindEffectStore((s) => s.notice);
  if (!notice) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex items-center gap-2 rounded-lg border border-sky-500/35 bg-card/95 px-4 py-1.5 text-sm font-medium text-foreground shadow-float backdrop-blur-sm"
    >
      <span>{notice.text}</span>
    </div>
  );
}
