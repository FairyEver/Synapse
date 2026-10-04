# iOS 工作区文件面板 UI 重做

日期：2026-10-04

状态：本文记录原始静态审查、重做方案与后续用户授权的模拟器截图复核。原始重做的构建结果见第 6 节；后续目录标题修正与实际截图见第 7 节。未执行的 VoiceOver、iPad 或窗口验收不得据此声称通过。

范围：现有终端内「工作区文件」面板的内容组织、搜索、范围与视图选择、目录/文件行、已修改概要。面板的系统弹出方式、导航及只读业务协议保持现有边界。协议、安全、预算、取消、分页与版本校验仍以 [工作区文件 V1 spec](2026-10-03-mobile-workspace-files-and-changes-spec.md) 和 [移动端运行时约束](../../agents/mobile-runtime-contracts.md) 为准。

## 1. 证据与判断方式

本次按 [apple-design](../../../.agents/skills/apple-design/SKILL.md) 阅读 Apple 官方 HIG 正文与 SwiftUI/UIKit API。HIG 网页入口部分只返回 JavaScript 提示，正文通过 Apple 官方 `developer.apple.com/tutorials/data/design/human-interface-guidelines/*.json` 文档数据核实。下文链接指向对应的人类可读官方主题。

五张截图分别展示：

1. 中高度面板，工作区文件列表仅露出底部一个目录行的部分内容。
2. 展开高度面板，所有文件视图，目录均折叠。
3. 展开 `.agents`，显示子目录 `skills`。
4. 打开「当前目录 / 仓库」范围菜单。
5. 打开「已修改 / 所有文件」视图菜单。

截图可以证明当前可见布局，不能证明使用中的字体设置、VoiceOver 朗读、键盘焦点、其他窗口尺寸或真实控件尺寸。源码证据来自重做前的 `WorkspaceFilesPanel.swift`、`WorkspaceFilesNativeSearchField.swift`、`WorkspaceFilesNativeEntry.swift`、`WorkspaceFilesNativeTable.swift` 及 `WorkspaceFilesContent.swift`；后续行号会随实施变化，因此以下用符号定位。

本次核对 Xcode 工程最低部署版本为 iOS 18。系统 sheet 的圆角、抓手、系统菜单的圆角与阴影、工具栏的系统玻璃外观、系统 body 字体和 44pt 点击目标本身不是缺陷。不要通过压小文字、缩小点击区域或自制系统装饰来提高密度。

下文有 35 个审查项：1–28 为截图或源码支持的问题及设计判断，29–31 为未复现的适配风险，32–35 为验收维度。它们不能混称为 35 个已复现错误，也不能全部称为违反 Apple 的强制规定。

## 2. 截图与源码支持的问题

