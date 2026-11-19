import { publishErrorText } from '@/features/zones/useConfigApply';
import { useState } from 'react';

/**
 * 저장·발행 결과 알림. notice 는 화면에 띄울 문구이고, publishFailed 는 마지막 발행이 실패했는지다(다시 보내기를 띄운다).
 * 다시 보내 성공하면 둘 다 지운다.
 */
export function useCommitNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const [publishFailed, setPublishFailed] = useState(false);

  const show = (text: string | null, failedPublish: boolean) => {
    setNotice(text);
    setPublishFailed(failedPublish);
  };

  /** 구성 묶음을 발행하고 결과를 알림에 반영한다: 성공이면 알림을 지우고, 실패하면 원인과 다시 보내기를 띄운다. */
  const publishAndShow = async (publish: () => Promise<unknown>) => {
    try {
      await publish();
      show(null, false);
    } catch (error) {
      show(publishErrorText(error), true);
    }
  };

  return { notice, publishFailed, show, publishAndShow, clearNotice: () => setNotice(null) };
}
