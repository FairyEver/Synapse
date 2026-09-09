import type { Crepe } from '@milkdown/crepe'
import { imageInlineComponent, inlineImageConfig } from '@milkdown/kit/component/image-inline'
import { uploadConfig } from '@milkdown/kit/plugin/upload'

type MilkdownCommonMarkImageOptions = {
  readonly altText: (file: File) => string
  readonly confirmButton: string
  readonly onUpload: (file: File) => Promise<string>
  readonly proxyDomURL: (url: string) => Promise<string> | string
  readonly uploadButton: string
  readonly uploadPlaceholderText: string
}

export function configureMilkdownCommonMarkImages(
  crepe: Crepe,
  options: MilkdownCommonMarkImageOptions,
): void {
  crepe.editor
    .config((ctx) => {
      ctx.update(inlineImageConfig.key, (value) => ({
        ...value,
        confirmButton: options.confirmButton,
        onUpload: options.onUpload,
        proxyDomURL: options.proxyDomURL,
        uploadButton: options.uploadButton,
        uploadPlaceholderText: options.uploadPlaceholderText,
      }))
      ctx.update(uploadConfig.key, (value) => ({
        ...value,
        uploader: async (files, schema) => {
          const imageType = schema.nodes.image
          if (!imageType) return []
          const nodes = await Promise.all(Array.from(files).map(async (file) => imageType.createAndFill({
            alt: options.altText(file),
            src: await options.onUpload(file),
            title: '',
          })))
          return nodes.filter((node): node is NonNullable<typeof node> => node !== null)
        },
      }))
    })
    .use(imageInlineComponent)
}
