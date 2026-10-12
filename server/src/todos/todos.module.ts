import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common"
import type { NextFunction, Request, Response } from "express"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { TodosController } from "./todos.controller"
import { TodosService } from "./todos.service"
import { TodoRepository } from "./todo.repository"
import { NotificationModule } from "../notifications/notification.module"
import { LiveModule } from "../live/live.module"
import { MobileLiveModule } from "../mobile-live/mobile-live.module"
import { TodoEvents } from "./todo-events"
import { TodoReminderWorker } from "./todo-reminder.worker"
import { TodoReminderOutbox } from "./todo-reminder-outbox"
@Module({ imports: [UserAuthModule, PrismaModule, NotificationModule, LiveModule, MobileLiveModule], controllers: [TodosController],
  providers: [TodosService, TodoRepository, TodoEvents, TodoReminderWorker, TodoReminderOutbox], exports: [TodosService] })
export class TodosModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(setTodoNoStore).forRoutes(TodosController)
  }
}

function setTodoNoStore(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader("Cache-Control", "private, no-store")
  next()
}
