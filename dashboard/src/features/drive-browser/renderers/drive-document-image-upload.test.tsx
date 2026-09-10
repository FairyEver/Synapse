// @vitest-environment jsdom

import { act, useImperativeHandle, type Ref } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriveHostedDocumentImageDto } from '@synapse/shared'
import { driveBrowserApi, type DriveDocumentImageUploadContext } from '@/lib/api'
import { useDriveDocumentImageUpload } from './drive-document-image-upload'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../shared/drive-telemetry', () => ({
  startDriveOperation: () => vi.fn(),
}))

type HarnessApi = {
  readonly invalidatePendingUploads: () => void
  readonly uploadDocumentImage: (file: File) => Promise<string>
  readonly uploadOptionalDocumentImage: (file: File | null) => Promise<string>
}

type HarnessProps = {
  readonly itemId: string
  readonly currentVersionId?: string | null
  readonly imageUploadContext?: DriveDocumentImageUploadContext
  readonly onError: (message: string | null) => void
  readonly apiRef: Ref<HarnessApi>
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('useDriveDocumentImageUpload', () => {
  it('invalidates an upload when the current file changes', async () => {
    const upload = deferred<DriveHostedDocumentImageDto>()
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockReturnValue(upload.promise)
    const apiRef = { current: null } as { current: HarnessApi | null }
    const onError = vi.fn()
    renderHarness(harnessProps(apiRef, onError))

    let uploadPromise: Promise<string> | undefined
    act(() => { uploadPromise = apiRef.current?.uploadDocumentImage(imageFile('old.png')) })
    expect(uploading()).toBe(true)

    renderHarness(harnessProps(apiRef, onError, {
      itemId: 'file-2',
      imageUploadContext: { kind: 'owner', itemId: 'file-2' },
    }))
    expect(uploading()).toBe(false)

    await act(async () => {
      upload.resolve(hostedImage())
      await expect(uploadPromise).rejects.toThrow('图片上传已失效。')
    })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenLastCalledWith(null)
  })

  it('invalidates an upload when the current version changes', async () => {
    const upload = deferred<DriveHostedDocumentImageDto>()
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockReturnValue(upload.promise)
    const apiRef = { current: null } as { current: HarnessApi | null }
    const onError = vi.fn()
    const props = harnessProps(apiRef, onError)
    renderHarness(props)

    let uploadPromise: Promise<string> | undefined
    act(() => { uploadPromise = apiRef.current?.uploadDocumentImage(imageFile('old.png')) })
    renderHarness({ ...props, currentVersionId: 'version-2' })

    expect(uploading()).toBe(false)
    await act(async () => {
      upload.resolve(hostedImage())
      await expect(uploadPromise).rejects.toThrow('图片上传已失效。')
    })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenLastCalledWith(null)
  })

  it('invalidates an upload explicitly without replacing the active error', async () => {
    const upload = deferred<DriveHostedDocumentImageDto>()
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage').mockReturnValue(upload.promise)
    const apiRef = { current: null } as { current: HarnessApi | null }
    const onError = vi.fn()
    renderHarness(harnessProps(apiRef, onError))

    let uploadPromise: Promise<string> | undefined
    act(() => { uploadPromise = apiRef.current?.uploadDocumentImage(imageFile('old.png')) })
    act(() => apiRef.current?.invalidatePendingUploads())

    expect(uploading()).toBe(false)
    await act(async () => {
      upload.resolve(hostedImage())
      await expect(uploadPromise).rejects.toThrow('图片上传已失效。')
    })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenLastCalledWith(null)
  })

  it('tracks concurrent uploads until all settle and preserves the failure message', async () => {
    const firstUpload = deferred<DriveHostedDocumentImageDto>()
    const secondUpload = deferred<DriveHostedDocumentImageDto>()
    vi.spyOn(driveBrowserApi, 'uploadHostedDocumentImage')
      .mockReturnValueOnce(firstUpload.promise)
      .mockReturnValueOnce(secondUpload.promise)
    const apiRef = { current: null } as { current: HarnessApi | null }
    const onError = vi.fn()
    renderHarness(harnessProps(apiRef, onError))

    let resultsPromise: Promise<PromiseSettledResult<string>[]> | undefined
    act(() => {
      resultsPromise = Promise.allSettled([
        apiRef.current?.uploadOptionalDocumentImage(imageFile('first.png')) as Promise<string>,
        apiRef.current?.uploadOptionalDocumentImage(imageFile('second.png')) as Promise<string>,
      ])
    })
    expect(uploading()).toBe(true)

    await act(async () => {
      firstUpload.reject(new Error('上传服务不可用。'))
      await Promise.resolve()
    })
    expect(uploading()).toBe(true)
    expect(onError).toHaveBeenLastCalledWith('上传服务不可用。')

    await act(async () => {
      secondUpload.resolve(hostedImage('/object/second'))
      await expect(resultsPromise).resolves.toEqual([
        expect.objectContaining({ status: 'rejected' }),
        { status: 'fulfilled', value: '/object/second' },
      ])
    })
    expect(uploading()).toBe(false)
    expect(onError).toHaveBeenLastCalledWith('上传服务不可用。')
  })
})

function ImageUploadHarness({
  itemId,
  currentVersionId,
  imageUploadContext,
  onError,
  apiRef,
}: HarnessProps) {
  const upload = useDriveDocumentImageUpload({
    canEdit: true,
    itemId,
    currentVersionId,
    imageUploadContext,
    telemetryComponent: 'drive-test-editor',
    onError,
  })
  useImperativeHandle(apiRef, () => ({
    invalidatePendingUploads: upload.invalidatePendingUploads,
    uploadDocumentImage: upload.uploadDocumentImage,
    uploadOptionalDocumentImage: upload.uploadOptionalDocumentImage,
  }), [upload.invalidatePendingUploads, upload.uploadDocumentImage, upload.uploadOptionalDocumentImage])
  return <div data-uploading={upload.uploadingImage} />
}

function harnessProps(
  apiRef: Ref<HarnessApi>,
  onError: (message: string | null) => void,
  overrides: Partial<Omit<HarnessProps, 'apiRef' | 'onError'>> = {},
): HarnessProps {
  return {
    itemId: 'file-1',
    currentVersionId: 'version-1',
    imageUploadContext: { kind: 'owner', itemId: 'file-1' },
    onError,
    apiRef,
    ...overrides,
  }
}

function renderHarness(props: HarnessProps): void {
  act(() => root.render(<ImageUploadHarness {...props} />))
}

function uploading(): boolean {
  return (host.firstElementChild as HTMLDivElement).dataset.uploading === 'true'
}

function imageFile(name: string): File {
  return new File(['image'], name, { type: 'image/png' })
}

function hostedImage(url = '/object/image'): DriveHostedDocumentImageDto {
  return {
    imageId: 'img_00000000000000000000000000000000',
    name: 'image.png',
    size: '5',
    mimeType: 'image/png',
    url,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
