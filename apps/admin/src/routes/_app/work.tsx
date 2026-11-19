import { WorkRoutePage } from '@/features/work/WorkRoutePage';
import { parseDateKey } from '@/features/work/workDay';
import { createFileRoute } from '@tanstack/react-router';

// 작업 관리: 첫 화면은 월 달력, ?date=YYYY-MM-DD 로 그 날짜 화면을 연다. 옛 링크(?workUnitId=<작업 id>)는 그 작업의 날짜로 바꿔 연다.
function WorkRoute() {
  const { date, workUnitId } = Route.useSearch();
  return <WorkRoutePage date={date} workUnitId={workUnitId} />;
}

/** 검색 값을 글자로 읽는다(주소의 숫자는 숫자로 오기도 한다). 없으면 ''. */
const textOf = (value: unknown): string =>
  typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';

export const Route = createFileRoute('/_app/work')({
  validateSearch: (search: Record<string, unknown>): { date?: string; workUnitId?: string } => {
    const date = textOf(search.date);
    const workUnitId = textOf(search.workUnitId);
    return {
      date: parseDateKey(date) ? date : undefined,
      workUnitId: /^\d+$/.test(workUnitId) ? workUnitId : undefined,
    };
  },
  component: WorkRoute,
  // 하단 메뉴가 블록 위에 반투명하게 떠서 본문이 화면 아래까지 내려온다(스크롤 없이 한 화면에 들어가게).
  staticData: { dockOverlay: true },
});
