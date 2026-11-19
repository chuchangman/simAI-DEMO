import {
  REPLAY_TEST_ALERTS_LABEL,
  REPLAY_TEST_ALERTS_TITLE,
  TEST_INPUT_LABEL,
  TEST_INPUT_TITLE,
  useReplayTestAlerts,
  useTestInput,
} from '@/features/monitor/useTestInput';

/**
 * 작업 세션 바의 재생 중 표시(S15P31A101-731). 재생 중이 아니거나 모르면 그리지 않는다. 재생 시험 알림 스위치가 켜져 있으면
 * 「재생 시험 · 실제 알림 켜짐」을 눈에 띄게 보인다(S15P31A101-736).
 */
export function TestInputBadge() {
  const testInput = useTestInput();
  const replayAlerts = useReplayTestAlerts();
  if (!testInput) return null;
  if (replayAlerts)
    return (
      <span
        role="status"
        title={REPLAY_TEST_ALERTS_TITLE}
        data-replay-test-alerts=""
        className="shrink-0 rounded-full bg-destructive px-3 py-1 text-base font-bold whitespace-nowrap text-white"
      >
        {REPLAY_TEST_ALERTS_LABEL}
      </span>
    );
  return (
    <span
      role="status"
      title={TEST_INPUT_TITLE}
      className="shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap text-muted-foreground ring-1 ring-border ring-inset"
    >
      {TEST_INPUT_LABEL}
    </span>
  );
}
