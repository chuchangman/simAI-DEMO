import { GpuInfoLines } from '@/features/gpu/GpuInfoLines';
import { GpuLaunchForm } from '@/features/gpu/GpuLaunchForm';
import { gpuErrorReason, isGpuOn } from '@/features/gpu/gpuStatus';
import { useGpuStatus } from '@/features/gpu/useGpu';
import { ModalDialog } from '@/features/tbm/ModalDialog';
import { Button } from '@simai/ui/components/button';
import { useState } from 'react';

// GPU 경고창(S15P31A101-702). 세팅 시작·작업 시작을 눌렀는데 GPU 가 연결돼 있지 않을 때.
// 꺼짐: 「GPU가 꺼져 있습니다 / 세팅과 관제에는 GPU가 필요합니다(약 5~7분)」 + [GPU 켜기] [취소]. [GPU 켜기]는 켜기 표를 연다.
// 준비 중: 「GPU 준비 중」과 단계. 연결되면 useGpuGate 가 창을 닫고 하던 일을 잇는다. 오류: 까닭과 [닫기].

export function GpuGateDialog({ onCancel }: { onCancel: () => void }) {
  const { status, dot } = useGpuStatus();
  const [launching, setLaunching] = useState(false);
  const on = isGpuOn(status);

  let body;
  if (launching && !on) {
    body = (
      <GpuLaunchForm onLaunched={() => setLaunching(false)} onCancel={() => setLaunching(false)} />
    );
  } else if (dot === 'PREPARING' || (on && dot !== 'ERROR')) {
    body = (
      <div className="flex flex-col gap-4 p-5" data-testid="gpu-gate-preparing">
        <p className="text-base font-semibold">GPU 준비 중</p>
        <GpuInfoLines />
        <p className="text-sm text-muted-foreground">준비되면 이어서 진행합니다.</p>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onCancel}>
            취소
          </Button>
        </div>
      </div>
    );
  } else if (dot === 'ERROR') {
    body = (
      <div className="flex flex-col gap-4 p-5" data-testid="gpu-gate-error">
        <p className="text-base font-semibold">GPU 오류</p>
        <p className="text-sm">{gpuErrorReason(status) ?? 'GPU 상태를 확인하세요.'}</p>
        <p className="text-sm text-muted-foreground">
          상단의 GPU 표시를 눌러 끄고 다시 켤 수 있습니다.
        </p>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onCancel}>
            닫기
          </Button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4 p-5" data-testid="gpu-gate-off">
        <p className="text-base font-semibold">GPU가 꺼져 있습니다</p>
        <p className="text-sm">세팅과 관제에는 GPU가 필요합니다(약 5~7분).</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            취소
          </Button>
          <Button onClick={() => setLaunching(true)}>GPU 켜기</Button>
        </div>
      </div>
    );
  }

  return (
    <ModalDialog label="GPU 확인" onClose={onCancel} className="w-[min(640px,calc(100vw-32px))]">
      {body}
    </ModalDialog>
  );
}
