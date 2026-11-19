import {
  toggleTaskCode,
  withEtcChecked,
  withEtcText,
  type TaskSelection,
} from '@/features/work/reportForm';
import { REPORT_FORM_LIMITS, type WorkTask } from '@/features/work/types';
import { Input } from '@simai/ui/components/input';
import { cn } from '@simai/ui/lib/utils';
import { useEffect, useRef } from 'react';

// 작업내용 고르기: 서버 항목 7개 체크 + '기타'(체크·직접 쓴 글). 기타 칸에 글을 쓰면 체크가 켜지고, 체크를 켜면 바로 쓸 수 있게 커서가 간다.

const ROW =
  'flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-foreground has-[input[type=checkbox]:not(:disabled)]:hover:bg-surface-2';
const BOX = 'size-[18px] shrink-0 cursor-pointer accent-primary';

export function TaskChecklist({
  catalog,
  selection,
  onChange,
  invalid = false,
}: {
  catalog: readonly WorkTask[];
  selection: TaskSelection;
  onChange: (selection: TaskSelection) => void;
  /** 필수인데 비었다: 빨간 윤곽으로 알리고 첫 항목에 커서를 둔다. */
  invalid?: boolean;
}) {
  const first = useRef<HTMLInputElement>(null);
  const etcText = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (invalid) first.current?.focus();
  }, [invalid]);

  return (
    <div
      role="group"
      aria-label="작업내용"
      aria-invalid={invalid || undefined}
      className={cn(
        'grid gap-2 rounded-lg',
        invalid && 'outline-2 outline-offset-4 outline-destructive',
      )}
    >
      {catalog.map((task, index) => (
        <label key={task.code} className={cn(ROW, 'cursor-pointer')}>
          <input
            ref={index === 0 ? first : undefined}
            type="checkbox"
            checked={selection.codes.includes(task.code)}
            onChange={() => onChange(toggleTaskCode(selection, task.code))}
            className={BOX}
          />
          <span>{task.label}</span>
        </label>
      ))}
      <div className={ROW}>
        <label className="flex flex-none cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={selection.etcChecked}
            onChange={(event) => {
              onChange(withEtcChecked(selection, event.target.checked));
              if (event.target.checked) etcText.current?.focus();
            }}
            className={BOX}
          />
          <span>기타</span>
        </label>
        <Input
          ref={etcText}
          type="text"
          aria-label="기타 작업내용"
          maxLength={REPORT_FORM_LIMITS.short}
          value={selection.etcText}
          onChange={(event) => onChange(withEtcText(selection, event.target.value))}
          className="min-w-0 flex-1"
        />
      </div>
    </div>
  );
}
