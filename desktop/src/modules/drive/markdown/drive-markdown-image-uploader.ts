import { DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION } from "@synapse/shared"

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
      if (!supportedImageMimeTypes.has(file.type)) {
        throw new Error("格式不支持。")
      }

      const asset = await getBridge().account.uploadDrivePublicAssetBinary({
        name: file.name || "image.png",
        mimeType: file.type,
        data: await file.arrayBuffer(),
      })

      return asset.url
    },
  }
}
