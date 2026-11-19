import { ROLES } from '@/store/session.store';
import { z } from 'zod';

// 로그인·갱신 응답(서버 -61 TokenResponse). 쓰는 칸만 검사하고 tokenType·displayLabel 은 버린다.
// 서버 OpenAPI 가 나오면 생성 타입으로 바꾼다.
export const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  /** access 토큰 유효 시간(초). mock 은 주지 않는다(만료되지 않는다). */
  expiresIn: z.number().positive().optional(),
  user: z.object({
    id: z.string().min(1),
    role: z.enum(ROLES),
  }),
});

export const loginFormSchema = z.object({
  username: z.string().trim().min(1, '아이디를 입력하세요'),
  password: z.string().min(1, '비밀번호를 입력하세요'),
});

export type LoginForm = z.infer<typeof loginFormSchema>;
