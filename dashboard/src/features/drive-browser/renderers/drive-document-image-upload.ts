import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DRIVE_DOCUMENT_IMAGE_MAX_BYTES,
  DRIVE_DOCUMENT_IMAGE_MAX_SIZE_LABEL,
  DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION,
  inferDrivePublicAssetMimeType,
} from '@synapse/shared'
import type { DriveDocumentImageUploadContext } from '@/lib/api'
import { trackedDriveBrowserApi as driveBrowserApi } from '../shared/drive-telemetry-api'
import { startDriveOperation } from '../shared/drive-telemetry'

type DrivePublicAssetImageMimeType = typeof DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION[keyof typeof DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION]

const DRIVE_PUBLIC_ASSET_IMAGE_MIME_TYPES = Object.values(DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION) as readonly DrivePublicAssetImageMimeType[]

export const DRIVE_DOCUMENT_IMAGE_ACCEPT = Object.keys(DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(',')

export function useDriveDocumentImageUpload({
  canEdit,
  imageUploadContext,
  lifecycleKey,
  telemetryComponent,
  onError,
}: {
  readonly canEdit: boolean
  readonly imageUploadContext?: DriveDocumentImageUploadContext
  readonly lifecycleKey: string
  readonly telemetryComponent: string
  readonly onError: (message: string | null) => void
}) {
  const uploadScope = driveDocumentImageUploadScope(imageUploadContext, lifecycleKey)
  const activeScopeRef = useRef(uploadScope)
  const generationRef = useRef(0)
  const pendingCountRef = useRef(0)
  const [uploadState, setUploadState] = useState({ scope: uploadScope, uploading: false })
  const uploadingImage = uploadState.scope === uploadScope && uploadState.uploading

  useEffect(() => {
    activeScopeRef.current = uploadScope
    generationRef.current += 1
    pendingCountRef.current = 0
    setUploadState({ scope: uploadScope, uploading: false })
    return () => {
      generationRef.current += 1
    }
  }, [uploadScope])

  const uploadDocumentImage = useCallback(async (file: File) => {
    if (!canEdit || !imageUploadContext) throw new Error('图片上传不可用。')
    const validationError = driveDocumentImageValidationError(file)
    if (validationError) {
      onError(validationError)
      throw new Error(validationError)
    }
    const input = resolveDriveDocumentImageUploadInput(file)
    if (!input) {
      onError('格式不支持。')
      throw new Error('格式不支持。')
    }
    onError(null)
    const finishTracking = startDriveOperation('web.drive.editor.image-upload', telemetryComponent)
    const uploadGeneration = generationRef.current
    const uploadScopeAtStart = activeScopeRef.current
    pendingCountRef.current += 1
    setUploadState({ scope: uploadScopeAtStart, uploading: true })
    try {
      const uploaded = await driveBrowserApi.uploadHostedDocumentImage(file, imageUploadContext, input).catch((uploadError: unknown) => {
        finishTracking('failure')
        if (generationRef.current === uploadGeneration) {
          onError(uploadError instanceof Error ? uploadError.message : '图片上传失败。')
        }
        throw uploadError
      })
      finishTracking('success')
      if (generationRef.current !== uploadGeneration) throw new Error('图片上传已失效。')
      return uploaded.url
    } finally {
      if (generationRef.current === uploadGeneration) {
        pendingCountRef.current -= 1
        if (pendingCountRef.current === 0) {
          setUploadState({ scope: uploadScopeAtStart, uploading: false })
        }
      }
    }
  }, [canEdit, imageUploadContext, onError, telemetryComponent])

  const uploadOptionalDocumentImage = useCallback((file: File | null) => {
    if (file) return uploadDocumentImage(file)
    const message = '图片内容为空，请重新复制或选择图片。'
    onError(message)
    return Promise.reject(new Error(message))
  }, [onError, uploadDocumentImage])

  return { uploadingImage, uploadDocumentImage, uploadOptionalDocumentImage }
}

function driveDocumentImageUploadScope(
  context: DriveDocumentImageUploadContext | undefined,
  lifecycleKey: string,
): string {
  if (!context) return `${lifecycleKey}:unavailable`
  if (context.kind === 'owner') return `${lifecycleKey}:owner:${context.itemId}`
  return `${lifecycleKey}:share:${context.shareId}:${context.itemId ?? ''}`
}

export function driveDocumentImageValidationError(file: File | null | undefined): string | null {
  if (!file || file.size <= 0) return '图片内容为空，请重新复制或选择图片。'
  if (file.size > DRIVE_DOCUMENT_IMAGE_MAX_BYTES) return `图片超过 ${DRIVE_DOCUMENT_IMAGE_MAX_SIZE_LABEL} 限制。`
  if (!resolveDriveDocumentImageUploadInput(file)) return '格式不支持。'
  return null
}

export function driveDocumentImageAltText(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'image'
  return trimmed.replace(/\.(?:png|jpe?g|gif|webp|avif|ico)$/iu, '') || 'image'
}

function resolveDriveDocumentImageUploadInput(file: File): { readonly name: string; readonly mimeType: DrivePublicAssetImageMimeType } | null {
  const name = file.name || 'image.png'
  const mimeType = file.type || inferDrivePublicAssetMimeType(name)
  if (!isDrivePublicAssetImageMimeType(mimeType)) return null
  return { name, mimeType }
}

function isDrivePublicAssetImageMimeType(value: string | null): value is DrivePublicAssetImageMimeType {
  return Boolean(value && DRIVE_PUBLIC_ASSET_IMAGE_MIME_TYPES.includes(value as DrivePublicAssetImageMimeType))
}
