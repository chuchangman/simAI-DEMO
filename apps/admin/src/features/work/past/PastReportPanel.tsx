import { DashPanel } from '@/features/dashboard/DashPanel';
import { ModalDialog } from '@/features/tbm/ModalDialog';
import { H2, SECONDARY } from '@/features/tbm/styles';
import { localizeEndingReview, withLocalizedEnding } from '@/features/work/past/pastDay';
import { ReportPanel } from '@/features/work/report/ReportPanel';
import { ReportThumbnail } from '@/features/work/report/ReportThumbnail';
import type { ReportsByWork } from '@/features/work/types';
import { useWorkReport } from '@/features/work/useWorkReport';
import { workReportsKey } from '@/lib/queryKeys';
import { Button } from '@simai/ui/components/button';
import { useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';

// 지난 날짜 오른쪽 열의 'TBM 보고서' 탭: 그 작업의 보고서를 읽기 전용으로. 열에는 작게 보이고, 누르면 창에 크게(서명·출력 포함) 본다.
// 옛 종료 미팅 문장에 남은 CRITICAL·HIGH·CAUTION·INFO 영문 등급 enum 은 캐시에서 한국어(위험·경고·주의·안내)로 바꿔 미리보기·창·출력에 같이 반영한다.

const TITLE = 'TBM 보고서';
const DIALOG = 'h-[90vh] w-[min(920px,calc(100vw-48px))] overflow-hidden open:flex open:flex-col';

export function PastReportPanel({ workId }: { workId: string }) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const { data: report } = useWorkReport(workId);

  useLayoutEffect(() => {
    const ending = report?.form?.review.ending;
    if (!ending || localizeEndingReview(ending) === ending) return;
    client.setQueryData<ReportsByWork>(workReportsKey(workId), (prev) =>
      prev?.latest ? { ...prev, latest: withLocalizedEnding(prev.latest) } : prev,
    );
  }, [client, report, workId]);

  return (
    <DashPanel icon={FileText} title={TITLE}>
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <ReportThumbnail workId={workId} onOpen={() => setOpen(true)} />
      </div>
      {open && (
        <ModalDialog label={TITLE} onClose={() => setOpen(false)} className={DIALOG}>
          <header className="flex flex-none items-center border-b border-border px-5 py-3">
            <h2 className={H2}>{TITLE}</h2>
          </header>
          <ReportPanel workId={workId} editable={false} withPrint className="flex-1 px-5 py-4" />
          <footer className="flex flex-none justify-end border-t border-border px-5 py-3">
            <Button variant="secondary" onClick={() => setOpen(false)} className={SECONDARY}>
              닫기
            </Button>
          </footer>
        </ModalDialog>
      )}
    </DashPanel>
  );
}
