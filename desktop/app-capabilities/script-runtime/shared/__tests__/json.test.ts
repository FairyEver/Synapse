import { describe, expect, it } from "vitest"

import {
  assertStrictJson,
  SCRIPT_INPUT_MAX_BYTES,
  serializeStrictJson,
  serializeStrictJsonObjectWithProxyDetector,
} from "../json"

describe("strict JSON contract", () => {
  it("rejects sparse arrays and arrays with extra own keys", () => {
    expect(() => assertStrictJson(Array(1))).toThrow()

    const withExtraKey = [1] as unknown[] & { extra?: number }
    withExtraKey.extra = 2
    expect(() => assertStrictJson(withExtraKey)).toThrow()
  })

  it("rejects symbol and non-enumerable properties", () => {
    const withSymbol = { ok: true } as Record<PropertyKey, unknown>
    withSymbol[Symbol("extra")] = false
    expect(() => assertStrictJson(withSymbol)).toThrow()

    const withHiddenProperty = { ok: true }
    Object.defineProperty(withHiddenProperty, "hidden", {
      enumerable: false,
      value: 1,
    })
    expect(() => assertStrictJson(withHiddenProperty)).toThrow()
  })

  it("rejects accessors without invoking their getters", () => {
    let objectGetterCalls = 0
    const objectWithGetter = {}
    Object.defineProperty(objectWithGetter, "value", {
      enumerable: true,
      get() {
        objectGetterCalls += 1
        return 1
      },
    })

    let arrayGetterCalls = 0
    const arrayWithGetter = [0]
    Object.defineProperty(arrayWithGetter, "0", {
      enumerable: true,
      get() {
        arrayGetterCalls += 1
        return 1
      },
    })

    expect(() => assertStrictJson(objectWithGetter)).toThrow()
    expect(() => assertStrictJson(arrayWithGetter)).toThrow()
    expect(objectGetterCalls).toBe(0)
    expect(arrayGetterCalls).toBe(0)
  })

  it("rejects hidden toJSON without invoking it during validation or serialization", () => {
    let toJsonCalls = 0
    const value = { retained: true }
    Object.defineProperty(value, "toJSON", {
      enumerable: false,
      value() {
        toJsonCalls += 1
        return { rewritten: true }
      },
    })

    expect(() => assertStrictJson(value)).toThrow()
    expect(() => serializeStrictJson(value, SCRIPT_INPUT_MAX_BYTES, "input")).toThrow()
    expect(toJsonCalls).toBe(0)
  })

  it("accepts null-prototype objects, dense arrays, and shared non-circular references", () => {
    const shared = Object.assign(Object.create(null) as Record<string, unknown>, { value: 1 })
    const input = Object.assign(Object.create(null) as Record<string, unknown>, {
      items: [shared, null],
      alias: shared,
    })

    expect(() => assertStrictJson(input)).not.toThrow()
    expect(serializeStrictJson(input, SCRIPT_INPUT_MAX_BYTES, "input"))
      .toBe('{"items":[{"value":1},null],"alias":{"value":1}}')
  })

  it("serializes descriptor values without inherited toJSON hooks", () => {
    const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON")
    const arrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON")
    let objectToJsonCalls = 0
    let arrayToJsonCalls = 0
    try {
      Object.defineProperty(Object.prototype, "toJSON", {
        configurable: true,
        value() {
          objectToJsonCalls += 1
          return { rewritten: "object" }
        },
      })
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value() {
          arrayToJsonCalls += 1
          return ["rewritten"]
        },
      })
      const shared = Object.assign(Object.create(null) as Record<string, unknown>, { value: 1 })
      const input = Object.assign(Object.create(null) as Record<string, unknown>, {
        object: { retained: true },
        array: [1, null],
        shared,
        alias: shared,
      })

      expect(serializeStrictJson(input, SCRIPT_INPUT_MAX_BYTES, "input"))
        .toBe('{"object":{"retained":true},"array":[1,null],"shared":{"value":1},"alias":{"value":1}}')
      expect(serializeStrictJsonObjectWithProxyDetector(input, "input", () => false))
        .toBe('{"object":{"retained":true},"array":[1,null],"shared":{"value":1},"alias":{"value":1}}')
      expect(objectToJsonCalls).toBe(0)
      expect(arrayToJsonCalls).toBe(0)
    } finally {
      restoreProperty(Object.prototype, "toJSON", objectToJson)
      restoreProperty(Array.prototype, "toJSON", arrayToJson)
    }
  })

  it("continues to reject non-finite numbers and circular references", () => {
    expect(() => assertStrictJson(Number.POSITIVE_INFINITY)).toThrow()

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => assertStrictJson(circular)).toThrow()
  })
})

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor)
  } else {
    Reflect.deleteProperty(target, key)
  }
}
