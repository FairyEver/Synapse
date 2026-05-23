import { DocxExtractor } from "./extractors/docx"
import { LegacyOfficeExtractor } from "./extractors/legacy-office"
import { PdfExtractor } from "./extractors/pdf"
import { PptxExtractor } from "./extractors/pptx"
import { XlsxExtractor } from "./extractors/xlsx"
import { FileConversionService } from "./service"

export { detectConversionFormat, FileExtractorRegistry } from "./registry"
export { FileConversionService, type FileConversionServiceOptions } from "./service"
export { DocxExtractor, type DocxExtractorOptions } from "./extractors/docx"
export { LegacyOfficeExtractor, type LegacyOfficeExtractorOptions } from "./extractors/legacy-office"
export { PdfExtractor, type PdfExtractorOptions } from "./extractors/pdf"
export { PptxExtractor, type PptxExtractorOptions } from "./extractors/pptx"
export { XlsxExtractor } from "./extractors/xlsx"
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

export function createDefaultFileConversionService(): FileConversionService {
  return new FileConversionService({
    extractors: [
      new DocxExtractor(),
      new XlsxExtractor(),
      new PdfExtractor(),
      new PptxExtractor(),
      new LegacyOfficeExtractor(),
    ],
  })
}
