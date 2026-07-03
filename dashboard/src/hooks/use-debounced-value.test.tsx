// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from './use-debounced-value'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('useDebouncedValue', () => {
  let host: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    root?.unmount()
    host?.remove()
    root = null
    host = null
    vi.useRealTimers()
  })

  it('keeps the previous value until the delay passes', async () => {
    vi.useFakeTimers()
    const values: string[] = []

    renderValue('a', values)
    expect(values.at(-1)).toBe('a')

    renderValue('abc', values)
    expect(values.at(-1)).toBe('a')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299)
    })
    expect(values.at(-1)).toBe('a')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(values.at(-1)).toBe('abc')
  })

  function renderValue(value: string, values: string[]) {
    host ??= document.createElement('div')
    if (!host.isConnected) document.body.append(host)
    root ??= createRoot(host)

    act(() => {
      root!.render(<DebouncedProbe value={value} values={values} />)
    })
  }
})

function DebouncedProbe({
  value,
  values,
}: {
  readonly value: string
  readonly values: string[]
}) {
  values.push(useDebouncedValue(value, 300))
  return null
}
