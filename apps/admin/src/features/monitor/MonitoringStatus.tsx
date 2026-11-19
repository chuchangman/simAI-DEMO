import type { MonitoringPhase } from '@/features/monitor/monitoringPhase';
import { monitoringText, type MonitoringText } from '@/features/monitor/monitoringPhase';
import { publishErrorText, usePublishBundle } from '@/features/zones/useConfigApply';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';

// 관제 단계 배지와 문제 안내(S15P31A101-692). 배지 하나, 문제가 있으면 무엇이 / 어떻게 두 줄, 거부면 주 단추 하나.

const DOT: Record<MonitoringText['tone'], string> = {
  ok: 'bg-ok',
  wait: 'bg-sev-caution animate-pulse',
  bad: 'bg-destructive',
  off: 'bg-muted-foreground',
};

/** 관제 단계 배지(점 + 글). 글은 role=status 라 바뀌면 화면 읽기에 알린다. */
export function MonitoringBadge({ text }: { text: MonitoringText }) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[text.tone])} />
      <b role="status" className="whitespace-nowrap">
        {text.label}
      </b>
    </span>
  );
}

/**
 * 「현장에 다시 보내기」: 지금 상태로 구성 묶음을 새로 발행한다(POST /api/config-bundles). 서버는 그때 작업 상태로 ppe_policy 를 싣는다
 * (진행 중이면 그 작업, 없으면 작업 없음). 작업 시작·종료를 다시 요청하지 않는다.
 */
function RetryPublish() {
  const publish = usePublishBundle();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={publish.isPending}
        onClick={() => publish.mutate()}
        className="shrink-0"
      >
        현장에 다시 보내기
      </Button>
      {publish.isError && (
        <span role="alert" className="text-destructive">
          {publishErrorText(publish.error)}
        </span>
      )}
    </span>
  );
}

/** 문제 안내(무엇이 / 어떻게). 문제가 없으면 그리지 않는다. */
export function MonitoringProblemNote({ text }: { text: MonitoringText }) {
  if (!text.what) return null;
  return (
    <div className="flex w-full flex-col gap-1 text-sm">
      <p>{text.what}</p>
      {text.how && <p className="text-muted-foreground">{text.how}</p>}
      {text.retry && <RetryPublish />}
    </div>
  );
}

/** 단계 하나를 배지와 안내로(작업 관리 화면 등 작은 자리). */
export function MonitoringStatus({ phase }: { phase: Pick<MonitoringPhase, 'stage' | 'problem'> }) {
  const text = monitoringText(phase);
  return (
    <div className="flex flex-col gap-2">
      <MonitoringBadge text={text} />
      <MonitoringProblemNote text={text} />
    </div>
  );
}
