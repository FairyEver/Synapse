import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common"
import type { z } from "zod"
import type { Request } from "express"
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
@Controller("/api/todos")
@UseGuards(UserAuthGuard)
export class TodosController {
  constructor(private readonly todos: TodosService) {}
  @Get() list(@Req() req: AuthedRequest, @Query() input: unknown) { return this.todos.list(req.user.id, parse(todoListSchema, input)) }
  @Get(":id") get(@Req() req: AuthedRequest, @Param("id") id: string) { return this.todos.get(req.user.id, id) }
  @Post() create(@Req() req: AuthedRequest, @Body() input: unknown) { return this.todos.create(req.user.id, parse(todoCreateSchema, input)) }
  @Patch(":id") update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() input: unknown) { return this.todos.update(req.user.id, id, parse(todoUpdateSchema, input)) }
  @Patch(":id/completion") complete(@Req() req: AuthedRequest, @Param("id") id: string, @Body() input: unknown) { return this.todos.setCompleted(req.user.id, id, parse(todoCompletionSchema, input)) }
  @Delete(":id") delete(@Req() req: AuthedRequest, @Param("id") id: string, @Body() input: unknown) { return this.todos.delete(req.user.id, id, parse(todoDeleteSchema, input)) }
}
