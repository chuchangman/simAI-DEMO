import { STAGE_A_WARNING_TITLE } from '@/features/setup/cameraGuides';
import type { StageAAlertView } from '@/features/setup/setup';
import { Alert, AlertDescription, AlertTitle } from '@simai/ui/components/alert';
import { cn } from '@simai/ui/lib/utils';
import { TriangleAlert } from 'lucide-react';

// 세팅 보정(Stage A) 기준 미달·불안정 옆 카메라 쌍 경고(S15P31A101-761). 「세팅 시작」 근처(배경 촬영 창의 「시작」 위,
// 1단계 「자세히」)에 두고, 쌍마다 사유와 그 카메라의 기존 방향 안내를 보인다. 경고만 하고 시작은 막지 않는다(사용자 결정).

export function StageAWarning({
  alerts,
  className,
}: {
  alerts: readonly StageAAlertView[];
  className?: string;
}) {
  if (alerts.length === 0) return null;
  return (
    <Alert
      role="status"
      aria-label={STAGE_A_WARNING_TITLE}
      className={cn('border-delay/30 bg-delay/10 text-delay', className)}
    >
      <TriangleAlert aria-hidden />
      <AlertTitle>{STAGE_A_WARNING_TITLE}</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5 text-xs text-foreground">
        <ul className="flex flex-col gap-1.5">
          {alerts.map((alert) => (
            <li key={alert.key}>
              <p>
                <b>
                  {alert.label} {alert.statusLabel}
                </b>{' '}
                · {alert.reason}
              </p>
              {alert.guides.map((text) => (
                <p key={text} className="text-muted-foreground">
                  {text}
                </p>
              ))}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          이대로 시작하면 보정이 실패할 수 있어요. 시작은 할 수 있어요.
        </p>
      </AlertDescription>
    </Alert>
  );
}
