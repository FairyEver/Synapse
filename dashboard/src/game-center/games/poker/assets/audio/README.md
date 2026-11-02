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
| chip-lay-1.ogg | 单枚筹码落地、过牌、本人行动提示 |
| chips-collide-1.ogg / chips-collide-2.ogg | 保留的旧版碰撞素材，当前不加载 |
| chips-stack-1.ogg | 保留的旧版收池素材，当前不加载 |

赢池落袋素材来自同一作者的 [RPG Audio](https://kenney.nl/assets/rpg-audio)，同为 CC0；[作者发布页](https://opengameart.org/content/50-rpg-sound-effects)，直接下载地址为 https://opengameart.org/sites/default/files/RPGsounds_Kenney.zip 。2026-10-31 下载，资源包 SHA-256：`3ae398ad63e293f9c450bda22d5d81c3af69c74df66fc1400f33c012c0bbc231`。原始许可正文保存在 `RPG-LICENSE.txt`，仅统一换行与空白。以下三个文件原样复制自包内 `OGG/`，共 50,183 字节：

| 文件 | 用途 | 时长 |
| --- | --- | --- |
| dropLeather.ogg | 落袋的皮革落下声 | 0.415 秒 |
| handleCoins.ogg | 较长的金属金币碰撞 | 0.846 秒 |
| handleCoins2.ogg | 较短的金属金币碰撞 | 0.338 秒 |

Vite 静态导入并本地打包；运行时仅加载使用中的本地资源，不请求音效网站。上述 RPG 旧版落袋/金币素材保留原始文件和许可，当前不加载、不播放。

Web Audio 主增益固定 0.35。筹码音效完全跟随实际飞行元素：每枚动画结束播放一次 `chip-lay-1.ogg`，不用下注金额、底池金额或本人净赢推算次数。100 拆成一枚 100，只响一次；501 拆成 500+1，分别落地各响一次。沿用飞行元素现有数量上限，未展示的枚数不额外补声。普通下注、Roll 费用、派彩、返还和 Roll 补偿共用此规则；快照与街末不再另播收池或落袋组合。

使用 WAAPI 单枚 `finished` 成功回调与 CSS 降级单枚 `animationend`，不以固定计时猜落地时刻。每枚轻微变化播放速度（0.97–1.03）及增益（0.3–0.35），不随面额/金额增加音量；后续落地及翻牌等快照反馈保留已有碰撞尾音。动画取消、重复结束、兜底计时、静态重排和减少动态效果即时完成不额外响。首次进入/断流恢复仅建立展示基线，不重播历史。

新公共牌每张一次，相邻间隔 120ms；转牌、河牌各一次，重复快照不重播。新手最多六次发牌声，保留过牌、弃牌与本人行动提示；无背景音乐或持续倒计时音。

首个键盘或指针交互解锁音频；素材未加载、播放未获允许时丢弃当前提示，不延后补播。静音仅作用于当前牌桌组件生命周期，不新增持久化设置。静音、失焦、隐藏和卸载停止所有声源；恢复与超过三秒的快照间隔只建立基线。音效不反馈尚未成功的请求，不影响牌局控制和资金状态。
