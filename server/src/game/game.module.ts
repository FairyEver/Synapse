import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { NotificationModule } from "../notifications/notification.module"
import { HallModule } from "./hall/hall.module"
import { GameController } from "./game.controller"
import { GameApiService } from "./game-api.service"
import { PokerService } from "./poker/poker.service"
import { PokerActionService } from "./poker/poker-action.service"
import { PokerReadService } from "./poker/poker-read.service"
import { PokerWaitService } from "./poker/poker-wait.service"
import { PokerNudgeService } from "./poker/poker-nudge.service"
import { PokerArchiveService } from "./poker/poker-archive.service"
import { PokerDeadlineTask } from "./poker/poker-deadline.task"
import { PokerBotService } from "./poker/poker-bot.service"
import { PokerBotTask } from "./poker/poker-bot.task"
@Module({
  imports: [UserAuthModule, NotificationModule, HallModule],
  controllers: [GameController],
  providers: [
    GameApiService,
    PokerService,
    PokerActionService,
    PokerReadService,
    PokerWaitService,
    PokerNudgeService,
    PokerDeadlineTask,
    PokerArchiveService,
    PokerBotService,
    PokerBotTask,
  ],
})
export class GameModule {}
