// @vitest-environment jsdom

import { act, useImperativeHandle, type Ref } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { ApiError } from '@/lib/api'
import { useDriveDocumentEditorLifecycle } from './drive-document-editor-lifecycle'
import type { DriveRendererEditContext } from './drive-renderer-shell'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const telemetry = vi.hoisted(() => ({ finish: vi.fn(), start: vi.fn() }))

vi.mock('../shared/drive-telemetry', () => ({
  startDriveOperation: (...args: unknown[]) => {
    telemetry.start(...args)
    return telemetry.finish
  },
}))

type HarnessApi = {
  readonly updateValue: (value: string) => void
  readonly save: () => Promise<void>
  readonly reload: () => Promise<void>
  readonly requestReload: () => void
}

type HarnessProps = {
  readonly initialText: string
  readonly currentVersionId?: string
  readonly editContext: DriveRendererEditContext
  readonly onReplaceValue?: (value: string) => string | void
  readonly apiRef: Ref<HarnessApi>
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  telemetry.finish.mockReset()
  telemetry.start.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('useDriveDocumentEditorLifecycle', () => {
  it('keeps edits made while a save is pending dirty after the saved version is acknowledged', async () => {
    const pendingSave = deferred<void>()
    const saveText = vi.fn(async () => {
      await pendingSave.promise
      return {} as never
    })
    const apiRef = { current: null } as { current: HarnessApi | null }
    const props = harnessProps(apiRef, saveText)
    renderHarness(props)

    act(() => apiRef.current?.updateValue('# Submitted'))
    let savePromise: Promise<void> | undefined
    act(() => { savePromise = apiRef.current?.save() })
    await act(async () => apiRef.current?.reload())
    act(() => apiRef.current?.updateValue('# Newer draft'))
    renderHarness({ ...props, initialText: '# Submitted', currentVersionId: 'version-2' })

    expect(status()).toEqual({ value: '# Newer draft', dirty: 'true', conflict: 'false', reloadConfirm: 'false' })
    expect(saveAcknowledged()).toBe(true)
    expect(saveText).toHaveBeenCalledWith({ text: '# Submitted', baseVersionId: 'version-1' })
    expect(props.editContext.reload).not.toHaveBeenCalled()

    await act(async () => {
      pendingSave.resolve()
      await savePromise
    })
    renderHarness({ ...props, initialText: '# Submitted', currentVersionId: 'version-2' })

    expect(status()).toEqual({ value: '# Newer draft', dirty: 'true', conflict: 'false', reloadConfirm: 'false' })
    expect(saveAcknowledged()).toBe(false)
    expect(telemetry.finish).toHaveBeenCalledWith('success')
  })

  it('preserves the local draft and opens recovery when the current version conflicts', async () => {
    const saveText = vi.fn(async () => {
      throw new ApiError('文件已有新内容。', 409)
    })
    const apiRef = { current: null } as { current: HarnessApi | null }
    renderHarness(harnessProps(apiRef, saveText))

    act(() => apiRef.current?.updateValue('# Local draft'))
    await act(async () => apiRef.current?.save())

    expect(status()).toEqual({ value: '# Local draft', dirty: 'true', conflict: 'true', reloadConfirm: 'false' })
    expect(telemetry.finish).toHaveBeenCalledWith('failure')
  })

  it('confirms a dirty reload, replaces the draft, and excludes a concurrent save', async () => {
    const pendingReload = deferred<DriveBrowserSnapshotDto>()
    const saveText = vi.fn(async () => ({} as never))
    const reload = vi.fn(() => pendingReload.promise)
    const onReplaceValue = vi.fn((value: string) => value)
    const apiRef = { current: null } as { current: HarnessApi | null }
    renderHarness(harnessProps(apiRef, saveText, { reload, onReplaceValue }))

    act(() => apiRef.current?.updateValue('# Local draft'))
    act(() => apiRef.current?.requestReload())
    expect(status().reloadConfirm).toBe('true')

    let reloadPromise: Promise<void> | undefined
    act(() => { reloadPromise = apiRef.current?.reload() })
    await act(async () => apiRef.current?.save())
    expect(saveText).not.toHaveBeenCalled()

    await act(async () => {
      pendingReload.resolve({ preview: { text: '# Server' } } as DriveBrowserSnapshotDto)
      await reloadPromise
    })

    expect(onReplaceValue).toHaveBeenLastCalledWith('# Server', 'reload')
    expect(status()).toEqual({ value: '# Server', dirty: 'false', conflict: 'false', reloadConfirm: 'false' })
    expect(telemetry.finish).toHaveBeenCalledWith('success')
  })
})

function LifecycleHarness({
  initialText,
  currentVersionId = 'version-1',
  editContext,
  onReplaceValue,
  apiRef,
}: HarnessProps) {
  const lifecycle = useDriveDocumentEditorLifecycle({
    itemId: 'file-1',
    initialText,
    currentVersionId,
    editContext,
    canEdit: true,
    telemetryComponent: 'drive-test-editor',
    onReplaceValue,
  })
  useImperativeHandle(apiRef, () => ({
    updateValue: lifecycle.updateValue,
    save: () => lifecycle.save(),
    reload: lifecycle.reload,
    requestReload: lifecycle.requestReload,
  }), [lifecycle.reload, lifecycle.requestReload, lifecycle.save, lifecycle.updateValue])
  return (
    <div
      data-value={lifecycle.value}
      data-dirty={lifecycle.dirty}
      data-conflict={lifecycle.conflictOpen}
      data-reload-confirm={lifecycle.reloadConfirmOpen}
      data-save-acknowledged={lifecycle.saveAcknowledged}
    />
  )
}

function harnessProps(
  apiRef: Ref<HarnessApi>,
  saveText: DriveRendererEditContext['saveText'],
  overrides: Partial<Pick<HarnessProps, 'editContext' | 'onReplaceValue'>> = {},
): HarnessProps {
  return {
    initialText: '# Initial',
    editContext: overrides.editContext ?? {
      reload: vi.fn(async () => ({ preview: { text: '# Server' } }) as DriveBrowserSnapshotDto),
      reloading: false,
      saveText,
      savingText: false,
    },
    onReplaceValue: overrides.onReplaceValue,
    apiRef,
  }
}

function renderHarness(props: HarnessProps) {
  act(() => root.render(<LifecycleHarness {...props} />))
}

function status() {
  const state = host.firstElementChild as HTMLDivElement
  return {
    value: state.dataset.value,
    dirty: state.dataset.dirty,
    conflict: state.dataset.conflict,
    reloadConfirm: state.dataset.reloadConfirm,
  }
}

function saveAcknowledged() {
  return (host.firstElementChild as HTMLDivElement).dataset.saveAcknowledged === 'true'
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
