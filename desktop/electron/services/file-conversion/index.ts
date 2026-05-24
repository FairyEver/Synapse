import { DocxExtractor } from "./extractors/docx"
import { LegacyOfficeExtractor } from "./extractors/legacy-office"
import { PdfExtractor } from "./extractors/pdf"
import { PptxExtractor } from "./extractors/pptx"
import { XlsxExtractor } from "./extractors/xlsx"
import { FileConversionService } from "./service"
import type { LocalOcrEngine } from "./ocr/types"

export { detectConversionFormat, FileExtractorRegistry } from "./registry"
export { FileConversionService, type FileConversionServiceOptions } from "./service"
export { DocxExtractor, type DocxExtractorOptions } from "./extractors/docx"
export { LegacyOfficeExtractor, type LegacyOfficeExtractorOptions } from "./extractors/legacy-office"
export { PdfExtractor, type PdfExtractorOptions } from "./extractors/pdf"
export { PptxExtractor, type PptxExtractorOptions } from "./extractors/pptx"
export { XlsxExtractor, type XlsxExtractorOptions } from "./extractors/xlsx"
export { createUnavailableLocalOcrEngine, UnavailableLocalOcrEngine } from "./ocr/local-ocr"
export type { LocalOcrEngine, LocalOcrRecognitionResult, LocalOcrWarning } from "./ocr/types"
export {
  FileConversionError,
  type FileConversionErrorCode,
  type FileConversionFormat,
  type FileConversionInput,
  type FileConversionKind,
  type FileConversionResult,
  type FileConversionWarning,
  type FileExtractor,
} from "./types"

export interface DefaultFileConversionServiceOptions {
  readonly localOcrEngine?: LocalOcrEngine
}

export function createDefaultFileConversionService(options: DefaultFileConversionServiceOptions = {}): FileConversionService {
  return new FileConversionService({
    localOcrEngine: options.localOcrEngine,
    extractors: [
      new DocxExtractor(),
      new XlsxExtractor(),
      new PdfExtractor({ localOcrEngine: options.localOcrEngine }),
      new PptxExtractor(),
      new LegacyOfficeExtractor(),
    ],
  })
}
