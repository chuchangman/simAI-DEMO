import {
  describeRebake,
  supplementLimitText,
  uploadBlockedText,
} from '@/features/setup/supplement';
import { SupplementUploadList } from '@/features/setup/SupplementUploadList';
import { useSetupSession } from '@/features/setup/useSetupStep1';
import { useSupplementCapture } from '@/features/setup/useSupplementCapture';
import { Alert } from '@simai/ui/components/alert';
import { Button } from '@simai/ui/components/button';
import { Camera, Images, Video } from 'lucide-react';
import { useRef, type ChangeEvent, type ReactNode } from 'react';

// 휴대폰 맵 보강 촬영 화면(/m/supplement/{세팅 세션}, S15P31A101-607). 세팅 화면의 QR 로 연다. 관리자 로그인 뒤 휴대폰 카메라로
// 동영상·사진을 찍거나 갤러리에서 골라 그 세팅 세션에 올린다. 휴대폰은 등록 카메라가 아니고 이 파일은 맵 굽기에만 쓴다.

const TIPS = [
  '고정 카메라도 보이는 곳에서 시작하기',
  '천천히 움직이기',
  '기본(1x) 렌즈 쓰기',
  '초광각·어안 렌즈 쓰지 않기',
  '무늬 없는 벽만 찍지 않기',
] as const;

function PickButton({
  label,
  icon,
  accept,
  capture,
  multiple = false,
  disabled,
  onFiles,
}: {
  label: string;
  icon: ReactNode;
  accept: string;
  capture?: 'environment';
  multiple?: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFiles([...(event.target.files ?? [])]);
    event.target.value = '';
  };
  return (
    <>
      <Button
        size="lg"
        className="h-14 w-full justify-center gap-2 text-base"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {icon}
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        capture={capture}
        multiple={multiple}
        aria-label={label}
        className="hidden"
        onChange={onChange}
      />
    </>
  );
}

export function SupplementPhonePage({ sessionId }: { sessionId: string }) {
  const sessionQuery = useSetupSession(sessionId);
  const session = sessionQuery.data;
  const capture = useSupplementCapture(session, 'PHONE_UPLOAD');
  const rebake = capture.rebake ? describeRebake(capture.rebake, capture.supplement?.media) : null;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">맵 보강 촬영</h1>
        <p className="text-sm text-muted-foreground">
          {session
            ? `올린 파일 ${capture.supplement?.media.length ?? 0}개`
            : sessionQuery.error
              ? '세팅 세션을 불러오지 못했습니다'
              : '세팅 세션을 불러오는 중'}
        </p>
      </header>

      <section aria-label="촬영 요령" className="rounded-lg bg-card px-4 py-3">
        <h2 className="text-sm font-semibold">촬영 요령</h2>
        <ul className="mt-1.5 list-disc pl-5 text-sm text-muted-foreground">
          {TIPS.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </section>

      {session && !capture.canUpload && (
        <Alert role="status">
          <p className="text-sm">{uploadBlockedText(capture.supplement?.rebake_blocked_reason)}</p>
        </Alert>
      )}

      <div className="flex flex-col gap-2.5">
        <PickButton
          label="동영상 찍기"
          icon={<Video aria-hidden className="size-5" />}
          accept="video/*"
          capture="environment"
          disabled={!capture.canUpload}
          onFiles={capture.addFiles}
        />
        <PickButton
          label="사진 찍기"
          icon={<Camera aria-hidden className="size-5" />}
          accept="image/*"
          capture="environment"
          disabled={!capture.canUpload}
          onFiles={capture.addFiles}
        />
        <PickButton
          label="갤러리에서 고르기"
          icon={<Images aria-hidden className="size-5" />}
          accept="video/*,image/*"
          multiple
          disabled={!capture.canUpload}
          onFiles={capture.addFiles}
        />
        <p className="text-center text-xs text-muted-foreground">
          {supplementLimitText(capture.limits)}
        </p>
      </div>

      <SupplementUploadList
        rows={capture.rows}
        rejected={capture.rejected}
        onAction={capture.onRowAction}
        removingMediaId={capture.removingMediaId}
        large
      />

      {capture.error && (
        <p role="alert" className="text-sm">
          {capture.error}
        </p>
      )}

      {rebake && (
        <p role="status" className="text-sm text-muted-foreground">
          맵 다시 굽기 · {rebake.title}
          {rebake.detail ? ` · ${rebake.detail}` : ''}
        </p>
      )}
    </div>
  );
}
