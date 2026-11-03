import { BadRequestException, Controller, Get, Param, PayloadTooLargeException, Put, Req, Res, StreamableFile, UseGuards } from "@nestjs/common"
import type { Request, Response } from "express"
import type { Readable } from "node:stream"
import { z } from "zod"
import { TODO_IMAGE_VARIANTS, TODO_MAX_IMAGE_BYTES, TODO_MAX_THUMBNAIL_BYTES, TODO_THUMBNAIL_SIZE_HEADER } from "@synapse/shared/todo-contracts"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { TodoImageService } from "./todo-image.service"

type AuthedRequest = Request & { user: { id: string } }
const imageIdSchema = z.uuid().transform(id => id.toLowerCase())
const imageParams = z.object({ todoId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/u), imageId: imageIdSchema, variant: z.enum(TODO_IMAGE_VARIANTS) })

@Controller("/api/todos")
@UseGuards(UserAuthGuard)
export class TodoImagesController {
  constructor(private readonly images: TodoImageService) {}

  @Put("images/:imageId")
  async stage(@Req() request: AuthedRequest, @Param("imageId") imageId: string) {
    const id = imageIdSchema.safeParse(imageId)
    const thumbnailSize = Number(request.get(TODO_THUMBNAIL_SIZE_HEADER))
    if (!id.success || !request.is("application/octet-stream") || !Number.isSafeInteger(thumbnailSize)
      || thumbnailSize < 1 || thumbnailSize > TODO_MAX_THUMBNAIL_BYTES) {
      throw new BadRequestException("图片请求无效")
    }
    const limit = TODO_MAX_IMAGE_BYTES + thumbnailSize
    if (Number(request.get("content-length")) > limit) throw new PayloadTooLargeException("图片不能超过 20 MB")
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > limit) throw new PayloadTooLargeException("图片不能超过 20 MB")
      chunks.push(bytes)
    }
    if (size <= thumbnailSize) throw new BadRequestException("图片为空")
    const bytes = Buffer.concat(chunks, size)
    return this.images.stage(request.user.id, id.data, bytes.subarray(0, size - thumbnailSize), bytes.subarray(size - thumbnailSize))
  }

  @Get(":todoId/images/:imageId/:variant")
  async read(@Req() request: AuthedRequest, @Param() params: unknown, @Res({ passthrough: true }) response: Response) {
    const parsed = imageParams.safeParse(params)
    if (!parsed.success) throw new BadRequestException("图片请求无效")
    const { todoId, imageId, variant } = parsed.data
    const image = await this.images.open(request.user.id, todoId, imageId, variant)
    response.setHeader("X-Content-Type-Options", "nosniff")
    return new StreamableFile(image.stream as Readable, { type: image.mimeType, length: image.byteSize, disposition: "inline" })
  }
}
