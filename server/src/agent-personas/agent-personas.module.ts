import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { AgentPersonasController } from "./agent-personas.controller"
import { AgentPersonasService } from "./agent-personas.service"

@Module({
  imports: [UserAuthModule, PrismaModule],
  controllers: [AgentPersonasController],
  providers: [AgentPersonasService],
  exports: [AgentPersonasService],
})
export class AgentPersonasModule {}
