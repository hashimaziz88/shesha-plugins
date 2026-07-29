// jsdom implements neither of these, and the component modules touch both at
// import time via responsive/canvas hooks.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  });
}

if (!global.ResizeObserver) {
  global.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
}
