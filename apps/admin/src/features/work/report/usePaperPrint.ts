import { useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * 종이 출력. 인쇄용 사본을 그린 뒤(`printing`) 인쇄 창을 열고, 창이 닫히면 사본을 거둔다.
 * 사본은 `PaperPrint` 로 그린다(출력할 때만 두어 앱의 다른 화면 출력에 영향이 없게 한다).
 */
export function usePaperPrint() {
  const [printing, setPrinting] = useState(false);
  const print = () => {
    flushSync(() => setPrinting(true));
    window.print();
    setPrinting(false);
  };
  return { printing, print };
}
