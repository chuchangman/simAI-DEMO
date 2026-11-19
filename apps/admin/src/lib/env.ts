import { parseEnv } from '@/lib/parseEnv';

// 검사는 parseEnv 에 두고 여기서는 읽기만 한다. 테스트가 import.meta.env 에 기대지 않게 하려는 것이다.
export const env = parseEnv(import.meta.env, { production: import.meta.env.PROD });
