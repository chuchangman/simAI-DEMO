import { FIELD_HEIGHT, PAPER_FIELD } from '@/features/work/report/paperTables';
import { TaskChecklist } from '@/features/work/report/TaskChecklist';
import { taskLabelOf, tasksOfSelection, type TaskSelection } from '@/features/work/reportForm';
import type { WorkTask } from '@/features/work/types';
import { cn } from '@simai/ui/lib/utils';
import { useState } from 'react';

// 종이 위 작업내용 칸: 고른 작업을 종이 글 그대로 보이고, 누르면 칸 아래에 작업내용 고르기를 펼친다(다시 누르면 접는다).

export function PaperTasksField({
  catalog,
  selection,
  onChange,
}: {
  catalog: readonly WorkTask[];
  selection: TaskSelection;
  onChange: (selection: TaskSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const tasks = tasksOfSelection(selection, catalog);
  return (
    <div className="-mx-2 -my-1.5">
      <button
        type="button"
        aria-label="작업내용 고르기"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
        className={cn(PAPER_FIELD, FIELD_HEIGHT.tall, 'mx-0 my-0 w-full cursor-pointer')}
      >
        {tasks.map((task, index) => (
          <p key={index}>{`• ${taskLabelOf(task, catalog)}`}</p>
        ))}
        {tasks.length === 0 && <span className="text-muted-foreground">+ 작업내용 선택</span>}
      </button>
      {open && (
        <div className="p-2">
          <TaskChecklist catalog={catalog} selection={selection} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
