import { Module } from "@nestjs/common"
import { PrismaModule } from "../prisma/prisma.module"
import { InvitationsService } from "./invitations.service"

@Module({
  imports: [PrismaModule],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
