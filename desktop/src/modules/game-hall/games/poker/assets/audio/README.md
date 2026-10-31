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
| chips-collide-1.ogg / chips-collide-2.ogg | 下注、派彩，交替短碰撞 |
| chips-stack-1.ogg | 街末收池 |

Vite 静态导入并本地打包；运行时仅加载打包资源，不请求音效网站。
Web Audio 主增益固定 0.35，各反馈增益最高 0.35；金额按大盲倍数对数增加 1–6 次碰撞，间隔 75ms，金额不提高音量。新手最多六次发牌声，同批动作归并而不排长队。派奖只有实际赢池声音，退款不冒充中奖；无背景音乐或持续倒计时音。

首个键盘或指针交互解锁音频；素材未加载、播放未获允许时丢弃当前提示，不延后补播。静音仅作用于当前牌桌组件生命周期，不新增持久化设置。静音、失焦、隐藏和卸载停止所有已调度声源；恢复与超过三秒的快照间隔只建立基线。音效仅比较权威快照，不读取历史事件、不反馈尚未成功的请求，不影响牌局控制和资金状态。