| 项 | 问题 | 证据与影响 | 修复方向与依据 |
| --- | --- | --- | --- |
| 1 | 核心内容优先级倒置 | 截图 1–5：设置与动作占据面板上半部，文件列表被推到下面。 | 先压缩固定操作区域，让文件成为主体。[Layout](https://developer.apple.com/design/human-interface-guidelines/layout) 要求按内容重要性组织信息。 |
| 2 | 中高度打开后缺乏可浏览内容 | 截图 1：首个目录行仅部分可见；用户需要先扩大或滚动才能开始浏览。 | 保留 medium/large，减少内部固定内容。属于根据任务密度作出的项目判断，[Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) 支持系统 detents 与抓手。 |
| 3 | 文件浏览器被组织成长设置表单 | 截图 2–5：搜索、范围、根名、文件视图、插入动作依次占行。 | 改为目录上下文、视图选择、搜索和列表；次要动作依附其对象。[Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios) 建议让人专注主要内容，限制屏幕上的控件数量。 |
| 4 | 搜索与搜索对象的视觉联系弱 | 截图 2–5：搜索和文件列表之间隔着整个控件组。 | 搜索紧邻列表，范围保持明确。[Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields) 支持直接位于被搜索列表上方的 inline 搜索。 |
| 5 | 固定区域出现无信息的大间隔 | 截图 2–5：导航到搜索、搜索到范围存在明显留白；这些留白没有表达新的内容组。 | 统一边距，减少内容最小高度与容器间距的叠加。[Layout](https://developer.apple.com/design/human-interface-guidelines/layout) 支持有目的的对齐、间距和渐进披露；不把任何固定数值假称为 Apple 要求。 |
| 6 | 范围值与根名分离 | 截图 2–5：`Synapse` 位于范围行之后，像单独正文；阅读范围必须跨两个区域理解。 | 根名与 scope 值放在同一上下文入口。[Searching](https://developer.apple.com/design/human-interface-guidelines/searching) 要求清楚表达当前搜索范围。 |
| 7 | 控件组缺少真正的列表结构 | `WorkspaceFilesBrowser.controls` 的 `Section` 放在 `VStack` 内，整体成为一个 `UIHostingConfiguration` cell，不能获得多个原生行的组织与边距。 | 普通字号用紧凑控制区，辅助功能字号拆成独立滚动行。[Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)、[UIHostingConfiguration](https://developer.apple.com/documentation/swiftui/uihostingconfiguration)。 |
| 8 | 一行根名被赋予操作行高度 | `WorkspaceFilesSelectableValue.sizeThatFits` 最少返回 44pt 高，根名因而独占一个高行。这里的问题是展示与操作区的组织，不是 44pt 触控目标不合理。 | 根名作为可换行 Menu label，scope 作为其 caption；引用用独立按钮。[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)、[Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)。 |
| 9 | 搜索采用普通文本输入的外形 | `WorkspaceFilesNativeSearchField` 创建 `UITextField` 并设 `.roundedRect`；截图显示普通表单输入框。 | 改用系统 `UISearchTextField`，不自行复刻搜索框。[Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields)、[UISearchTextField](https://developer.apple.com/documentation/uikit/uisearchtextfield)。 |
| 10 | 搜索图标被拆在框外 | 截图 1–5 和 `WorkspaceFilesSearch.inlineSearch`：放大镜是外部 SwiftUI Image。 | 使用搜索控件的原生 leading 图标，保持图标、文本与清除操作属于同一输入控件。[Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields)。 |
| 11 | 搜索提交按钮的高度被重复扩张 | `inlineSearch` 给按钮 label 最少 44pt，再施加 `.bordered` 的系统容器；截图中提交按钮显著大于输入框。源码可以确认叠加方式，不能从截图宣称精确行高。 | 提交保留为 plain 系统按钮，直接保证按钮点击区，不给 bezel 的内部 label 重复加高。[Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)、[Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)。 |
| 12 | 提交动作获得过重的视觉强调 | 截图中「搜索」形成大的独立圆形块，抢占输入宽度并与其他动作竞争。 | 保留屏幕上的显式提交，用普通文字按钮；同时保留键盘 Search。[Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) 支持明确主次动作；具体视觉强调是项目判断。 |
| 13 | 清除搜索会挤压输入宽度 | `inlineSearch` 在非空 query 时加入外部清除 Button，输入宽度随该按钮出现变化。 | 清除放进搜索控件的 native `rightView`，点击区 44pt，避免另起横向控件。[Text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields)、[UISearchTextField](https://developer.apple.com/documentation/uikit/uisearchtextfield)。 |
| 14 | 搜索与列表使用不同的边距来源 | 搜索独立 `.padding()`，表格 cell 使用各自的原生 margins；截图中输入边界、图标和目录名没有形成统一的控制区网格。 | 搜索、上下文和文件列表采用协调的系统边距，避免重复外边距。[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)。 |
| 15 | 中高度时搜索与列表表面割裂 | 截图 1：搜索区域与表格区域明度不同；`inlineSearch` 另设 `.background(.background)`。 | 内容采用一致的系统背景，系统导航和滚动边缘负责控件与内容的分离。[Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Color](https://developer.apple.com/design/human-interface-guidelines/color)。 |
| 16 | 插入目录看起来像普通正文 | 截图和 `controls`：动作是纯文字 `.plain` Button，与相邻 label 同强度。 | 使用 `text.insert` 系统图标的独立按钮，并提供明确的无障碍名称。[Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)、[SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols)。 |
| 17 | 根引用与目录上下文分离 | 根引用动作独占一整行，和表示其对象的根名相隔视图选择。 | 引用按钮与根 Menu 同行，保留直接操作；大字号时可自然改为独立滚动行。[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)、[Menus](https://developer.apple.com/design/human-interface-guidelines/menus)。 |
| 18 | 主要视图切换呈现为设置字段 | 截图 5：要打开「文件视图」菜单才能看到另一个视图。 | 普通字号采用系统 segmented Picker，AX 采用可换行 Menu/Picker 行。此处是项目对两个同层内容视图的选择，不是声称菜单不符合 HIG。[Pickers](https://developer.apple.com/design/human-interface-guidelines/pickers)、[Typography](https://developer.apple.com/design/human-interface-guidelines/typography)。 |
| 19 | 目录行重复管理基础高度 | `entryRow` 的 SwiftUI 内容设最少 44pt，外围 `UIHostingConfiguration` 又提供系统 margins；截图中目录行稀疏。 | 文件和目录共用原生行配置，让系统负责基础高度，独立操作维持足够点击区。[UIListContentConfiguration](https://developer.apple.com/documentation/uikit/uilistcontentconfiguration-swift.struct)、[UIHostingConfiguration.margins](https://developer.apple.com/documentation/swiftui/uihostingconfiguration/margins(_:_:))。 |
| 20 | 展开标记与文件类型图标缺少强弱 | `entryRow` 的 disclosure 与 folder 都随同一 body 环境呈现；截图中辅助展开标记与主要内容竞争。 | 展开标记采用次级符号表达，类型图标由统一原生配置安排。[SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols) 支持按文字权重/符号尺度建立一致性；这是项目层级判断。 |
| 21 | 同层文件和目录缺少统一的图标/文字布局 | 目录使用 SwiftUI `HStack`，普通文件使用 `UIListContentConfiguration`；目录多一个 leading chevron，普通文件没有对应布局槽。 | 同层内容共用原生文件行配置与缩进计算，目录仍保留展开和独立菜单。[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)、[Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)。 |
| 22 | 固定缩进会耗尽窄栏空间 | 目录与文件都按每层 16pt 缩进，最多 12 层；split view 最小栏宽 240pt。深层名称的有效宽度显著减少。 | 按实际宽度减少视觉缩进；完整路径仍保留于无障碍、上下文及详情。[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)、[Split views](https://developer.apple.com/design/human-interface-guidelines/split-views)。 |
| 23 | 深度截断后层级不再可辨 | `min(depth, 12)` 令更深层使用相同视觉缩进。 | 把可读性优先于无界缩进，配合完整路径表达真实归属；不改变目录数据和实际深度。[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)、[Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)。 |
| 24 | 宽窗口缺少持续选中反馈 | `WorkspaceFilesNativeTable.performPrimaryActionForRowAt` 立即 deselect，`flow.selected` 未向表格提供持续选中 ID。此项由源码支持，截图未展示 iPad。 | regular 布局同步 `selectedID`，显示左栏项与右侧详情的对应关系。[Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables) 建议层级导航列表持续高亮选择路径。 |
| 25 | 次级路径和状态被提升为主文字 | 搜索父路径、已修改父路径/Git 状态显式使用 `.primary`，原生搜索 secondaryText 也被设为 label 色。截图未展示这些次级状态。 | 使用 `.secondary` / `secondaryLabel`，仍保留完整内容与可读性。[Color](https://developer.apple.com/design/human-interface-guidelines/color) 定义次级内容语义。 |
| 26 | 选中态交换了语义颜色用途 | `WorkspaceFilesNativeEntryCell.applyConfiguration` 用 `systemBackground` 作为文字、`label` 作为背景。 | 使用系统 `defaultBackgroundConfiguration` 与配置状态，移除语义用途互换。[Color](https://developer.apple.com/design/human-interface-guidelines/color) 明确要求按语义用途使用动态系统颜色。 |
| 27 | 原生内容配置的层级与状态被覆盖 | `applyConfiguration` 给主文字、副文字和图标相同 foreground，并清除 color transformers。 | 保留系统更新后的配置，副文字只使用恰当的语义色，选择/focus 背景交系统。[UIListContentConfiguration](https://developer.apple.com/documentation/uikit/uilistcontentconfiguration-swift.struct)、[Color](https://developer.apple.com/design/human-interface-guidelines/color)。 |
| 28 | 已修改概要的文字和统计争夺空间 | `changeRow` 的名称与计数横排，路径和状态同为 primary；AX 时没有对计数单独组织。截图未展示已修改列表，源码支持这一结构判断。 | 路径/状态次级表达，计数对齐；AX 改为纵排，保持名称优先。[Typography](https://developer.apple.com/design/human-interface-guidelines/typography)、[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)。 |

## 3. 未复现风险与验收维度

| 项 | 类型 | 检查目标 | Apple 依据 |
| --- | --- | --- | --- |
| 29 | 适配风险 | 旧布局只在 `.isAccessibilitySize` 时改成纵排，尚不能证明普通大字号、长名称及窄窗口都可用。覆盖 XXXL、AX5、紧凑横屏、窄 iPad；检查控件与列表都有可用空间。 | [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)、[Typography](https://developer.apple.com/design/human-interface-guidelines/typography) |
| 30 | VoiceOver 风险 | 旧 picker 行有可访问的 title Text，Menu 又重复相同 label。检查是否重复朗读；根名/scope、当前视图、展开状态与独立动作必须关系明确。不能从源码推断具体朗读结果。 | [VoiceOver](https://developer.apple.com/design/human-interface-guidelines/voiceover) |
| 31 | 键盘风险 | 旧界面只有 Cmd-R 的显式快捷键。检查键盘可独立完成搜索、清除、切视图、目录展开、菜单与选择；Cmd-F 可作为便利入口，不能把缺少某一个特定快捷键直接判为 HIG 违规。 | [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)、[Designing for iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados) |
| 32 | 外观验收 | 浅色、深色、Increase Contrast 下检查文字、次级路径、状态、选择和禁用态；不用全黑/全白的手工反色代替系统选择配置。 | [Color](https://developer.apple.com/design/human-interface-guidelines/color)、[Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| 33 | 系统效果验收 | 检查 Reduce Transparency、减弱动态效果与系统菜单/导航外观，确认内容没有依赖透明度才能辨认。不据系统阴影或圆角判断应用违规。 | [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Motion](https://developer.apple.com/design/human-interface-guidelines/motion) |
| 34 | 窗口验收 | iPad regular 保留列表与详情及持续选择，缩窄后仍可正常进退；旋转/调整窗口不得丢失展开、选择、阅读位置或草稿。 | [Split views](https://developer.apple.com/design/human-interface-guidelines/split-views)、[Layout](https://developer.apple.com/design/human-interface-guidelines/layout) |
| 35 | 输入验收 | 中文 IME 未确认文本不能误提交；屏幕提交和键盘 Search 同一语义；清除行为复用现有 Flow；提交后网络迟到结果不得改变新的上下文。清除按钮在各字号保持可操作区域。 | [Text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields)、[Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields)；迟到结果归属仍以项目 V1 协议为准 |

## 4. 重做后的结构

以下是依据 Apple 原则、系统组件和本项目业务形成的方案。Apple 没有规定这一组远程工作区功能必须使用某个固定排列，不应宣称「苹果官方应用必然这样做」。

### 普通字号与 iPhone

```text
现有系统导航：关闭        工作区文件        切高度 / 刷新

根目录名 ▾                                      插入图标
当前目录或仓库

                 所有文件 | 已修改

所有文件：系统搜索框                         搜索
         原生列表：目录 / 文件 / 续页 / 必要状态

已修改：更改范围 / 必要统计
        原生列表：文件名 / 次级路径与状态 / 计数
```

- 保留现有 `.sheet`、`NavigationSplitView`、medium/large、抓手、展开/收起、关闭和刷新方式。新内容不改变底层终端 attach、租约或尺寸协议。[Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)、[NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview)。
- 根上下文使用系统 Menu。根名为主要 label，scope 为 caption。普通字号的根名保持单行，过长时使用系统中间省略；辅助功能字号保留完整换行，明确左对齐。文字列占满图标与菜单指示符之间的可用宽度，避免按钮默认多行居中和不必要的操作区增高；不缩小动态字体。VoiceOver 继续获取完整根名和当前范围。scope Menu 使用 Picker 保留系统当前选项反馈。单行/中间省略是本项目对紧凑目录标题的选择，Apple 并没有规定该面板必须这样排列。[Menus](https://developer.apple.com/design/human-interface-guidelines/menus)、[Pickers](https://developer.apple.com/design/human-interface-guidelines/pickers)、[Typography](https://developer.apple.com/design/human-interface-guidelines/typography)。
- 根目录引用是相邻的独立 `text.insert` 按钮，44pt 点击区；不再占一个正文行。根名从可选择 `UITextView` 改成 Menu 正文，是本次获授权的 UI 重做，目录身份、范围切换和引用能力均保留，不要求保留原控件的文本选择方式。[Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)、[Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)。
- 两个文件视图在普通字号用系统 segmented Picker，让当前内容模式和另一个模式都可见。不是增加新导航层级。[Pickers](https://developer.apple.com/design/human-interface-guidelines/pickers)。
- 搜索使用 `UISearchTextField` 原生搜索图标；native `rightView` 提供 44pt Clear，旁边保留 plain 系统提交 Button。搜索只在显式提交后读取，编辑仍取消过期意图。HIG 建议在可行时即时搜索，但本项目保持用户按需远程读取协议，不为外观重做增加每个字符的网络请求。[Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields)、[UISearchTextField](https://developer.apple.com/documentation/uikit/uisearchtextfield)。
- 搜索保持在表格视口上方，列表滚动不把正在使用的搜索输入带走；只在「所有文件」显示。搜索位置与当前内容的关系明确，不再与范围设置隔开。[Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields)。

### 文件、目录与宽窗口

- 文件与目录统一使用 `UIListContentConfiguration`，继续由原生 diffable table 复用行。目录提供主展开动作及独立的 44pt ellipsis；独立操作不能因行合并而消失，长按菜单与引用权限沿用现有校验。[Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)、[UIListContentConfiguration](https://developer.apple.com/documentation/uikit/uilistcontentconfiguration-swift.struct)。
- 文件名为主要内容；搜索父路径、Git 状态等使用 `secondaryLabel`。选择和 focus 的背景使用 `defaultBackgroundConfiguration`，不交换背景色与 label 的语义用途。[Color](https://developer.apple.com/design/human-interface-guidelines/color)、[defaultBackgroundConfiguration](https://developer.apple.com/documentation/uikit/uitableviewcell/defaultbackgroundconfiguration())。
- 深层视觉缩进按实际栏宽减小，优先保留文件名的阅读空间。数据深度、目录展开、完整路径的无障碍名称和详情保持原有语义，不把视觉缩进当作真实路径。[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)。
- regular 分栏把 `selectedID` 同步到列表，保留右侧详情对应的选中反馈；compact 延续面板内的导航方式。窗口变化不重建业务 Flow 或制造第二份选择状态。[Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)、[Split views](https://developer.apple.com/design/human-interface-guidelines/split-views)。

### 辅助功能字号与已修改视图

- AX 字号把范围和文件视图组织成独立的滚动行，使用可换行 Menu/Picker label；垂直紧凑的横屏同样让控制项随表格滚动，避免固定控制区撑满面板而让文件列表没有视口。搜索仍位于表格视口上方。[Typography](https://developer.apple.com/design/human-interface-guidelines/typography)、[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)。
- 已修改概要以文件名为首，父路径/Git 状态为次级文字；计数保留数字对齐，AX 时纵排，避免与长文件名争夺横向空间。必要状态与等待/续页仍明确显示，不能为了密度隐藏限制事实。[Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)、[Typography](https://developer.apple.com/design/human-interface-guidelines/typography)。
- 保留所有字号的完整文件名、独立目录操作、展开状态、分页与上下文身份；原有 bounded height 缓存、定位意图、取消和版本边界不因视觉统一而撤销。业务与已知稳定性约束继续见 V1 spec。

## 5. API 与兼容性

| API | 已核对的最低 iOS 版本 | 本次用途 |
| --- | --- | --- |
| [UISearchTextField](https://developer.apple.com/documentation/uikit/uisearchtextfield) | 13 | 系统搜索输入，取代普通 roundedRect UITextField |
| [UIListContentConfiguration](https://developer.apple.com/documentation/uikit/uilistcontentconfiguration-swift.struct) | 14 | 文件/目录的原生内容布局和语义文字 |
| [UIHostingConfiguration](https://developer.apple.com/documentation/swiftui/uihostingconfiguration) | 16 | 保留必须承载 SwiftUI 的动态控制行 |
| [searchable(text:isPresented:placement:prompt:)](https://developer.apple.com/documentation/swiftui/view/searchable(text:ispresented:placement:prompt:)) | 17 | 已核对的可选系统搜索集成；本方案保留 UIKit 搜索以满足明确提交与清除点击区 |

项目最低 iOS 18 覆盖上述 API。iOS 18 与新系统均使用系统组件，较新系统的 Menu、sheet 和导航视觉由系统提供，不在旧系统手工仿造 Liquid Glass。[Materials](https://developer.apple.com/design/human-interface-guidelines/materials)。

## 6. 验证状态

已完成：五张截图审查、重做前源码审查、最低部署版本检查、Apple HIG 正文和上述 API 的静态核实。

构建及静态回归结果：

- 最终源码的 `xcodebuild build-for-testing` 成功，覆盖 App、单元测试目标及 UI 测试目标的编译；目标为 generic iOS Simulator，日志 `/tmp/synapse-mobile-files-ui-final-build.log`。没有执行单元或 UI 测试。
- 最终生产源码的 generic iOS 真机目标 Release 构建成功，关闭代码签名，日志 `/tmp/synapse-mobile-files-ui-release.log`。这证明 arm64 优化编译和链接成功，不代表安装、归档上传或实机运行通过。
- Swift 语法解析与 `git diff --check` 通过。既有 UI 回归更新为新的控件定位，补充初始普通竖屏可见文件行、文件视图切换，保留清除、范围重置、差异、定位、分页和草稿引用断言；不再因搜索按钮查询失败而跳过清除及范围测试。
- 独立复核补齐：hosted 差异行的 iPad 选中反馈、中文 IME 未确认时屏幕提交守卫、UIKit 替换 `contentView` 后重新挂载目录符号与真实辅助功能节点、复用及约束清理。目录主动作与独立菜单分别保留，菜单开启/执行继续校验当前上下文。

原始重做阶段未执行运行验收。后续用户已明确授权运行模拟器和生成截图网页，结果见第 7 节；尚未完成的验收仍按第 3 节及现有 [工作区文件验收记录](../plans/2026-10-03-mobile-workspace-files-and-changes-acceptance.md) 执行。

## 7. 截图复核与目录标题修正

用户查看截图网页后指出顶部标题换行缺陷。长根目录名没有行数限制，多行文字继承 Menu 的居中对齐，造成第二行居中并撑高操作区。

普通字号目录标题使用系统单行中间省略，保留名称首尾；辅助功能字号完整换行。文字列占满可用宽度，目录标题及范围 caption 均明确左对齐，不缩小动态字体。Menu 的无障碍值继续提供完整根名。修改只涉及展示修饰符，不改变范围、引用、搜索或面板呈现。

依据：[Typography](https://developer.apple.com/design/human-interface-guidelines/typography)、[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)、[multilineTextAlignment(_:)](https://developer.apple.com/documentation/swiftui/view/multilinetextalignment(_:))、[truncationMode(_:)](https://developer.apple.com/documentation/swiftui/view/truncationmode(_:))。普通字号的单行中间省略是本项目对目录上下文的布局选择，不是 Apple 对此功能的固定要求。

复核设备为 iPhone 17 Pro / iOS 26.5 Simulator，使用本机独立验收仓库的真实文件和 Git 数据；终端背景来自展示数据。截图不代表用户自己的会话或文件。截图网页：[工作区文件模拟器截图](https://synapse-files-ui-review-oct04.eager-brush-6546.chatgpt.site/)。

- 最终修正源码的 Simulator `build-for-testing` 成功，日志 `/tmp/synapse-files-header-fix-build.log`；未运行自动 UI 测试。
- 实际检查普通 `large` 字号的 medium/large 面板：长目录名保持单行中间省略，范围 caption 左对齐，插入按钮独立可见。
- 实际检查最大 `accessibility-extra-extra-extra-large` 字号：完整目录名和范围 caption 均左对齐换行，无横向裁切；原生列表的无障碍滚动动作可滚至文件行。截图后已恢复 `large`。这不是完整 VoiceOver 朗读验收。
- 本次尚未运行 iPad 或可缩放窗口验收；标题修正尚未上传到新的 TestFlight 构建。
