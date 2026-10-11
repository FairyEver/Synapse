import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { TodosController } from "./todos.controller"
import { TodosService } from "./todos.service"
import { TodoRepository } from "./todo.repository"
@Module({ imports: [UserAuthModule, PrismaModule], controllers: [TodosController], providers: [TodosService, TodoRepository], exports: [TodosService] })
export class TodosModule {}
