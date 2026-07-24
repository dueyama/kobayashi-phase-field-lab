export type RuntimeProfile = 'mobile' | 'desktop';

type NavigatorHints = Pick<Navigator, 'maxTouchPoints' | 'platform' | 'userAgent'>;

export function detectRuntimeProfile(
  navigatorHints: NavigatorHints | undefined = typeof navigator === 'undefined' ? undefined : navigator
): RuntimeProfile {
  if (!navigatorHints) return 'desktop';

  const userAgent = navigatorHints.userAgent;
  const isMobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const isDesktopModeIpad =
    navigatorHints.platform === 'MacIntel' && navigatorHints.maxTouchPoints > 1;

  return isMobileUserAgent || isDesktopModeIpad ? 'mobile' : 'desktop';
}
