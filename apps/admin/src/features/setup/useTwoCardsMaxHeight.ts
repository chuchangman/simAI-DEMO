import { useLayoutEffect, useState, type RefCallback } from 'react';

/**
 * 목록(list)의 최대 높이를 위에서 두 번째 카드의 아래 끝까지로 건다. 카드가 둘 이하이거나 높이를 잴 수 없으면(시험) 걸지 않는다.
 * 카드 높이는 설명 길이·버튼 줄 유무로 달라 고정 px 로 정할 수 없어서 재서 정한다. 목록은 position 이 있어야(relative) 카드의 offsetTop 이 목록 기준이다.
 */
function limitToTwoCards(list: HTMLElement) {
  const second = list.children[1];
  const bottom =
    list.children.length > 2 && second instanceof HTMLElement
      ? second.offsetTop + second.offsetHeight
      : 0;
  list.style.maxHeight = bottom > 0 ? `${bottom}px` : '';
}

/**
 * 카드 목록을 두 장 높이까지만 보이게 하고 나머지는 스크롤로 보이는 ref. 목록에 달아 쓴다(목록이 없다가 생겨도 따라간다).
 * 카드 수·내용이 바뀌면 다시 그려질 때 재고, 폭이 바뀌어 글이 다시 줄바꿈될 때는 크기 변화를 보고 잰다.
 */
export function useTwoCardsMaxHeight(): RefCallback<HTMLElement> {
  const [list, setList] = useState<HTMLElement | null>(null);

  // 높이를 state 가 아니라 요소에 직접 쓴다. 다시 그리지 않고, 제한에 가려진 카드의 높이 변화도 다음 그림에서 잡힌다.
  useLayoutEffect(() => {
    if (list) limitToTwoCards(list);
  });

  useLayoutEffect(() => {
    if (!list || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(() => limitToTwoCards(list));
    observer.observe(list);
    return () => observer.disconnect();
  }, [list]);

  return setList;
}
