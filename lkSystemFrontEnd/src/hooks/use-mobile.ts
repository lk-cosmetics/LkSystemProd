import * as React from 'react';

const MOBILE_BREAKPOINT = 1024;

export function useIsMobile() {
  const mediaQuery = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

  const getMatches = React.useCallback(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.matchMedia(mediaQuery).matches;
  }, [mediaQuery]);

  const [isMobile, setIsMobile] = React.useState<boolean>(getMatches);

  React.useEffect(() => {
    const mql = window.matchMedia(mediaQuery);
    const onChange = () => setIsMobile(mql.matches);

    onChange();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }

    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [mediaQuery]);

  return isMobile;
}
