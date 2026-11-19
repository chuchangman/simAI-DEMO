import { Tooltip, TooltipContent, TooltipTrigger } from '@simai/ui/components/tooltip';
import type { ReactElement, ReactNode } from 'react';

/**
 * 도구 모음 버튼 하나에 이름표를 단다. 올리면 곧바로(기본보다 빨리) 뜬다. 눈에는 이름이 보이고, 화면 낭독기는 버튼의
 * aria-label 을 읽는다. trigger 는 버튼을 그리는 요소이고(팝오버 트리거를 감싸도 된다) children 은 그 안의 아이콘이다.
 */
export function ToolTooltip({
  label,
  trigger,
  children,
}: {
  label: string;
  trigger: ReactElement;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={trigger}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
