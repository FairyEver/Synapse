import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common"
import type { z } from "zod"
import type { Request } from "express"
import { TODO_IMAGES_HEADER, TODO_PRIORITY_HEADER, type TodoItemDto } from "@synapse/shared/todo-contracts"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { badRequestFromZodError } from "../common/zod-validation"
import { TodosService } from "./todos.service"
import { todoCompletionSchema, todoCreateSchema, todoDeleteSchema, todoListSchema, todoUpdateSchema } from "./todo.schemas"
type AuthedRequest = Request & { user: { id: string } }
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw badRequestFromZodError(result.error, "待办参数无效")
  return result.data
}
function todoResponse(req: AuthedRequest, item: TodoItemDto): TodoItemDto {
  // Older desktop versions reject unknown fields in the response.
  const { priority, imageIds, ...legacy } = item
  return { ...legacy,
    ...(req.headers[TODO_PRIORITY_HEADER] === "1" ? { priority: priority ?? null } : {}),
    ...(req.headers[TODO_IMAGES_HEADER] === "1" ? { imageIds: imageIds ?? [] } : {}),
  }
}
@Controller("/api/todos")
@UseGuards(UserAuthGuard)
export class TodosController {
  constructor(private readonly todos: TodosService) {}
  @Get() async list(@Req() req: AuthedRequest, @Query() input: unknown) {
    const page = await this.todos.list(req.user.id, parse(todoListSchema, input))
    return { ...page, items: page.items.map((item) => todoResponse(req, item)) }
  }
  @Get(":id") async get(@Req() req: AuthedRequest, @Param("id") id: string) {
    return todoResponse(req, await this.todos.get(req.user.id, id))
  }
  @Post() async create(@Req() req: AuthedRequest, @Body() input: unknown) {
    return todoResponse(req, await this.todos.create(req.user.id, parse(todoCreateSchema, input)))
  }
  @Patch(":id") async update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() input: unknown) {
    return todoResponse(req, await this.todos.update(req.user.id, id, parse(todoUpdateSchema, input)))
  }
  @Patch(":id/completion") async complete(@Req() req: AuthedRequest, @Param("id") id: string, @Body() input: unknown) {
    return todoResponse(req, await this.todos.setCompleted(req.user.id, id, parse(todoCompletionSchema, input)))
  }
  @Delete(":id") delete(@Req() req: AuthedRequest, @Param("id") id: string, @Body() input: unknown) { return this.todos.delete(req.user.id, id, parse(todoDeleteSchema, input)) }
}
