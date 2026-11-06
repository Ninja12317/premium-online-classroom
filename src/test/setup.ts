import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)

if (typeof window !== 'undefined') {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
}

// jsdom has no ResizeObserver; layout-driven components only need a no-op.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver
}
