import { deleteSignatureErrorMessage } from '@/features/work/preflight/preflightErrors';
import type { SignersState } from '@/features/work/preflight/useSigners';
import { Button } from '@simai/ui/components/button';

// 서명자 줄 목록(이름 · 서명 썸네일 · 삭제). 서명 카드와 서명 창이 같이 쓴다. 삭제는 작업 시작 전에만 되고,
// 막히면 이유를 목록 아래에 보인다.

export function SignerList({ signers }: { signers: SignersState }) {
  const { signers: items, removing, removeError, remove } = signers;
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <ul aria-label="서명자 목록" className="flex flex-col divide-y divide-border">
        {items.map((signer) => (
          <li key={signer.signature_id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1 truncate font-semibold">{signer.signer_name}</span>
            {/* 서명은 흰 종이에 쓴 그림이라 어두운 화면에서도 흰 바탕 위에 둔다. */}
            <img
              src={signer.image_url}
              alt={`${signer.signer_name} 서명`}
              className="h-11 w-[120px] flex-none rounded-md border border-border bg-white object-contain"
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={removing}
              aria-label={`${signer.signer_name} 서명 삭제`}
              onClick={() => void remove(signer.signature_id)}
            >
              삭제
            </Button>
          </li>
        ))}
      </ul>
      {removeError && (
        <p role="alert" className="text-[13px] text-destructive">
          {deleteSignatureErrorMessage(removeError)}
        </p>
      )}
    </div>
  );
}
