import {
  AttendeesTable,
  ChecksTable,
  FocusTable,
  InfoTable,
  ReviewTable,
  RisksTable,
} from '@/features/work/report/paperTables';
import type { ReportForm, ReportLeader, WorkSignature, WorkTask } from '@/features/work/types';
import { cn } from '@simai/ui/lib/utils';
import type { KeyboardEvent, ReactNode } from 'react';

// TBM(작업 전 안전대화) 보고서 종이 한 장. 다크 모드에서도 흰 종이(.paper)이고, 고칠 수 있는 종이는 누르면(Enter 도) 편집 창을 연다.
// 'print' 는 인쇄용 사본의 모양(A4 폭·검은 선): 화면 종이와 표·글은 같다.
// onFormChange 를 주면 종이 위에서 칸을 바로 고친다(편집 창의 종이).

/** 종이 모양: 화면은 폭에 맞춰 A4 비율, 인쇄 사본은 A4 한 장 폭, 'sheet' 는 A4 틀(ReportSheet) 안에 들어가는 내용만. */
const SHAPE = {
  screen:
    'mx-auto aspect-[210/297] w-full max-w-[794px] min-w-[640px] rounded-sm px-10 pt-9 pb-11 shadow-float',
  print: 'w-[210mm] max-w-none min-h-[297mm] px-[15mm] py-[14mm]',
  sheet: 'w-full',
} as const;

const EDIT_LABEL = 'TBM 보고서 편집';

export function ReportView({
  form,
  leader,
  signatures,
  catalog,
  drafted,
  editable = false,
  onEdit,
  onFormChange,
  tasksField,
  variant = 'screen',
}: {
  form: ReportForm;
  /** 보고서를 만든 계정(리더). 사람이 고치지 않는다. */
  leader: ReportLeader | null;
  signatures: readonly WorkSignature[];
  /** 작업내용 항목(코드 → 문구). */
  catalog: readonly WorkTask[];
  /** 초안이 끝났는가. 아니면 시스템이 채울 칸을 줄무늬로 둔다. */
  drafted: boolean;
  /** 고칠 수 있는 종이인가(누르면 `onEdit`, 비어 있으면 '+ 작업내용 선택'). */
  editable?: boolean;
  onEdit?: () => void;
  /** 종이 위에서 고친 양식. 있으면 고칠 수 있는 칸이 입력 칸이 된다. */
  onFormChange?: (form: ReportForm) => void;
  /** 종이 위에서 고칠 때 작업내용 칸에 넣을 고르기. */
  tasksField?: ReactNode;
  variant?: keyof typeof SHAPE;
}) {
  const edit = editable ? onEdit : undefined;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // 종이 안의 다른 요소가 받은 키는 건드리지 않는다.
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' '))
      return;
    event.preventDefault();
    edit?.();
  };
  return (
    <div
      role={edit ? 'button' : undefined}
      tabIndex={edit ? 0 : undefined}
      aria-label={edit ? EDIT_LABEL : undefined}
      onClick={edit}
      onKeyDown={edit ? onKeyDown : undefined}
      className={cn(
        'paper box-border bg-card text-[13px] leading-normal text-card-foreground print:bg-white print:text-black',
        SHAPE[variant],
        edit &&
          'cursor-pointer transition-shadow hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
      )}
    >
      <h3 className="mb-[18px] text-center text-xl font-bold tracking-[0.02em]">
        TBM(작업 전 안전대화) 보고서
      </h3>
      <InfoTable
        form={form}
        catalog={catalog}
        drafted={drafted}
        editable={editable}
        onChange={onFormChange}
        tasksField={tasksField}
      />
      <RisksTable form={form} drafted={drafted} onChange={onFormChange} />
      <FocusTable form={form} leader={leader} drafted={drafted} onChange={onFormChange} />
      <ChecksTable form={form} drafted={drafted} onChange={onFormChange} />
      <ReviewTable form={form} drafted={drafted} onChange={onFormChange} />
      <AttendeesTable signatures={signatures} />
    </div>
  );
}
