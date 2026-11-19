import { SetupPage } from '@/features/setup/SetupPage';
import type { WorkStageProps } from '@/features/work/stageProps';

// 단계 2 '세팅': 날짜 화면 안에서 세팅(카메라 연결 관리 → 보정·생성 → 구역)을 이어서 보인다. 진행 중인 세션이 있으면
// (`day.active_setup_session_id`) SetupPage 가 서버에서 찾아 이어받는다. 단추는 날짜 화면 아래 오른쪽 단추 줄에 등록되고,
// 구역을 발행하고 '다음' 을 누르면 날짜 화면이 작업 전 확인으로 넘긴다(그 뒤 단계는 서버 `progress` 가 따라온다).
export function SetupStage({ day, onNext, onBackToReport }: WorkStageProps) {
  return (
    <SetupPage
      key={day.work_id}
      embedded
      workUnitId={Number(day.work_id)}
      onDone={onNext}
      onExit={onBackToReport}
    />
  );
}
