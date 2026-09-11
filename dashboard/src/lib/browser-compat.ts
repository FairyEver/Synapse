type Indexable = {
  readonly length: number
  readonly [index: number]: unknown
}

type ObjectConstructorWithHasOwn = ObjectConstructor & {
  hasOwn?: (value: object, key: PropertyKey) => boolean
}

export function createBrowserUuid(): string {
  const browserCrypto = globalThis.crypto
  if (typeof browserCrypto?.randomUUID === 'function') return browserCrypto.randomUUID()

  return createFallbackUuid(browserCrypto)
}

function createFallbackUuid(browserCrypto: Crypto | undefined): string {
  const bytes = new Uint8Array(16)
  if (typeof browserCrypto?.getRandomValues === 'function') {
    browserCrypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] ?? 0) & 0x0f | 0x40
  bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
}

export function installBrowserCompatibility(): void {
  const browserCrypto = globalThis.crypto
  if (browserCrypto && typeof browserCrypto.randomUUID !== 'function') {
    defineMethod(browserCrypto, 'randomUUID', () => createFallbackUuid(browserCrypto))
  }
  installAt(Array.prototype)
  installAt(String.prototype)
  installAt(Object.getPrototypeOf(Uint8Array.prototype) as object)
  installReplaceAll()

  const objectConstructor = Object as ObjectConstructorWithHasOwn
  if (typeof objectConstructor.hasOwn !== 'function') {
    defineMethod(objectConstructor, 'hasOwn', (value: object, key: PropertyKey) => {
      if (value === null || value === undefined) throw new TypeError('Object.hasOwn called on null or undefined')
      return Object.prototype.hasOwnProperty.call(value, key)
    })
  }
}

function installReplaceAll(): void {
  if (typeof Reflect.get(String.prototype, 'replaceAll') === 'function') return
  defineMethod(String.prototype, 'replaceAll', function replaceAll(
    this: string,
    searchValue: string | RegExp,
    replaceValue: string | ((substring: string, ...args: unknown[]) => string),
  ) {
    const source = String(this)
    if (searchValue instanceof RegExp) {
      if (!searchValue.global) throw new TypeError('String.replaceAll requires a global regular expression')
      return source.replace(searchValue, replaceValue as string)
    }
    return source.replace(new RegExp(escapeRegExp(String(searchValue)), 'g'), replaceValue as string)
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function installAt(prototype: object): void {
  if (typeof Reflect.get(prototype, 'at') === 'function') return
  defineMethod(prototype, 'at', function at(this: Indexable, index: number) {
    const length = this.length
    const relativeIndex = normalizeIndex(index)
    const actualIndex = relativeIndex >= 0 ? relativeIndex : length + relativeIndex
    return actualIndex < 0 || actualIndex >= length ? undefined : this[actualIndex]
  })
}

function normalizeIndex(value: number): number {
  const number = Number(value)
  if (Number.isNaN(number) || number === 0) return 0
  if (!Number.isFinite(number)) return number
  return Math.trunc(number)
}

function defineMethod(target: object, name: string, value: (...args: never[]) => unknown): boolean {
  try {
    Object.defineProperty(target, name, {
      configurable: true,
      enumerable: false,
      value,
      writable: true,
    })
    return true
  } catch {
    return false
  }
}

installBrowserCompatibility()
