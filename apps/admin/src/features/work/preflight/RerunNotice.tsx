import { useCameraStates } from '@/features/cctv/useCameraStates';
import { RotateCcw, TriangleAlert } from 'lucide-react';

// 한 번 더 실행하는 작업 전 확인의 머리(S15P31A101-696). 세팅은 하루 한 번이라 다음 실행은 그 세팅(맵·보정·구역)으로 관제한다.
// 실행 사이에 카메라를 옮기거나 다시 연결했으면 세팅이 맞지 않으므로 다시 점검하라고 알린다. 지금 끊긴 카메라가 있으면 함께 보인다
// (health 카메라 상태, 모르면 줄을 감춘다). 시작을 막지 않는다.

export function RerunNotice({ runNo }: { runNo: number }) {
  const { cameras, stateOf } = useCameraStates();
  const live = cameras.filter((camera) => stateOf(camera.id) === 'live').length;
  const broken = cameras.length > 0 && live < cameras.length;
  return (
    <section
      aria-label="한 번 더 실행"
      className="col-span-full flex flex-col gap-1 rounded-[12px] bg-card px-4 py-3 ring-1 ring-border ring-inset"
    >
      <p className="flex items-center gap-2 font-semibold">
        <RotateCcw aria-hidden className="size-[18px] flex-none" />
        실행 {runNo} 시작 전 확인
      </p>
      <p>세팅 뒤 카메라를 옮기거나 다시 연결했다면 세팅을 다시 점검한 뒤 시작하세요.</p>
      {broken && (
        <p className="flex items-center gap-2 text-sev-caution">
          <TriangleAlert aria-hidden className="size-[18px] flex-none" />
          카메라 {live}/{cameras.length} 연결 · 끊긴 카메라를 확인하세요
        </p>
      )}
    </section>
  );
}
