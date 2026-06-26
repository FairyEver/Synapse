import { DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION, inferDrivePublicAssetMimeType } from "@synapse/shared"

import { requireSynapseBridge } from "@/lib/electron-bridge"

const supportedImageMimeTypes = new Set<string>(Object.values(DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION))

export type DriveMarkdownImageUploaderBridge = {
  readonly account: Pick<ReturnType<typeof requireSynapseBridge>["account"], "uploadDrivePublicAssetBinary">
}

export function createDriveMarkdownImageUploader(
  getBridge: () => DriveMarkdownImageUploaderBridge = requireSynapseBridge,
) {
  return {
    async upload(file: File): Promise<string> {
      const name = file.name || "image.png"
      const mimeType = file.type || inferDrivePublicAssetMimeType(name)

      if (!mimeType || !supportedImageMimeTypes.has(mimeType)) {
        throw new Error("格式不支持。")
      }

      const asset = await getBridge().account.uploadDrivePublicAssetBinary({
        name,
        mimeType,
        data: await file.arrayBuffer(),
      })

      return asset.url
    },
  }
}
