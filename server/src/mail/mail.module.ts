import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { NotificationModule } from "../notifications/notification.module"
import { PrismaModule } from "../prisma/prisma.module"
import { MailController } from "./mail.controller"
import { MailService } from "./mail.service"
import { MailStorageService } from "./mail-storage.service"

@Module({
  imports: [UserAuthModule, PrismaModule, NotificationModule],
  controllers: [MailController],
  providers: [MailService, MailStorageService],
  exports: [MailService],
})
export class MailModule {}
