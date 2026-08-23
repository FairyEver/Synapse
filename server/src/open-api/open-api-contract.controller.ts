import { Controller, Get, Header } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import { resolvePublicDocumentUrl } from "../common/public-document-url"
import {
  OPEN_API_CONTRACT_BASE_PATH,
  OPEN_API_CONTRACT_PATH,
  createOpenApiContractDocument,
} from "./open-api-contract"

@Controller(OPEN_API_CONTRACT_BASE_PATH)
export class OpenApiContractController {
  @Get(OPEN_API_CONTRACT_PATH)
  @Header("Content-Type", "application/vnd.oai.openapi+json;version=3.1")
  @Header("Cache-Control", "public, max-age=300")
  @SkipThrottle()
  document() {
    return createOpenApiContractDocument(resolvePublicDocumentUrl({
      configuredDocumentPublicUrl: process.env.DOCUMENT_PUBLIC_URL,
      configuredPublicAppUrl: process.env.APP_PUBLIC_URL,
    }))
  }
}
