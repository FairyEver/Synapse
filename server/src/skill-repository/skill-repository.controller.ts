import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { badRequestFromZodError } from "../common/zod-validation"
import { SkillRepositoryService } from "./skill-repository.service"

const fileSchema = z.object({
  path: z.string().min(1).max(1024).refine((value) => value.trim().length > 0, "路径不能为空。"),
  contentBase64: z.string().min(1).refine(isStrictBase64, "必须是有效的 base64 内容"),
  mimeType: z.string().trim().max(255).nullable().optional(),
}).strict()

const importSchema = z.object({
  repositoryId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(64).nullable().optional(),
  title: z.string().trim().min(1).max(160).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  files: z.array(fileSchema).min(1).max(200),
}).strict()

@UseGuards(UserAuthGuard)
@Controller("/api/skill-repositories")
export class SkillRepositoryController {
  constructor(private readonly service: SkillRepositoryService) {}

  @Get("/mine")
  listMine(@Req() request: AuthenticatedUserRequest) {
    return this.service.listMine(request.user!.id)
  }

  @Get("/:id")
  getMine(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.service.getMine(request.user!.id, id)
  }

  @Post("/import")
  importRepository(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(importSchema, body, "Skill 仓库导入请求无效。")
    return this.service.importRepository(request.user!.id, {
      repositoryId: parsed.repositoryId ?? undefined,
      name: parsed.name ?? undefined,
      title: parsed.title ?? undefined,
      description: parsed.description ?? undefined,
      files: parsed.files,
    })
  }
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw badRequestFromZodError(result.error, message)
  return result.data
}

function isStrictBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
}
