// DOM facilities used by React Aria that jsdom does not implement.
if (typeof window !== 'undefined') {
  window.CSS ??= {} as typeof CSS
  if (!window.CSS.escape) window.CSS.escape = (value: string) => Array.from(String(value), (char, index) => {
    const code = char.codePointAt(0) ?? 0
    if (code === 0) return '\uFFFD'
    if ((code >= 1 && code <= 31) || code === 127 || (index === 0 && code >= 48 && code <= 57)) return `\\${code.toString(16)} `
    return code >= 128 || /[\w-]/u.test(char) ? char : `\\${char}`
  }).join('')
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }))
  globalThis.ResizeObserver ??= class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
  Element.prototype.getAnimations ??= function () { return [] }
  Element.prototype.scrollIntoView ??= function () {}
  Element.prototype.scrollTo ??= function () {}
}
