import { SIDE_COLUMN_CLASS } from '@/features/monitor/sideColumnStyle';
import { PersonDetailPanel } from '@/features/people/PersonDetailPanel';
import { ZoneList } from '@/features/zones/ZoneList';

/** 관제 화면 왼쪽 칼럼: 사람을 선택하면 사람 상세 패널을 위에 띄우고, 그 아래에 위험 구역 목록을 둔다. */
export function MonitorSideColumn() {
  return (
    <div className={SIDE_COLUMN_CLASS}>
      <PersonDetailPanel />
      <ZoneList />
    </div>
  );
}
