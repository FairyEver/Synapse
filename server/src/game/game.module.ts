import { PokerRollService } from "./poker/poker-roll.service"
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
import { PokerEventsService } from "./poker/poker-events.service"
import { PokerCardService } from "./poker/poker-card.service"
import { PokerCardWebGuard } from "./poker-card-web.guard"
import { GameWebGuard } from "./game-web.guard"
@Module({
  imports: [UserAuthModule, NotificationModule, HallModule],
  controllers: [GameController],
  providers: [
    GameWebGuard,
    PokerCardWebGuard,
    PokerCardService,
    GameApiService,
    PokerService,
    PokerActionService,
    PokerRollService,
    PokerReadService,
    PokerWaitService,
    PokerNudgeService,
    PokerDeadlineTask,
    PokerArchiveService,
    PokerBotService,
    PokerBotTask,
    PokerEventsService,
  ],
})
export class GameModule {}
