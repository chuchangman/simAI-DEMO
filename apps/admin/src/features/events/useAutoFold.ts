import { useState } from 'react';

/**
 * 이벤트가 하나도 없으면(empty) 저절로 접고, 생기면 펼친다. 그 사이 사용자가 누른 접기·펼치기는
 * empty 가 바뀔 때까지만 따른다.
 */
export function useAutoFold(empty: boolean) {
  const [fold, setFold] = useState<{ empty: boolean; manual: boolean | null }>({
    empty,
    manual: null,
  });
  if (fold.empty !== empty) setFold({ empty, manual: null });
  const folded = fold.manual !== null && fold.empty === empty ? fold.manual : empty;
  return { folded, setFolded: (next: boolean) => setFold({ empty, manual: next }) };
}
