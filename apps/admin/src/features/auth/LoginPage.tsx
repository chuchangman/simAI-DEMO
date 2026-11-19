import { LoginHeadline, LoginHero } from '@/features/auth/LoginHero';
import { loginFormSchema } from '@/features/auth/types';
import { useLogin } from '@/features/auth/useLogin';
import { useMediaQuery } from '@/features/auth/useMediaQuery';
import { BrandMark, Wordmark } from '@/features/layout/BrandMark';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@simai/ui/components/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@simai/ui/components/input-group';
import { Label } from '@simai/ui/components/label';
import { Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

// 입력 칸은 높고 둥글게 하고 앞에 아이콘을 둔다. 아이콘을 눌러도 입력 칸으로 간다(InputGroupAddon).
// 기본 테두리는 얇고 옅게, 포커스는 은은한 파란 테두리·링 하나로 둔다. 기본 포커스(밝은 회색 테두리 + 회색 링)는 첫 칸이
// 자동 포커스라 늘 두껍게 겹쳐 보였다(-622 피드백).
// Tailwind 가 소스에서 그대로 찾도록 클래스 이름은 이어 붙이지 않고 통째로 적는다.
const FIELD =
  'h-12 rounded-xl border-white/10 bg-card/60 dark:bg-input/20 has-[[data-slot=input-group-control]:focus-visible]:border-sky-400/45 has-[[data-slot=input-group-control]:focus-visible]:ring-sky-400/15';
// 브라우저 자동완성은 입력 글자 칸만 밝은 회청색으로 칠해 아이콘·비밀번호 보기 칸과 갈라져 보였다(-620).
// 자동완성 배경색이 바뀌는 전환을 아주 길게 늘려 칠하지 않게 하고(칸 전체 배경이 그대로 보임), 글자색은 본문색으로 둔다.
const FIELD_INPUT =
  'h-full text-[15px] md:text-[15px] autofill:[transition:background-color_99999s_ease-out_0s] autofill:[-webkit-text-fill-color:var(--color-foreground)] [&:-webkit-autofill]:[transition:background-color_99999s_ease-out_0s] [&:-webkit-autofill]:[-webkit-text-fill-color:var(--color-foreground)]';
const FIELD_ICON = 'pl-3.5 [&>svg:not([class*=size-])]:size-[18px]';
// 오류 문구는 칸 아래 빈자리에 띄운다(absolute). 문구가 생겨도 폼 높이가 그대로라 세로 가운데 정렬된 로고·제목이 밀리지 않는다(-591).
// 칸 사이 간격(gap-8)과 비밀번호 칸과 버튼 사이(gap-8 + mt-0.5 = 34px)가 문구 한 줄(4 + 20px)을 담는다. 서버 문구는 모두 한 줄이다
// (loginErrorMessage). 버튼 간격은 넓어 보여 44px 에서 줄였다(-622 피드백).
const FIELD_ERROR = 'absolute top-full left-0 mt-1 text-sm leading-5 text-destructive';
// 로그인 버튼은 로고 글자의 파랑(#1D63F0→#094EFC)으로 칠하고 흰 글자(16px·600)를 쓴다. 흰 글자 대비 5.1:1 이상.
// 모서리는 입력 칸과 같은 rounded-xl(12px)이다. 알약 모양은 둥근 사각형 입력 칸과 모양이 달라 따로 보였다(-622 피드백).
// 예전 끝색 #3539FA 는 보라로 보여 로고의 하늘색·파랑보다 튀었고 광채도 강했다(-620). 그림자는 약하게 둔다.
// 다크 토큰 primary(#6886D5)에 검은 글자는 눌리지 않는 버튼처럼 흐려 보였다(-591).
const SUBMIT =
  'mt-0.5 h-12 cursor-pointer rounded-xl bg-linear-to-r from-[#1D63F0] to-[#094EFC] text-base font-semibold text-white shadow-md shadow-[#094EFC]/15 transition-[filter,box-shadow] hover:brightness-110 hover:shadow-[#094EFC]/25 disabled:cursor-default';

export function LoginPage() {
  const { login, pending, error } = useLogin();
  const [showPassword, setShowPassword] = useState(false);
  // 오른쪽 카드는 넓은 화면(lg)에서만 그린다. 좁은 화면에서 숨긴 채 영상을 받지 않게 한다.
  const wide = useMediaQuery('(min-width: 64rem)');
  const {
    register,
    handleSubmit,
    resetField,
    setFocus,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { username: '', password: '' },
  });

  return (
    // 페이지 전체가 한 장면이다(-622): 짙은 남색 바탕 하나에 넓은 빛 번짐을 깔고, 왼쪽 폼과 오른쪽 장면을 상자 없이 그 위에 바로 놓는다.
    // 예전에는 오른쪽 카드(남색 판·테두리 틀)와 왼쪽 유리 카드가 각각 상자라 좌우가 따로 놀았다. 바탕은 장면 영상의 배경색(#09101C 근처)에
    // 맞춰 영상 가장자리가 녹는다. 폼은 세로 가운데라 장면의 건물 높이와 나란하다. 좁은 화면(장면 없음)도 세로 가운데다.
    // 장면 영상이 어두운 배경이라 로그인 화면은 테마와 관계없이 늘 어둡게 둔다(dark).
    <main className="dark relative isolate grid min-h-svh overflow-hidden bg-[#0A111F] px-6 py-4 text-foreground lg:flex lg:items-center lg:justify-center lg:gap-[clamp(2rem,4vw,5rem)] lg:p-0">
      {/* 빛 번짐: 홀로그램 쪽 청록이 좌우 경계를 가로지르고, 너구리 뒤 파랑이 가장 밝다. 왼쪽 위·아래에도 옅게 깔아 폼 쪽까지 이어진다. */}
      <div
        aria-hidden="true"
        data-testid="login-backdrop"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(40%_48%_at_60%_46%,rgba(34,211,238,0.15),transparent_70%),radial-gradient(36%_40%_at_16%_10%,rgba(99,102,241,0.13),transparent_70%),radial-gradient(44%_36%_at_34%_96%,rgba(45,212,191,0.10),transparent_70%)]"
      />
      <section className="mx-auto flex w-full max-w-[400px] flex-col py-6 lg:mx-0 lg:w-[clamp(20rem,30vw,26rem)] lg:max-w-none lg:py-0">
        {/* 로고·헤드라인·폼을 한 묶음으로 세로 가운데에 둔다. "현장 안전 관제"·"관리자 계정으로…" 문구는 두지 않는다(-622). */}
        <div className="flex flex-1 items-center py-12">
          <div className="flex w-full flex-col gap-10">
            {/* 로고는 폼 묶음 맨 위에 하나만 둔다(오른쪽 장면에는 넣지 않음). 페이지 이름은 화면에 안 보이는 제목으로 남긴다. */}
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <BrandMark size={36} />
                <Wordmark size={36} />
                <h1 className="sr-only">simai 로그인</h1>
              </div>
              {wide && <LoginHeadline />}
            </div>
            <form
              noValidate
              className="flex flex-col gap-8"
              onSubmit={(event) => {
                // 보낼 때는 다시 가린다. 비밀번호 관리자가 칸을 알아보고, 화면에 비밀번호가 남지 않게 한다.
                setShowPassword(false);
                void handleSubmit((values) => {
                  // 아이디는 남기고 비밀번호는 보내자마자 지운다. 실패하면 비밀번호 칸으로 돌아가 다시 받는다.
                  login(values, { onError: () => setFocus('password') });
                  resetField('password');
                })(event);
              }}
            >
              <div className="relative flex flex-col gap-2">
                <Label htmlFor="username" className="font-semibold">
                  아이디
                </Label>
                <InputGroup className={FIELD}>
                  <InputGroupAddon className={FIELD_ICON}>
                    <UserRound aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="username"
                    placeholder="아이디를 입력하세요"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    className={FIELD_INPUT}
                    aria-invalid={errors.username ? true : undefined}
                    aria-describedby={errors.username ? 'username-error' : undefined}
                    {...register('username')}
                  />
                </InputGroup>
                {errors.username && (
                  <p id="username-error" className={FIELD_ERROR}>
                    {errors.username.message}
                  </p>
                )}
              </div>
              <div className="relative flex flex-col gap-2">
                <Label htmlFor="password" className="font-semibold">
                  비밀번호
                </Label>
                <InputGroup className={FIELD}>
                  <InputGroupAddon className={FIELD_ICON}>
                    <LockKeyhole aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="비밀번호를 입력하세요"
                    autoComplete="current-password"
                    className={FIELD_INPUT}
                    aria-invalid={errors.password ? true : undefined}
                    aria-describedby={errors.password ? 'password-error' : undefined}
                    {...register('password')}
                  />
                  <InputGroupAddon align="inline-end" className="pr-3">
                    <InputGroupButton
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground [&>svg]:size-[18px]"
                      aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((shown) => !shown)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                {errors.password ? (
                  <p id="password-error" className={FIELD_ERROR}>
                    {errors.password.message}
                  </p>
                ) : (
                  // 서버 오류(틀린 비밀번호 등)도 같은 자리에 띄워 폼이 밀리지 않게 한다.
                  error && (
                    <p role="alert" className={FIELD_ERROR}>
                      {error}
                    </p>
                  )
                )}
              </div>
              <Button type="submit" size="lg" disabled={pending} className={SUBMIT}>
                {pending ? '로그인 중…' : '로그인'}
              </Button>
            </form>
          </div>
        </div>
      </section>
      {wide && <LoginHero className="hidden lg:block" />}
    </main>
  );
}
