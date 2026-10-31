# 德州扑克音效

来源：[Kenney Casino Audio 1.1](https://kenney.nl/assets/casino-audio)，作者 Kenney Vleugels。
下载：[作者在 OpenGameArt 发布的资源包](https://opengameart.org/content/54-casino-sound-effects-cards-dice-chips)。
直接下载地址：https://opengameart.org/sites/default/files/kenney_casino-audio.zip

2026-10-31 下载，资源包 SHA-256：`f36250766ac5bc378c13708ddf12a23a8e54a3251f8d482c7536e51b5dbafa18`。
许可为 CC0，可商业使用、修改与再分发；原始许可完整保留在 `LICENSE.txt`。以下文件原样复制自包内 `Audio/`，未裁剪、转码或修改音量，总计 51,365 字节。

| 文件 | 用途 |
| --- | --- |
| card-slide-4.ogg | 新手发牌 |
| card-place-2.ogg | 新公共牌 |
| card-shove-4.ogg | 弃牌 |
| chip-lay-1.ogg | 过牌、本人行动提示 |
| chips-collide-1.ogg / chips-collide-2.ogg | 下注、普通派彩，交替短碰撞 |
| chips-stack-1.ogg | 街末收池 |

赢池落袋素材来自同一作者的 [RPG Audio](https://kenney.nl/assets/rpg-audio)，同为 CC0；[作者发布页](https://opengameart.org/content/50-rpg-sound-effects)，直接下载地址为 https://opengameart.org/sites/default/files/RPGsounds_Kenney.zip 。2026-10-31 下载，资源包 SHA-256：`3ae398ad63e293f9c450bda22d5d81c3af69c74df66fc1400f33c012c0bbc231`。原始许可正文保存在 `RPG-LICENSE.txt`，仅统一换行与空白。以下三个文件原样复制自包内 `OGG/`，共 50,183 字节：

| 文件 | 用途 | 时长 |
| --- | --- | --- |
| dropLeather.ogg | 落袋的皮革落下声 | 0.415 秒 |
| handleCoins.ogg | 较长的金属金币碰撞 | 0.846 秒 |
| handleCoins2.ogg | 较短的金属金币碰撞 | 0.338 秒 |

Vite 静态导入并本地打包；运行时仅加载打包资源，不请求音效网站。
Web Audio 主增益固定 0.35，筹码反馈增益从 0.35 调为 0.5（约增加 3dB），其他反馈音量保持原值。小额按一元一枚响，5 元五次、10 元十次；金额不超过 12 时一元一枚，超过 12 时按 `min(16, 12 + ceil(log2(amount / 12)))` 平滑增加次数，最多 16 次，例如 13 元十三次、32 元十四次、50 元十五次、100 元十六次；金额增加不会因换面额而减少声音。碰撞间隔为 `max(55, round(105 - log2(max(1, amount)) × 6))` 毫秒，金额越大越快，最快间隔 55ms，不随金额提高音量。新公共牌每张一次，三张响三次，相邻间隔 120ms；转牌、河牌各一次，重复快照不重播。新手最多六次发牌声，同批动作归并而不排长队，同批最多调度 40 个声源，覆盖下注、翻牌及派彩组合。派奖只有实际赢池声音，退款不冒充中奖；无背景音乐或持续倒计时音。

本人在玩家视角实际赢得非退款底池且本手净盈利时，以专属落袋组合替代普通派彩碰撞；其他人的赢池和本人净亏仍为普通派彩反馈。丰富程度按本人本手净赢 `delta` 计算，不按全桌底池、总派彩或退款额计算；分池合并成一次反馈。先在 520ms 播放皮袋落下声（增益 0.3），100ms 后交替播放两种金属金币声（增益固定 0.38）。以净赢金额的十进制数量级分档：1–9 两段、10–99 三段、100–999 四段、1000–9999 五段、10000 以上六段；段间隔从 190ms 缩短至 110ms，不提高音量。包含派奖等待和素材尾音，组合最长约 1.99 秒。退款、未赢池、净收益不为正或旁观视角均不触发落袋组合；结算去重及静音清理沿用既有约束。

首个键盘或指针交互解锁音频；素材未加载、播放未获允许时丢弃当前提示，不延后补播。静音仅作用于当前牌桌组件生命周期，不新增持久化设置。静音、失焦、隐藏和卸载停止所有已调度声源；恢复与超过三秒的快照间隔只建立基线。音效仅比较权威快照，不读取历史事件、不反馈尚未成功的请求，不影响牌局控制和资金状态。
