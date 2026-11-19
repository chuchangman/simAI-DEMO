import type { RunAlarms } from '@/features/work/run/useRunAlarms';
import { cn } from '@simai/ui/lib/utils';
import { Check, TriangleAlert } from 'lucide-react';

// 작업 종료 확인창 안의 「미확인 위험 경보 n건」(S15P31A101-734). 종료를 막지는 않고, 종료하면 열린 경보가 확인하지 못한 채
// 닫힌다는 것(WORK_ENDED 마감, 해소된 경보는 확인을 받지 않는다)과 무엇을 하면 되는지(관제에서 확인)를 한 줄로 알린다.
// 목록을 못 받았으면 0건으로 보이지 않고 모른다고 알린다.

export function EndAlarmNote({ alarms }: { alarms: RunAlarms }) {
  const { counts, failed } = alarms;
  if (counts === null) {
    return (
      <p role="status" className="flex items-start gap-2 text-[13px] text-muted-foreground">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 flex-none text-sev-caution" />
        <span>
          {failed
            ? '경보 목록을 받지 못해 미확인 경보를 세지 못했어요. 종료 전에 관제 화면에서 확인해 주세요.'
            : '경보 목록을 받는 중이에요. 잠시 뒤 다시 열어 미확인 경보를 확인해 주세요.'}
        </span>
      </p>
    );
  }
  const open = counts.open;
  return (
    <p
      role={open > 0 ? 'alert' : 'status'}
      data-open={open}
      className={cn(
        'flex items-start gap-2 text-[13px]',
        open > 0 ? 'text-sev-caution' : 'text-muted-foreground',
      )}
    >
      {open > 0 ? (
        <TriangleAlert aria-hidden className="mt-0.5 size-4 flex-none" />
      ) : (
        <Check aria-hidden className="mt-0.5 size-4 flex-none text-ok" />
      )}
      <span>
        <strong className="font-semibold">미확인 위험 경보 {open}건</strong>
        {open > 0
          ? ' — 종료하면 확인하지 못한 채 닫혀요. 관제 화면에서 먼저 확인하는 것을 권해요.'
          : ' — 열려 있는 위험 경보는 모두 확인했어요.'}
      </span>
    </p>
  );
}
