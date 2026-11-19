import type { WorkDayItem } from '@/features/work/types';

// 날짜 화면(WorkDayPage)이 단계 화면에 넘기는 공통 props. 단계마다 파일이 다르고(보고서·세팅·작업 전 확인·작업 종료),
// 날짜 화면은 이 모양으로만 부른다.

export interface WorkStageProps {
  /** 이 날짜의 작업(서버 `progress` 포함). */
  day: WorkDayItem;
  /** 날짜 키(YYYY-MM-DD). */
  date: string;
  /** 오늘 날짜 키. */
  todayKey: string;
  /** 다음 단계로 가 달라는 요청(보고서 → 세팅). 작업 전 확인부터는 서버 `progress`(세팅 완료 SETUP_DONE 등)가 정한다(-642). */
  onNext: () => void;
  /** 세팅 화면으로 돌아가 달라는 요청(작업 시작이 세팅 완료 전이라 막혔을 때, -642). 날짜 화면이 서버 progress 를 다시 받는다. */
  onBackToSetup?: () => void;
  /** 보고서로 돌아가 달라는 요청(세팅 방식을 고르지 않고 창을 닫았을 때). 세션을 만들기 전이라 서버 progress 는 아직 보고서다. */
  onBackToReport?: () => void;
  /**
   * 한 번 더 실행하는 작업 전 확인이면 그 실행 번호(S15P31A101-696, 2 이상). 처음 실행이면 없다.
   * 이때 작업 전 확인은 「작업 종료로」 단추(onCancelRerun)로 종료 화면에 돌아갈 수 있다.
   */
  rerunNo?: number;
  onCancelRerun?: () => void;
}

/** 작업 종료 단계: 보고서를 보내면(제출·잠금) 달력으로 나가도록 날짜 화면에 알린다. */
export interface RunStageProps extends WorkStageProps {
  onSubmitted: () => void;
  /** 「한 번 더 실행」(S15P31A101-696): 종료 뒤 보고서를 내기 전에 작업 전 확인으로 가 달라는 요청. 없으면 단추를 두지 않는다. */
  onRerun?: () => void;
}

/** 지난 날짜 화면. */
export interface PastDayProps {
  /** 날짜 키(YYYY-MM-DD). */
  date: string;
}

/** TBM 보고서 종이 하나(`ReportPanel`)를 쓰는 화면들이 넘기는 props. 보고서는 작업의 최신 판을 스스로 읽고 고친다. */
export interface ReportPanelProps {
  /** 보고서를 읽을 작업 id. */
  workId: string;
  /** 사람이 고칠 수 있는지(제출 전·오늘 흐름). 꺼지면 읽기 전용이다. */
  editable: boolean;
  /** 출력 단추를 보일지. */
  withPrint?: boolean;
  /**
   * 초안이 아직 없거나(draft_status null) 실패했을 때 'AI 초안 만들기' 단추를 보일지(-624). 세팅이 끝난 뒤 화면(작업 전 확인)에서만 켠다.
   * 세팅 완료(-615) 커밋 뒤 서버가 초안을 시작하므로(작업내용을 골랐을 때), 시작된 뒤(GENERATING·SUCCEEDED)에는 단추가 보이지 않는다.
   */
  draftable?: boolean;
  /** 세팅이 끝났는지. 끝났는데 서버가 아직 초안을 시작하지 않은 동안(PENDING)도 종이를 생성 중으로 가린다. 세팅이 끝난 뒤 화면(작업 전 확인)에서만 켠다. */
  setupDone?: boolean;
  className?: string;
}
