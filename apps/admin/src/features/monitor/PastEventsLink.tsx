/**
 * 이벤트 패널 아래 한 줄: 지금 실행이 시작되기 전에 난 이벤트는 기본 목록에서 빠졌다는 안내(S15P31A101-731).
 * 작업 관리로 가는 단추는 화면 위 작업 세션 바 한 곳에만 둔다(같은 단추가 두 곳에 있었다). 숨긴 것이 없으면 그리지 않는다.
 */
export function PastEventsLink({ hidden }: { hidden: number }) {
  if (hidden <= 0) return null;
  return (
    <p
      title="지금 실행 전 이벤트는 작업 관리의 날짜 화면(다시 보기)에서 봅니다."
      className="px-1 pt-1 text-sm text-muted-foreground"
    >
      이번 실행 전 이벤트 {hidden}건은 목록에서 뺐습니다
    </p>
  );
}
