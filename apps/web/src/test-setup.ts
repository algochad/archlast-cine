// Shared vitest setup: minimal browser-API shims for the jsdom environment.
// Pure-logic suites (src/lib) run under the same environment; these shims
// only fill gaps jsdom leaves so component suites (src/components) can mount.

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

if (typeof window !== "undefined" && !window.requestAnimationFrame) {
  window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    window.setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = (id: number): void => window.clearTimeout(id);
}
