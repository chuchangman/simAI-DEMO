import { useEffect, useState } from 'react';

/**
 * 이미지를 미리 받아 두고 다 받은 주소만 돌려준다. 서명 주소가 새로 바뀌어도 새 이미지를 다 받을 때까지는
 * 이전 이미지를 그대로 보여 주므로 화면이 깜박이지 않는다. 받지 못하면 이전 주소를 유지한다.
 */
export function useLoadedImage(url: string | null | undefined): string | undefined {
  const [loaded, setLoaded] = useState<string>();
  useEffect(() => {
    if (!url) return undefined;
    const image = new Image();
    let cancelled = false;
    image.onload = () => {
      if (!cancelled) setLoaded(url);
    };
    image.src = url;
    return () => {
      cancelled = true;
      image.onload = null;
    };
  }, [url]);
  return loaded;
}
