import { Module } from "@nestjs/common"
import { PrismaModule } from "../../prisma/prisma.module"
import { HallService } from "./hall.service"
import { GameReserveService } from "./game-reserve.service"
@Module({ imports: [PrismaModule], providers: [HallService, GameReserveService], exports: [HallService, GameReserveService] })
export class HallModule {}
