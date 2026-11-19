import { useWorkAction } from '@/features/work/WorkActionContext';
import type { RunStageProps, WorkStageProps } from '@/features/work/stageProps';

// 날짜 화면 시험이 단계 화면 자리에 끼우는 대역. 단계 화면 파일은 일꾼마다 따로 채워 가므로(실제 화면으로 바뀐다),
// 날짜 화면 시험은 그 파일에 기대지 않고 vi.mock 으로 이 대역을 끼운다. 대역은
// - 어느 단계인지(data-work-stub)와 날짜 화면이 넘긴 값(작업·날짜·오늘)을 data 로 보이고,
// - 넘겨받은 onNext·onSubmitted 를 부르는 단추(`<이름> 다음`·`<이름> 보내기`)를 그리고,
// - 실제 단계 화면처럼 우측 아래 단추 줄(마지막 단계는 '완료', 나머지는 '다음')을 등록한다.

export function stubStage(name: string) {
  return function StubStage(
    props: WorkStageProps & Partial<Pick<RunStageProps, 'onSubmitted' | 'onRerun'>>,
  ) {
    useWorkAction(
      props.onSubmitted
        ? { label: '완료', enabled: true, onClick: props.onSubmitted }
        : { label: '다음', enabled: true, onClick: props.onNext },
    );
    return (
      <div
        data-work-stub={name}
        data-work={props.day.work_id}
        data-date={props.date}
        data-today={props.todayKey}
        data-rerun={props.rerunNo}
      >
        <button type="button" onClick={props.onNext}>
          {name} 다음
        </button>
        {props.onSubmitted && (
          <button type="button" onClick={props.onSubmitted}>
            {name} 보내기
          </button>
        )}
        {props.onRerun && (
          <button type="button" onClick={props.onRerun}>
            {name} 한 번 더
          </button>
        )}
        {props.onCancelRerun && (
          <button type="button" onClick={props.onCancelRerun}>
            {name} 작업 종료로
          </button>
        )}
      </div>
    );
  };
}
