import { fetchWorkUnit } from '@/features/work/api';
import { useWorkNavStore } from '@/features/work/workNav.store';
import { WorkPage } from '@/features/work/WorkPage';
import { api } from '@/lib/api';
import { workUnitKey } from '@/lib/queryKeys';
import { skipToken, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

// `/work` 라우트와 작업 관리 화면(WorkPage)을 잇는다: 날짜는 주소의 ?date= 로 열고 닫고,
// 옛 링크(?workUnitId=<작업 id>, 모니터 작업 바·세팅 화면 등)는 그 작업의 날짜를 알아 ?date= 로 바꿔 연다.

export function WorkRoutePage({ date, workUnitId }: { date?: string; workUnitId?: string }) {
  const navigate = useNavigate();
  const setLastDayDate = useWorkNavStore((s) => s.setLastDayDate);
  const legacyId = date === undefined ? workUnitId : undefined;
  const unit = useQuery({
    queryKey: workUnitKey(legacyId ?? ''),
    queryFn:
      legacyId === undefined ? skipToken : ({ signal }) => fetchWorkUnit(api, legacyId, signal),
  });
  const resolvedDate = unit.data?.date;
  const failed = unit.isError;

  // 날짜를 알면 그 날짜 화면으로, 작업을 못 찾으면 달력으로 주소를 바꾼다(뒤로 가기에 옛 주소가 남지 않게 replace).
  useEffect(() => {
    if (legacyId === undefined) return;
    if (resolvedDate) void navigate({ to: '/work', search: { date: resolvedDate }, replace: true });
    else if (failed) void navigate({ to: '/work', search: {}, replace: true });
  }, [legacyId, resolvedDate, failed, navigate]);

  // 날짜 화면이면 그 날짜를, 달력이면 null 을 남긴다(하단 메뉴가 오늘 날짜 화면으로 되돌린다). 옛 링크는 날짜를 알아낼 때까지 건너뛴다.
  useEffect(() => {
    if (legacyId === undefined) setLastDayDate(date ?? null);
  }, [legacyId, date, setLastDayDate]);

  // 날짜를 알아내는 동안은 달력을 비추지 않는다(달력이 번쩍였다가 날짜 화면으로 바뀌지 않게).
  if (legacyId !== undefined) return null;
  return (
    <WorkPage
      date={date}
      onOpenDate={(next) =>
        void navigate({ to: '/work', search: next === null ? {} : { date: next } })
      }
    />
  );
}
