import { useIsDemoAccount } from '@/features/demo/demoAccount';
import { demoReportLeader } from '@/features/demo/demoReport';
import { isDrafted, reportFormOf } from '@/features/work/reportForm';
import type { WorkSignature, WorkTask } from '@/features/work/types';
import { useSignatures } from '@/features/work/useSignatures';
import { useWorkTasks } from '@/features/work/useWorkDays';
import { useWorkReport } from '@/features/work/useWorkReport';

// 작업의 보고서 종이(ReportView)를 그리는 데 필요한 값 전부. 종이를 그리는 화면(본문 종이·작은 미리보기)이 같이 쓴다.
// 시연 계정의 리더 칸(소속·직책·성명)은 서버 양식이 아니라 계정 정보라 저장할 수 없어, 어느 종이든(오늘·지난 날짜) 시연 리더로 바꿔 보인다.

const NO_TASKS: readonly WorkTask[] = [];
const NO_SIGNATURES: readonly WorkSignature[] = [];

export function useReportPaper(workId: string) {
  const query = useWorkReport(workId);
  const latest = query.data ?? null;
  const signatures = useSignatures(latest?.report_id).data ?? NO_SIGNATURES;
  const catalog = useWorkTasks().data ?? NO_TASKS;
  const demo = useIsDemoAccount();
  // 보고서를 받기 전(latest 가 없음)에는 빈 종이를 그대로 둔다
  const leader = demo && latest ? demoReportLeader(latest.leader) : (latest?.leader ?? null);
  return {
    query,
    /** 작업의 최신 판. 아직 받는 중이면 null. */
    latest,
    paper: {
      form: reportFormOf(latest),
      leader,
      signatures,
      catalog,
      drafted: isDrafted(latest),
    },
  };
}
