import { describe, expect, it } from 'vitest'

import {
  getInstallGuidance,
  isIOSDevice,
  isIOSSafari,
  isStandaloneDisplay,
} from '@/lib/use-pwa-install'

describe('PWA install detection helpers', () => {
  it('detects iPhone, iPad, and iPadOS desktop-class user agents', () => {
    expect(
      isIOSDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        5,
      ),
    ).toBe(true)

    expect(
      isIOSDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
        5,
      ),
    ).toBe(true)

    expect(
      isIOSDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        0,
      ),
    ).toBe(false)

    expect(
      isIOSDevice(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
        5,
      ),
    ).toBe(false)
  })

  it('distinguishes iOS Safari from Chrome/Firefox on iOS', () => {
    const safariIphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    const chromeIphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.108 Mobile/15E148 Safari/604.1'

    expect(isIOSSafari(safariIphone, 5)).toBe(true)
    expect(isIOSSafari(chromeIphone, 5)).toBe(false)
  })

  it('detects standalone display mode across iOS and Chromium', () => {
    expect(isStandaloneDisplay(null)).toBe(false)
    expect(
      isStandaloneDisplay({
        navigator: { standalone: true },
        matchMedia: () => ({ matches: false }),
      }),
    ).toBe(true)
    expect(
      isStandaloneDisplay({
        navigator: { standalone: false },
        matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }),
      }),
    ).toBe(true)
    expect(
      isStandaloneDisplay({
        navigator: { standalone: false },
        matchMedia: () => ({ matches: false }),
      }),
    ).toBe(false)
  })

  it('returns accurate platform guidance when beforeinstallprompt is unavailable', () => {
    expect(
      getInstallGuidance({
        userAgent: 'Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36',
        isInIframe: true,
      }),
    ).toBe('iframe')

    expect(
      getInstallGuidance({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
        maxTouchPoints: 5,
      }),
    ).toBe('ios-safari')

    expect(
      getInstallGuidance({
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
        maxTouchPoints: 5,
      }),
    ).toBe('android')

    expect(
      getInstallGuidance({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        maxTouchPoints: 0,
      }),
    ).toBe('desktop-chromium')

    expect(
      getInstallGuidance({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
        maxTouchPoints: 0,
      }),
    ).toBe('desktop-safari')
  })
})
