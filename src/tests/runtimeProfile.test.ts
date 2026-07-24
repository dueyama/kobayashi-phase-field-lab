import { describe, expect, it } from 'vitest';
import { detectRuntimeProfile } from '../app/runtimeProfile';

describe('detectRuntimeProfile', () => {
  it('recognizes iPhone Safari as mobile', () => {
    expect(
      detectRuntimeProfile({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5
      })
    ).toBe('mobile');
  });

  it('recognizes iPad desktop browsing mode as mobile hardware', () => {
    expect(
      detectRuntimeProfile({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5
      })
    ).toBe('mobile');
  });

  it('keeps a desktop Mac in the desktop profile', () => {
    expect(
      detectRuntimeProfile({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 0
      })
    ).toBe('desktop');
  });
});
