import { GpuInfoLines } from '@/features/gpu/GpuInfoLines';
import { GpuPanel } from '@/features/gpu/GpuPanel';
import { isGpuOn } from '@/features/gpu/gpuStatus';
import { useGpuStatus } from '@/features/gpu/useGpu';
import { Button } from '@simai/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@simai/ui/components/card';
import { useState } from 'react';

// 작업 종료 뒤 화면의 GPU 끄기 안내 카드(S15P31A101-734). 작업을 끝냈는데 GPU 가 켜져 있으면 요금이 계속 나가므로 알리고,
// 「GPU 끄기」가 끄기 패널(GpuPanel)을 연다. GPU 상태는 관리자만 받으므로(서버가 ADMIN 만 허용) 다른 계정과 꺼진 GPU 에는 그리지 않는다.
// 한 번 더 실행할 수 있다는 것도 함께 알려, 이어서 쓸 때는 켜 둔 채 두면 되게 한다.

export function EndGpuCard({ canRerun }: { canRerun: boolean }) {
  const { isAdmin, status } = useGpuStatus();
  const [open, setOpen] = useState(false);
  if (!isAdmin || !isGpuOn(status)) return null;
  return (
    <>
      <Card size="sm" aria-label="GPU 끄기 안내">
        <CardHeader>
          <CardTitle>
            <h2>GPU 가 아직 켜져 있어요</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p>
            오늘 작업이 끝났다면 GPU 를 꺼야 요금이 멈춰요.
            {canRerun ? ' 한 번 더 실행할 거라면 켜 둔 채 두세요.' : ''}
          </p>
          <GpuInfoLines />
          <div>
            <Button variant="secondary" onClick={() => setOpen(true)}>
              GPU 끄기
            </Button>
          </div>
        </CardContent>
      </Card>
      {open && <GpuPanel onClose={() => setOpen(false)} />}
    </>
  );
}
