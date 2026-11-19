import { useIsDemoAccount } from '@/features/demo/demoAccount';
import { DEMO_SIGNER_NAME, demoWorkerSignatures } from '@/features/demo/demoSigners';
import { ModalDialog } from '@/features/tbm/ModalDialog';
import { ACTION, H3, SECONDARY } from '@/features/tbm/styles';
import { canAddSigner, isSignerLimitReached } from '@/features/work/preflight/preflight';
import {
  addSignatureErrorMessage,
  SIGNER_LIMIT_MESSAGE,
} from '@/features/work/preflight/preflightErrors';
import { SignerList } from '@/features/work/preflight/SignerList';
import { SignPad, type SignPadHandle } from '@/features/work/preflight/SignPad';
import type { SignersState } from '@/features/work/preflight/useSigners';
import { SIGNER_NAME_MAX } from '@/features/work/types';
import { Button } from '@simai/ui/components/button';
import { Input } from '@simai/ui/components/input';
import { useEffect, useRef, useState } from 'react';

// 참석자 서명 창: 서명자 이름 + 손서명 → 서명 추가(여러 명), 서명자 목록, 완료. 추가·삭제는 바로 서버에 반영된다.
// 이름과 획이 있어야 서명 추가가 켜지고(Enter 로도 추가), 추가하면 이름과 패드를 비워 다음 사람이 이어 쓴다.
// 시연 계정은 이름 칸이 김싸피로 채워져 있고, 서명 추가 때 미리 받아 둔 작업자1·2 서명도 함께 올린다(features/demo/demoSigners).

export function SignDialog({ signers, onClose }: { signers: SignersState; onClose: () => void }) {
  const { resetErrors } = signers;
  const demo = useIsDemoAccount();
  const firstName = demo ? DEMO_SIGNER_NAME : '';
  const [name, setName] = useState(firstName);
  const [hasInk, setHasInk] = useState(false);
  const pad = useRef<SignPadHandle>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  // 이미지를 만드는 사이(await)에도 Enter 가 겹쳐 두 번 추가되지 않게 막는다.
  const submitting = useRef(false);

  // 지난번 창에서 남은 실패 안내를 지운다.
  useEffect(() => {
    resetErrors();
  }, [resetErrors]);

  const limitReached = isSignerLimitReached(signers.count);
  const canAdd = canAddSigner({
    name,
    hasInk,
    ready: signers.ready,
    busy: signers.adding || signers.removing,
    signerCount: signers.count,
  });
  const message = limitReached
    ? SIGNER_LIMIT_MESSAGE
    : signers.addError
      ? addSignatureErrorMessage(signers.addError)
      : null;

  const addSigner = async () => {
    if (!canAdd || submitting.current) return;
    submitting.current = true;
    try {
      const image = await pad.current?.toBlob();
      if (!image) return;
      if (await signers.add(name.trim(), image)) {
        if (demo) {
          for (const worker of await demoWorkerSignatures(signers.signers)) {
            if (!(await signers.add(worker.name, worker.image))) break;
          }
        }
        setName(firstName);
        pad.current?.clear();
        nameInput.current?.focus();
      }
    } finally {
      submitting.current = false;
    }
  };

  return (
    <ModalDialog
      label="참석자 서명"
      onClose={onClose}
      className="max-h-[calc(100vh-48px)] w-[min(560px,calc(100vw-48px))] overflow-y-auto"
    >
      <div className="flex flex-col gap-4 px-5 py-[18px]">
        <h2 className="text-[15px] leading-[22px] font-bold text-foreground">참석자 서명</h2>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">서명자 이름</span>
          <Input
            ref={nameInput}
            value={name}
            maxLength={SIGNER_NAME_MAX}
            placeholder="서명자 이름"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) void addSigner();
            }}
          />
        </label>
        <SignPad ref={pad} onInkChange={setHasInk} />
        {message && (
          <p role="alert" className="text-[13px] text-destructive">
            {message}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" className={SECONDARY} onClick={() => pad.current?.clear()}>
            지우기
          </Button>
          <Button className={ACTION} disabled={!canAdd} onClick={() => void addSigner()}>
            서명 추가
          </Button>
        </div>
        <h3 className={H3}>{`서명자 ${signers.count}명`}</h3>
        <SignerList signers={signers} />
        <div className="flex justify-end">
          <Button className={ACTION} onClick={onClose}>
            완료
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}
