import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserUuid, installBrowserCompatibility } from './browser-compat'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser compatibility', () => {
  it('creates an RFC 4122 UUID when crypto.randomUUID is unavailable', () => {
    let nextByte = 0
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_value, index) => {
          bytes[index] = nextByte
          nextByte += 1
        })
        return bytes
      },
    })

    installBrowserCompatibility()

    expect(createBrowserUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(globalThis.crypto.randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  })

  it('keeps browser compatibility installation idempotent', () => {
    expect(() => {
      installBrowserCompatibility()
      installBrowserCompatibility()
    }).not.toThrow()
  })

  it('installs the missing collection and string helpers used by the share bundle', () => {
    const arrayAt = Object.getOwnPropertyDescriptor(Array.prototype, 'at')
    const stringAt = Object.getOwnPropertyDescriptor(String.prototype, 'at')
    const replaceAll = Object.getOwnPropertyDescriptor(String.prototype, 'replaceAll')
    const hasOwn = Object.getOwnPropertyDescriptor(Object, 'hasOwn')

    try {
      Reflect.deleteProperty(Array.prototype, 'at')
      Reflect.deleteProperty(String.prototype, 'at')
      Reflect.deleteProperty(String.prototype, 'replaceAll')
      Reflect.deleteProperty(Object, 'hasOwn')

      installBrowserCompatibility()

      expect(Reflect.apply(Reflect.get(Array.prototype, 'at'), ['first', 'last'], [-1])).toBe('last')
      expect(Reflect.apply(Reflect.get(String.prototype, 'at'), 'Synapse', [-1])).toBe('e')
      expect(Reflect.apply(Reflect.get(String.prototype, 'replaceAll'), 'a.b.a', ['a', 'x'])).toBe('x.b.x')
      expect(Reflect.apply(Reflect.get(Object, 'hasOwn'), Object, [{ own: true }, 'own'])).toBe(true)
    } finally {
      restoreProperty(Array.prototype, 'at', arrayAt)
      restoreProperty(String.prototype, 'at', stringAt)
      restoreProperty(String.prototype, 'replaceAll', replaceAll)
      restoreProperty(Object, 'hasOwn', hasOwn)
    }
  })
})

function restoreProperty(target: object, name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(target, name, descriptor)
  else Reflect.deleteProperty(target, name)
}
