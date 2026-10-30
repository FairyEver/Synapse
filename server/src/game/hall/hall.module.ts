import { Module } from "@nestjs/common"
import { PrismaModule } from "../../prisma/prisma.module"
import { HallService } from "./hall.service"
@Module({ imports: [PrismaModule], providers: [HallService], exports: [HallService] })
export class HallModule {}
