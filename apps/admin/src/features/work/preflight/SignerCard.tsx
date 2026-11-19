import { SignerList } from '@/features/work/preflight/SignerList';
import type { SignersState } from '@/features/work/preflight/useSigners';
import { Badge } from '@simai/ui/components/badge';
import { Button } from '@simai/ui/components/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@simai/ui/components/card';

// 작업 전 확인의 '참석자 서명' 카드: 머리에 서명한 사람 수와 '서명하기', 아래에 서명자 줄(이름 · 썸네일 · 삭제).

export function SignerCard({
  signers,
  onSign,
}: {
  signers: SignersState;
  /** '서명하기': 서명 창을 연다. */
  onSign: () => void;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2>참석자 서명</h2>
        </CardTitle>
        <CardAction className="flex items-center gap-2">
          <Badge variant="outline" className="rounded-[4px]">{`${signers.count}명`}</Badge>
          <Button size="sm" onClick={onSign}>
            서명하기
          </Button>
        </CardAction>
      </CardHeader>
      {signers.count > 0 && (
        <CardContent>
          <SignerList signers={signers} />
        </CardContent>
      )}
    </Card>
  );
}
