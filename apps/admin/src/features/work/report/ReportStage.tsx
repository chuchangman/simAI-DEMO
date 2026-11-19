import { ReportEditDialog } from '@/features/work/report/ReportEditDialog';
import { ReportPanel } from '@/features/work/report/ReportPanel';
import { missingKeys } from '@/features/work/reportForm';
import type { WorkStageProps } from '@/features/work/stageProps';
import { useWorkReport } from '@/features/work/useWorkReport';
import { useWorkAction } from '@/features/work/WorkActionContext';
import { dayKind } from '@/features/work/workDay';
import { useState } from 'react';

// 단계 1 'TBM 보고서': 왼쪽에 보고서 종이를 넓게 두고, 사람은 작업내용만 고른 뒤 '다음' 으로 세팅을 시작한다.
// 날짜를 열 때 빈 보고서가 서버에서 이미 만들어져 있어 만들기 단추·진행 막대는 없다.
// 예정인 날(미래)은 작업내용을 고르고 저장할 수 있지만 '다음' 은 꺼 둔다(작업은 그 날짜에만 시작한다).
// 오늘 작업내용이 비었으면 '다음' 이 편집 창을 '저장하고 세팅 시작' 으로 연다. 제출된 날은 이 단계가 아니라 작업 종료 단계가 맡는다.

const FUTURE_TITLE = '작업 날짜에 시작할 수 있어요';
const START_LABEL = '저장하고 세팅 시작';

export function ReportStage({ day, date, todayKey, onNext }: WorkStageProps) {
  const report = useWorkReport(day.work_id);
  const latest = report.data ?? null;
  const future = dayKind(date, todayKey) === 'future';
  const [asking, setAsking] = useState(false);

  const next = () => {
    if (missingKeys(latest?.form).length > 0) setAsking(true);
    else onNext();
  };

  useWorkAction({
    label: '다음',
    enabled: !future && latest !== null,
    title: future ? FUTURE_TITLE : undefined,
    onClick: next,
  });

  return (
    <>
      <ReportPanel workId={day.work_id} editable withPrint className="h-full" />
      {asking && latest && (
        <ReportEditDialog
          report={latest}
          submitLabel={START_LABEL}
          requireTasks
          onClose={() => setAsking(false)}
          onSaved={onNext}
        />
      )}
    </>
  );
}
