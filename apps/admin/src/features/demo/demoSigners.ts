import worker1Sign from '@/features/demo/assets/sign-worker1.png';
import worker2Sign from '@/features/demo/assets/sign-worker2.png';
import type { WorkSignature } from '@/features/work/types';

// 시연 계정(features/demo/demoAccount)의 참석자 서명. 서명자 이름 칸은 김싸피로 채워 두고(서명만 직접 한다),
// 서명 추가를 누르면 미리 받아 둔 작업자 서명(assets/sign-worker*.png)도 함께 올린다. 서명 그림을 바꾸려면 그 파일만 바꾼다.

export const DEMO_SIGNER_NAME = '김싸피';

/** 함께 올리는 작업자: 이름과 서명 그림 주소. */
const WORKERS = [
  { name: '작업자1', image: worker1Sign },
  { name: '작업자2', image: worker2Sign },
] as const;

/** 아직 서명하지 않은 작업자의 이름과 서명 그림(PNG). 이미 서명한 작업자는 다시 올리지 않는다. */
export async function demoWorkerSignatures(
  signed: readonly WorkSignature[],
): Promise<{ name: string; image: Blob }[]> {
  const missing = WORKERS.filter(
    (worker) => !signed.some((signature) => signature.signer_name === worker.name),
  );
  return Promise.all(
    missing.map(async (worker) => ({
      name: worker.name,
      image: await fetch(worker.image).then((response) => response.blob()),
    })),
  );
}
