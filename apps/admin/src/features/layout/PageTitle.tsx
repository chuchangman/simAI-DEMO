// 화면 이름. 관제 데모처럼 화면에는 보이지 않고 화면 읽기 프로그램만 읽는다(아래 메뉴가 지금 화면을 보인다).
export function PageTitle({ children }: { children: string }) {
  return <h1 className="sr-only">{children}</h1>;
}
