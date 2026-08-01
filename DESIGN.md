# RYTHMIC — UI 设计规范（DESIGN.md）

> 状态：**全量重做**。本文档废弃现有全部 UI（三面板布局、`Trebuchet MS` 字体、散落各文件的硬编码颜色），作为今后所有 UI 改动的唯一执行标准。
> 依据：`GAME_PLAN.md` 机制分析 + 线上 UI/美学研究（来源见 §10）。
> 范围：仅 Ball Hop 玩法。视觉基调：**synthwave / outrun**（舞台已有此风格，本文档把它推广到整个游戏）。
>
> **实施状态（2026-08）：§2–§7 已全部落地。** Theme.js/Layout.js 基础设施、本地 OFL 字体、全屏舞台 + TopHUD/BottomHUD（旧三面板 `EnemyPanel`/`HeroPanel` 已删除）、combo 里程碑 / hit-stop / 场景过渡、Boot/Menu/Calibration/Upgrade/GameOver 重做均已完成；Ball Hop 追加 20 连击触发的 CRUSH 加速与视觉反馈、从 Level 5 开始的两短语滞后跑道漂移，以及从 Level 3/4 解锁的 Boost/Trap 特殊 tile。`npm test` 43 + `test:scene` 49 + `test:browser` 全绿。待做：§9 第 8 步的色盲模拟抽查。
>
> **v2.1（本轮）：§5 组件收敛为 `src/ui/widgets.js` 并铺满全部外场景。** Boot 渐变霓虹 logo（canvas 生成，左 cyan 右 magenta）+ hero 主按钮；Menu 等宽 420 规范按钮列 + UNLOCKS 改为 1180×660 Modal（技能 5×2 卡网格 + 宠物 1×6 卡行，购买即时刷新）；Upgrade 属性卡（类型色圆角卡 + 圆形 + 按钮 + 剩余点数 amber 圆点 + 加点数字 pop）+ 技能卡（类型色左边条 / hover 上浮 / 选中锁定 hero 描边）+ 宠物与丢弃弹窗走 Modal；Theme 新增 `violet`/`orange` token。验证：42 + 45 + browser smoke + 像素级截图抽查全绿。

---

## 0. 设计决策（记录在案）

| 决策 | 选择 | 理由 | 备选 |
|---|---|---|---|
| 屏幕布局 | **全屏舞台 + 上下悬浮 HUD** | Ball Hop 的 3D 透视道路是游戏最强视觉资产，全屏最大化它；研究结论：信息锚定边缘、舞台神圣（Guitar Hero / Beat Saber） | 舞台 65% + 细侧栏（结构保守派） |
| 视觉资产 | **纯矢量 + 程序化纹理** | 零图片资产与现状一致；synthwave 母题（网格/太阳/扫描线/辉光）天然程序化；Thumper / Geometry Dash 已证明此路线可达顶级质感 | 少量预渲染素材 |
| 字体 | **Orbitron + Rajdhani + Monoton**（OFL 免费可商用） | 替换 `Trebuchet MS`；几何宽体 = synthwave HUD 标准脸 | 保留系统字体 |
| 敌人/英雄展示 | 敌人收为左上 HUD 头像框，英雄收为左下 HUD | 全屏化的必然结果；头像保持矢量几何风，保留攻击/受击动画 | — |

---

## 1. 设计原则（所有改动的判据）

1. **舞台神圣**：道路是唯一移动焦点，任何 UI 不得覆盖道路中央；HUD 锚定屏幕边缘。
2. **三层反馈**：`anticipation`（beat 前预告）→ `action`（击中瞬间）→ `reaction`（结果反馈），三层缺一不可。
3. **双编码**：任何关键信息不得只靠颜色传达，必须叠加形状 / 位置 / 动效（色盲安全，§8）。
4. **深底 + 单一高饱和前景**：背景永远压暗，辉光是点缀不是信号。
5. **活物逐拍呼吸，信息面板稳定**：敌人/英雄/宠物/拍子指示器随 beat-bop；HP 条、文字、面板不抖动。
6. **无纯白大字**：正文用 off-white，纯白只用于瞬时命中闪光（眩光控制）。

---

## 2. 布局（LevelScene）

画布固定 **1440×810**（`Phaser.Scale.FIT + CENTER_BOTH`）。

```
┌──────────────────────────────────────────────────────────┐
│ TOP HUD (56px)                                            │
│ ┌──────────────┐   PHRASE 3/8   ┌───────────────────┐     │
│ │ 敌人头像框     │   ●○○●○○○○     │  COMBO ×2.75      │     │
│ │ HP ▓▓▓▓▓░░    │   DEFEND ▸     │  ACC 94.2%        │     │
│ │ [技能图标] 128 │                │  (关卡名)          │     │
│ └──────────────┘                └───────────────────┘     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                    BALL HOP 舞台（全屏主体）               │
│        地平线 y=25% · 球平面 y=80% · 道路宽 74%           │
│                                                          │
│                   [判定文本/伤害数字/横幅 爆在道路中央]     │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ BOTTOM HUD (200px)                                       │
│                     ◉ 拍子脉冲     ┌────────────────────┐    │
│                    │                 │ 英雄头像 HP ▓▓▓▓░░ │    │
│                    │                 │        MP ▓▓▓░░   │    │
│                    │                 │ [1][2][3][4][5]    │    │
│                    │                 │ [6][7][8][9][10]   │    │
│                    │                 └────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### 尺寸常量（`src/core/Layout.js` 统一导出，禁止散落硬编码）

| 常量 | 值 | 说明 |
|---|---|---|
| `CANVAS_W / CANVAS_H` | 1440 / 810 | 画布固定尺寸 |
| `TOP_HUD_H` | 92 | 顶部信息条（容纳 80px 敌人头像） |
| `BOTTOM_HUD_H` | 200 | 底部信息条（88px 英雄头像 + HP/MP + 两行技能格） |
| `STAGE` | `{x:0, y:92, w:1440, h:518}` | 舞台 bounds，BallHop 直接使用 |
| `HORIZON_Y_RATIO` | 0.25 | 地平线在舞台内的高度比（现 0.32 → 上移，道路更开阔） |
| `BALL_Y_RATIO` | 0.80 | 球平面高度比（保持） |
| `ROAD_WIDTH_FRACTION` | 0.74 | 道路占舞台宽（保持） |
| `HUD_PAD` | 12 | HUD 内边距 |
| `CORNER_RADIUS` | 10 | 所有面板/卡片圆角 |

### 顶部 HUD（92px）
- **左（宽 ~400）**：敌人区 —— 头像框 **80×80**（2× 放大；动画/静态图/程序化）+ 名字（Rajdhani 16px）+ `LV n · BPM`（13px dim）+ HP 条（宽 220×10，带 ghost 延迟条）+ 敌人技能图标（最多 2 个）+ **意图预告**：敌人下一个技能提前 1 短语亮出（StS Intents 教训，§5-Enemy HUD）。
- **中**：`PHRASE n/8`（Rajdhani 14px dim）+ 短语状态（`DEFEND ▸` / `ATTACK ▸`，Orbitron 16px，红/绿）。
- **右（右对齐）**：`COMBO ×2.75`（Orbitron 28px）+ `ACC 94.2%`（Rajdhani 14px）+ 关卡名（13px dim）。

### 底部 HUD（200px）
- **左（宽 ~1100）**：无内容（敌人信息只在顶部 HUD，避免重复）。
- **中**：拍子脉冲指示器 —— 圆形 24px，逐拍 scaleY 0.85→1.0 + 辉光增强（帮助听感弱玩家）。
- **右（宽 ~520，右对齐）**：英雄区（技能栏上方）—— 头像 **88×88**（2× 放大）+ HP 条（宽 220×16，hero 色）+ MP 条（宽 220×12，cyan），大号便于读取；下方技能栏 10 格，44×44，间距 6，两行 5 列（沉底）。点击施放；数字键绑定显示在格左上角。
- **坐标约定**：BottomHUD 的对象全部使用世界坐标（`BAR_Y = CANVAS_H - BOTTOM_HUD_H` 偏移）——曾因缺失该偏移导致整个底部条渲染在屏幕顶部并盖住 TopHUD，务必保持。

### 全屏舞台的派生调整（BallHop.js）
- `bounds` 改用 `STAGE`；`horizonY = y + h*0.25`；`ballY = y + h*0.80`。
- 模式门（DEFEND/ATTACK 全宽横条）、tile、引导轨、judgment 文本全部随舞台放大，不加额外缩放。

---

## 3. 调色板（`src/core/Theme.js` 统一导出，禁止散落 hex）

### 3.1 背景与面板

| Token | Hex | 用途 |
|---|---|---|
| `bg` | `#07070d` | 全局背景（保持） |
| `panel` | `#0a0a14` | HUD 条 / 面板底 |
| `card` | `#12121f` | 卡片 / 列表项 |
| `stroke` | `#24243c` | 面板描边（1px） |
| `strokeHi` | `#33334f` | 选中/悬浮描边 |
| `divider` | `#1a1a2e` | 分隔线 |

### 3.2 语义色（敌我 + 强调）

| Token | Hex | 用途 | 无障碍备注 |
|---|---|---|---|
| `hero` | `#2bff88` | 英雄短语 / 格挡成功 / HP | 与 `enemy` 成对出现时必须叠加形状/文字 |
| `enemy` | `#ff3b6b` | 敌人短语 / MISS / 受击 | 同上 |
| `cyan` | `#00d4ff` | 中性强调 / MP / PERFECT / 选中 / 链接 | outrun 三色之一 |
| `magenta` | `#ff2fd6` | 危险强调 / 敌人技能图标 / 状态 debuff | outrun 签名色，慎用大面积 |
| `amber` | `#ffd166` | 警告 / 金色奖励 / 暴击数字 / combo 里程碑 | 给红绿色盲第三条通道 |
| `violet` | `#a78bfa` | DEF / 技能区强调（技能卡、loadout） | 与 cyan 区分的第二强调色 |
| `orange` | `#ff9f43` | ATK / 伤害数字 / 风险类强调 | 与 amber 区分的暖色通道 |

### 3.3 判定四色（保持现状语义，写入 Theme）

| 判定 | Hex | 字形规则（§5） |
|---|---|---|
| PERFECT | `#5ef2ff` | Orbitron 38px + 光晕 |
| GREAT | `#8bff5e` | Orbitron 34px |
| GOOD | `#ffe45e` | Orbitron 30px + 轻微下移 |
| MISS | `#ff4d6d` | ✕ 符号 26px，不显示文字 |

### 3.4 文字四级

| 级 | Hex | 用途 |
|---|---|---|
| `textPrimary` | `#e8e6f0` | 正文/按钮文字（off-white，禁纯白） |
| `textSecondary` | `#8f8fae` | 标签/说明 |
| `textDim` | `#5a5a80` | 弱信息/占位 |
| `textFaint` | `#33334f` | 装饰性文字 |

### 3.5 舞台主题（保持，迁入 Theme）

- Hero 短语：`key #2bff88 / glow #9dffc6 / rail #2bff88 / sky #04140c / sun #7dffb4`
- Enemy 短语：`key #ff3b6b / glow #ffa8c0 / rail #ff3b6b / sky #180410 / sun #ff9ab4`
- 模式门：ATTACK `#14ff7a` / DEFEND `#ff1f57`（门本身含 chevron 形状 + 文字，双编码）

---

## 4. 字体系统

| 字体 | 许可证 | 用途 |
|---|---|---|
| **Orbitron**（400–900） | OFL | 标题、大数字（combo/判定/banner） |
| **Rajdhani**（300–700） | OFL | 正文、标签、按钮、HP 条内文字 |
| **Monoton** | OFL | 仅 logo / 单字点缀（禁止小字号正文） |

- 加载：woff2 文件放入 `public/fonts/`（**本地化，不依赖运行时网络**），`BootScene.preload` 用 `load.font` 或 CSS `@font-face` 预载；加载完成前 fallback `Trebuchet MS`。
- 字号阶梯（唯一允许的字号；2026-07 上调一轮——FIT 缩放下小字号不可读，最小档从 10px 提到 11-13px）：

| Token | 字体/字重 | 字号 |
|---|---|---|
| `display` | Orbitron 900 | 58（场景标题）/ 76（logo） |
| `hudNumber` | Orbitron 700 | 30（combo） |
| `judgment` | Orbitron 700 | 38 / 34 / 30（§3.3） |
| `banner` | Orbitron 700 | 28 |
| `hudLabel` | Rajdhani 600 | 16 |
| `body` | Rajdhani 400 | 19 |
| `caption` | Rajdhani 400 | 15 |
| `keyHint` | Rajdhani 600 | 13（技能格数字角标） |

- 外场景（Boot/Menu/Upgrade/GameOver）正文与说明按 body/caption 档；HUD 内（56/92px 条）受空间限制用 11–16px。
- 数字一律用 Orbitron（等宽感好，跳动不晃）；正文一律 Rajdhani。

---

## 5. 组件规范

> 每个组件：结构 / 尺寸 / 颜色 / 状态 / 动效。实现全部走 `Theme.js` + 共享组件函数（`src/ui/`），禁止场景内各自画。
> **组件实现已收敛到 `src/ui/widgets.js`**：`makeButton`（§5.2）、`makeCard`（§5.1）、`openModal`（§5.11）、`makeCircleButton`（圆形小按钮）、`roundRect` / `popText`（工具）。Boot/Menu/Upgrade/GameOver 全部走这套组件，新场景一律复用，禁止再造一套。

### 5.1 Panel / Card
- Panel：`panel` 底 90% 透明度，`stroke` 1px 描边，圆角 10；HUD 条不透明（避免玻璃感，研究：玻璃在高速画面下可读性差）。
- Card（升级/商店/列表）：`card` 底，描边 `stroke`；悬浮：描边升 `strokeHi` + 2px + 轻微上浮 2px（tween 120ms）；选中：描边 `cyan`。

### 5.2 Button
- 结构：Rajdhani 600 文字 + `card` 底 + `stroke` 描边，圆角 8，padding 12×20。
- 状态：normal / hover（描边 `cyan` + 辉光）/ pressed（scale 0.96）/ disabled（`textFaint` + 无描边）。
- 主行动按钮（如 Continue）：底 `hero` 色 15% 透明 + 描边 `hero`；危险按钮（如放弃 run）：`enemy` 色系。

### 5.3 HP / MP Bar
- 结构：底槽 `#0a0a14` 圆角 4，内填充条 + 1px 描边；HP 绿 `hero`，MP cyan。
- 特性：**ghost 延迟条**（HP 变化后，白色 30% 透明条 400ms 缓动跟进，现状 EnemyPanel 已有，推广到所有条）。
- 数值文字：`hudLabel` 居中，深色 `#0a0a14` 置于条内。
- 动效：HP 条**不** beat-bop（原则 5），只在变化时 120ms 宽度 tween + 受伤闪红。

### 5.4 Skill Slot
- 结构：44×44，`card` 底，`stroke` 描边，左上角数字角标 `keyHint`（1–0），格内技能名缩写或图标（矢量）。
- 状态：可施放（描边 `cyan` 亮 + 微辉光脉冲）/ 不可施放（30% 亮度）/ 冷却（斜纹遮罩 + 剩余秒数 `hudLabel`）/ 被动（描边 `stroke` 无脉冲）。
- 悬浮：tooltip（§5.10）。
- 动效：施放瞬间 200ms 白闪 + 缩小 0.9→1.0。

### 5.5 Judgment Text
- 位置：球正上方 40px，道路中央（不遮挡球与下一 tile）。
- 动效：scale 1.25→1.0（120ms）+ 停留 180ms + 淡出 240ms；PERFECT 附加光晕环（expand 360ms，现状 BallHop resolve 的 ring 保留）；MISS：✕ 26px 上飘 500ms（现状保留）。
- 仅显示**当前判定**一个词，不叠加历史（保持舞台干净）。

### 5.6 Banner（PHRASE / SUDDEN DEATH / 模式切换）
- 全屏中央，Orbitron 700 28px，scale-in 200ms + 停留 900ms + 淡出 300ms。
- 颜色语义：模式切换用模式色；警告（SUDDEN DEATH）用 `enemy` + amber 描边双色。
- 与模式门的关系：门是预读（anticipation），banner 是确认（reaction），两者并存不冲突。

### 5.7 FloatText（技能名/敌人技能名）
- Rajdhani 600 16px，上浮 60px / 900ms，淡出；敌人技能名用 `magenta`。

### 5.8 Damage Number
- Orbitron 700 20px 起，上浮 60px / 900ms；暴击（×2+）：28px + `amber` + 屏幕震动 90ms。
- 位置：敌人短语的格挡反馈在道路中央；英雄短语的伤害数字在**敌人头像框旁**上浮（全屏布局下敌人只有头像框，数字标在头像框右上）。
- **剑气 slash（新增）**：每次命中（敌人或英雄被攻击）在被攻击头像位置爆一道 45° 白色刀光（主刃 + cyan/amber 副光晕），快速扫过并淡出（`src/ui/SlashFX.js`，纯 Graphics 无素材）。暴击用 `amber`、普通用 `cyan`；英雄被攻击用 `enemy` 红粉。

### 5.9 Enemy HUD（左上区）
- 头像框 56×56：矢量几何敌人（沿用 EnemyPanel 的绘制思路），保留 idle 浮动 / attack 前冲 / hurt 白闪 / cast 光环脉冲 / death 塌缩动画（缩放适配 56px）。
- HP 条 + ghost；BPM 数字（Rajdhani 14px）；敌人技能图标 16×16 ×2（`magenta`）。
- **意图预告（新增）**：敌人下一短语要用的技能图标提前显示在 HP 条右侧，带 1 拍倒计时描边收缩——对齐短语节奏（§1 原则 2 的 anticipation 层）。

### 5.10 Tooltip
- 出现：悬浮 350ms 后；结构：`panel` 底 + `stroke` 描边 + 圆角 6，宽 ≤ 260，文字 `body` + `caption` 混合。
- 位置：技能格上方，随指针偏移 12px；z 高于一切（depth 900）。

### 5.11 Modal（解锁/宠物/技能丢弃/设置）
- 全屏遮罩 `#000000` 45% + 内容卡片居中（宽 ≤ 720），背景用轻微 blur（Phaser 无原生 blur 则用加深色替代，不做假玻璃）。
- 出现：scale 0.96→1.0 + 淡入 150ms；关闭：反向 120ms。

### 5.12 Beat Indicator（底部中央）
- 圆形 28px，`stroke` 描边；逐拍 scaleY 0.85→1.0 + 亮度脉冲（跟随 conductor.beatPhase）；敌我短语时颜色随模式变。
- 用途：全局拍子可见性（新手校准感），也是全屏布局下"音乐活着"的最小证明。

---

## 6. 反馈与动效规则

### 6.1 分层模型（每个事件必须走三层）
| 层 | 时机 | 手段 |
|---|---|---|
| Anticipation | beat 前 1–4 拍 | 对齐发光（现状）、敌人意图预告、模式门接近、approach tick 音 |
| Action | 判定瞬间 | 判定文本、ring/粒子（现状）、hit-flash、球 squash |
| Reaction | 短语结束 | accuracy 结算、伤害数字、combo 里程碑、敌人 HP ghost 条 |

### 6.2 beat-bop 范围（原则 5 的执行清单）
- **跳**：敌人头像、英雄头像、宠物、拍子指示器、模式门辉光。
- **不跳**：HP/MP 条、combo 数字（可轻微 1.02 放大随拍，禁止上下抖）、面板、文字。

### 6.3 combo 里程碑
- 每 25 combo：combo 数字 scale 1.4→1.0 + `cyan` 闪光 + 短促上音（现状无，新增）。
- combo 断裂：数字 0.7 灰化 150ms + 低音 thud（现状无）。

### 6.3.1 CRUSH 连击状态（Ball Hop）
- 连续命中达到 **20**：进入 CRUSH，approach window 立即缩短约 13%，道路 rail、等化器和脉冲特效切换为高亮 cyan/magenta；屏幕只保留紧凑的 `×n` 计数，不重复显示模式名称。
- 连击继续增长：速度按连击逐步提高，最多约 **1.55×**；道路两侧加入速度刻线，远端 tile 提前放大、平台变高并出现内嵌 speed grooves，命中时播放脉冲环与 milestone flash，强化“越打越快”的反馈。
- MISS 将 combo 与 CRUSH 一起清零，恢复普通速度与主题色；不改变鼠标拖动判定和单车道 tile 规则。

### 6.3.2 高等级跑道漂移（Ball Hop）
- Level 1–4 保持稳定视角；从 **Level 5** 起，跑道与 tile 平台使用缓慢的左 / 右 / 上方漂移，并加入约 3° 的轻微旋转。
- 每个方向至少维持 **2 个 phrase**；方向切换采用 0.075 的滞后插值，形成“先拖影、再跟上”的视图延迟，而不是瞬间跳动。
- 漂移只作用于视觉道路、tile、球与特效；鼠标坐标会先做逆变换，lane hitbox 与判定规则保持不变。

### 6.3.3 特殊 tile 与奖励循环（Ball Hop）
- **解锁节奏**：Level 1–2 只有 normal tile；Level 3 起加入稀疏 Boost（约 5–8% 的 scoreable tiles）；Level 4 起加入稀疏 Trap。ChartGen 为独立特殊事件保留至少 2 拍间隔；Trap 只和自己的 safe normal 同拍配对，避免无意的重复或重叠。
- **Boost tile**：橙金色透镜核心、前向 chevron 与速度刻线组成唯一的 3D 程序化模型，不绘制额外的矩形 slab。成功落地触发 7 秒 rush，approach window 加速约 1.30×；Boost 不会提前打碎或自动命中尚未到达落点的 tile。
- **Trap tile**：洋红夹爪、齿状凸起与交叉锁扣组成 3D 模型。每个 Trap 都和另一条 lane 的 safe normal tile 同拍出现；玩家留在 safe lane 命中 normal，Trap 会被静默跳过，不产生 MISS。若误入 Trap lane，球仍可用左右拖动填满 `TRAP` escape meter，逃脱或超时都不改变 combo。
- **Lens points**：Lens 只在 Boost 状态下由玩家成功落地的 tile 生成，未到落点的 tile 不会变成 Lens，也不会被自动判定。拾取时显示在底部 HUD。结算时 Lens 以 1:1 bonus Shards 加入本局奖励，技能与宠物仍使用统一的 Shards 解锁池。
- **反馈与可读性**：Boost 使用 amber/cyan，Trap 使用 magenta/cyan；两者共享道路透视、发光描边与 hit flash 规则，特殊状态由 hint text、SFX 和局部脉冲表达，不改变 Ball Hop 的 mouse-movement-only 输入规则。

### 6.4 屏幕震动 / hit-stop
- 敌人受大伤害：90ms 震动（现状有）；英雄受击：140ms（现状有）。
- **hit-stop（新增）**：暴击或 boss 受击时冻结 40ms（`time.delayedCall` 暂停 update 或 world timeScale 0 一帧），随后恢复。

### 6.5 辉光绘制规则（统一，禁散写）
- 沿用 `glowLine` / `glowPoly` 三层描边法（BallHop.js:121-145），参数收敛为工具函数 `src/ui/glow.js`：`glow(α) = stroke 4.5w @0.10α → 2.2w @0.26α → 1w @α`。
- 辉光只用于：舞台元素、判定、选中态、拍子指示器。HUD 文字不加辉光（可读性优先）。

### 6.6 场景过渡（新增）
- 所有场景切换：黑场淡入 200ms / 淡出 250ms（`cameras.fadeIn/Out`），过渡中禁用输入。

---

## 7. 各场景设计

| 场景 | 布局 | 视觉要点 |
|---|---|---|
| Boot | 居中 logo（Monoton 76px 渐变辉光）+ tagline（Rajdhani 18px dim）+ 按钮 | logo 为 canvas 生成的 cyan→magenta 渐变霓虹管（`BootScene.gradientLogo`，字体就绪失败自动回退单色）；按钮 `▶ CLICK TO BEGIN` 为 hero 主行动组件 |
| Menu | **Neon Arcade Runway**：logo、hero、单一主行动、当前 run 卡、底部工具导航 | 背景加程序化扫描线 + 地平线网格（复用 BallHop 背景函数抽出为 `ui/backdrop.js`）；主按钮进入/继续 Ball Hop；UNLOCKS 为 1180×660 Modal，技能 5×2 卡网格 + 宠物 1×6 卡行，购买即时刷新不重启场景 |
| Calibration | 中央拍子圆 + 指令文字 + 跳过按钮 | 拍子圆即 Beat Indicator 组件复用 |
| Level | §2 全屏布局 | — |
| Upgrade | 左：4 行 stat（card 行）；右：2 张技能卡 + SKIP；底部 Continue | 技能卡 420×84 保持，改字体/描边/辉光；+1 stat 与跳过用 amber 强调；stat 行带类型色圆角卡 + 圆形 + 按钮 + 剩余点数 amber 圆点 + 加点数字 pop；技能卡左侧类型色条（ACTIVE cyan / TOGGLE amber / PASSIVE hero）+ hover 上浮；选中技能卡锁定 hero 绿描边；宠物/丢弃弹窗用 Modal 组件 |
| GameOver | 中央：标题（cleared `amber` / 死亡 `enemy`）+ Consolas 统计块**改 Rajdhani** + 单按钮 | 统计块用等宽数字布局但 Rajdhani 700；死亡时背景加红色 vignette |

---

### 7.1 Menu — Neon Arcade Runway（已选视觉方向，2026-08-01）

**定位：** 这是一个“进入下一次 Ball Hop 前的舞台”，不是通用 dashboard。玩家打开菜单后一秒内必须看懂：**我可以立刻继续这一次 run。** 道路是主舞台，UI 像浮在道路上，而不是把背景盖成一组卡片。

#### 信息层级与布局（16:9 桌面端）

1. **Logo 区（屏幕 8–18%）**
   - 保留居中的 `RYTHMIC` logo，最大高度约 110–130px；比现状略小，给天空、太阳和主行动留空间。
   - 可有一行短 tagline，例如 `MOUSE-ONLY RHYTHM ROGUELIKE`；不要在 logo 下堆叠 runs、clears 等长期统计。

2. **Hero 区（18–57%）**
   - hero 头像置于太阳与城市的前方，居中偏上；它是情绪锚点，不是可点击的功能卡。
   - 保留城市、地平线和三车道路面可见。背景为静态主画面，最多加入慢速星光与道路辉光脉冲，禁止干扰文字可读性的高频动画。

3. **主行动区（48–59%）**
   - 有存档时：一个大号 `CONTINUE RUN` 主按钮，下方一个小号 `NEW RUN` 次按钮。
   - 无存档时：主按钮改为 `START BALL HOP`，隐藏 `NEW RUN`。
   - 主按钮高度为次按钮的约 1.8–2 倍，是页面唯一使用强烈 magenta glow 的持续元素。
   - `RECALIBRATE AUDIO` 不再占据主菜单按钮位，移入底部 `AUDIO` 面板。

4. **当前 Run 区（64–84%）**
   - 用**一张横向 mission card**表达当下目标，而不是一串同权按钮或许多独立小卡。
   - 第一行只放：`LEVEL 06`、下一敌人名称/头像、clear progress。等级数字最大，敌人是第二信息层，进度条第三。
   - 第二行放三个等宽小指标：最近 accuracy、best combo、Shards。它们是 run 决策的提示，不要加入 runs / clears / best level 等历史统计。
   - 历史统计留给未来的 Profile/Stats 页面，避免首页信息噪声。

5. **工具导航区（89–97%）**
   - 底部是一条连续的 framed navigation bar，三项：`PRACTICE`、`UNLOCKS`、`AUDIO`。
   - 三项之间只用细分隔线，不再为每项额外套卡。使用真实图标资源或图标库，禁止 emoji。
   - `AUDIO` 打开含音量、offset、校准入口的小 Modal；`UNLOCKS` 复用现有解锁 Modal；`PRACTICE` 是未来 Ball Hop 练习入口。

#### 视觉 Token

| 用途 | Token | 色值 / 规则 |
|---|---|---|
| 舞台底色 | `menuBg` | `#050716`，绝不使用纯黑作大面积背景 |
| 半透明面板 | `menuSurface` | `#0A0D21`，约 88% opacity |
| 信息 / 焦点 | `cyan` | `#22D9FF`，用于导航、数字、focus outline |
| 主行动 | `magenta` | `#FF3BC8`，只用于 Continue/Start 及当前高亮 |
| 辅助光 | `violet` | `#8A4DFF`，用于边框过渡与环境光 |
| 奖励 | `amber` | `#FFD166`，只用于 Shards、稀有奖励、里程碑 |
| 危险 | `enemy` | 仅用于敌人威胁、放弃 run 确认和错误，不能当普通按钮色 |

#### 组件规范

**主按钮（Continue / Start）**
- 轮廓：横向长六边形 / 斜切角，禁止普通圆角矩形；宽约 42–48% viewport，高 72–84px。
- 表面：深紫黑填充、magenta 2px 描边、外层柔光；Orbitron 700 全大写白字，右侧是箭头图标。
- hover：scale 1.05–1.08、辉光加强、道路在按钮下方短暂亮起；pointerdown：scale 0.97，随后立即切场景。

**次按钮（New Run）**
- 与主按钮同一轮廓但高度约 42–48px；透明深色填充，cyan 描边。
- 新开 run 需要确认 Modal，明确说明会放弃当前 run。

**Mission card**
- 宽约 52–58% viewport，高 112–132px，`menuSurface` + 细 cyan/magenta 边框 + 左右斜角。
- level 数字使用 Orbitron 700、48–64px cyan；敌人名 24–30px 白色；说明文字 14–16px Rajdhani。
- 进度条只保留一个：暗紫轨道 + magenta 填充 + 数字百分比。不要用多个竞争的颜色条。

**小指标与底部导航**
- 小指标宽 18–22% viewport，高 64–76px；数字大于标签，标签使用 Rajdhani 600 的 12–14px。
- footer 高 64–72px、全宽减 48px 边距；只让 hover/active 项有辉光，默认状态维持低对比蓝灰。

#### 字体、动效与可读性

- **Orbitron**：logo、按钮、等级、数值、短标签。**Rajdhani**：说明、敌人副标题、设置文字；最多使用这两种字体。
- 大写只给短行动与标签，例如 `CONTINUE RUN`、`LEVEL`、`PRACTICE`；完整说明使用正常大小写，避免全屏“喊叫”。
- 主画面进场：logo 350ms 淡入下落，hero 250ms 轻微上浮，主按钮在最后 120ms 出现。总时长不超过 500ms。
- 所有静态 HUD 文字不加持续辉光；辉光是交互反馈而不是字体装饰。
- 文字不能压在明亮太阳上。正文至少 16px，辅助标签至少 12px，并保留 §8 的对比度规则。

#### 从现有 Menu 必须移除或降级的元素

- 绿色 `NEW RUN`、青色 `RECALIBRATE AUDIO`、红色 `UNLOCKS` 三个同权大按钮：改为一主一辅加底部工具导航。
- 顶部 `runs / best level / clears / shards` 的一整行统计：移出主视觉区；Shards 保留在 mission card 小指标中。
- 底部的控制说明、音频 offset、版权文字：改为 12px dim footer text，不能与主行动争夺注意力。
- 禁止把 menu 再做成卡片墙。背景、道路、球和 hero 必须始终比 UI 表面更有舞台感。

### 7.2 Shared button state atlas（2026-08-01）

`public/assets/ui/button-state-atlas.png` is the ChatGPT image-generated visual reference for the live component system. It is a reference atlas, not a flattened dashboard: Phaser still owns the label text, hit area, hover state, pressed state, disabled state, and scene transitions.

| Component | Reference size | Runtime use | Idle | Hover | Pressed | Disabled |
|---|---:|---|---|---|---|---|
| Primary CTA | 560×82 px | Continue / Start Ball Hop | 2px magenta outline, deep violet fill, low bloom | brighter outline, top-edge highlight, stronger bloom | 0.96 scale, label drops 1px | violet-gray outline, 40% text opacity |
| Secondary CTA | 310×44 px | New Run / recalibrate | 1.5px cyan outline, translucent navy fill | cyan bloom and brighter fill | 0.96 scale | desaturated outline, no bloom |
| Utility rail | 220×42 px | Practice / Unlocks / Audio | cyan or magenta icon + outline | icon and outline brighten | 0.96 scale | muted icon and text |
| Modal action | 190×46 px | Cancel / Confirm / Close | cyan secondary or magenta primary | glow + 4% brighter fill | inward scale press | muted outline and label |

Implementation rules:

- `src/ui/widgets.js` is the single button renderer; scenes do not hand-draw button surfaces.
- Icons are vector-like Phaser line art (`practice`, `unlocks`, `audio`) so the control remains live and crisp at different canvas scales.
- Labels remain live Phaser text for localization and save-state changes; the atlas supplies silhouette, spacing, color, and state intent.
- The hero and enemy animation systems are out of scope for this pass and remain unchanged.

---

## 8. 可读性与无障碍

1. **红绿色盲**：`hero`/`enemy` 色对是经典混淆对。所有敌我区分点必须同时有：位置（左上/右上或门的方向）+ 形状（门 chevron、DEFEND/ATTACK 文字）+ 动效（主题天空色切换）。
2. **判定不靠颜色**：PERFECT/GREAT/GOOD 用字号 + 亮度 + 位置区分（§3.3）。
3. **对比度**：正文 `textPrimary` 在 `panel` 上对比度 ≥ 7:1；`caption` ≥ 4.5:1；纯白仅限瞬时闪光。
4. **字号下限**：正文 16px / 标签 12px 以下禁止承载关键信息。
5. **信息密度**：HUD 单区块最多 4 个信息元素；超出移入 tooltip 或下一屏。

---

## 9. 落地清单（迁移顺序，每步可独立验收）

1. **字体**：下载 Orbitron/Rajdhani/Monoton 的 woff2 → `public/fonts/` → BootScene 预载 + fallback。
2. **主题系统**：建 `src/core/Theme.js`（§3 全部 token + §4 字号阶梯）+ `src/ui/glow.js`；`grep` 清掉各文件硬编码 hex/字号。
3. **布局常量**：建 `src/core/Layout.js`（§2 常量）；LevelScene 改用 `STAGE` 与 `TOP_HUD_H`/`BOTTOM_HUD_H`。
4. **BallHop 全屏适配**：bounds → `STAGE`，horizon 0.25；跑 `npm test` 确认判定/生成约束测试仍绿。
5. **重写 HUD**：删除旧 EnemyPanel/HeroPanel 的三面板实现 → 新建 `src/ui/TopHUD.js` / `src/ui/BottomHUD.js`（§2 分区 + §5 组件），含敌人意图预告（新增）。
6. **反馈补齐**：combo 里程碑（§6.3）、hit-stop（§6.4）、场景过渡（§6.6）。
7. **重做外场景**：Boot/Menu/Calibration/Upgrade/GameOver 按 §7 与组件规范重绘；背景工具 `ui/backdrop.js` 抽公共。
8. **验收**：色盲模拟检查（§8 清单）、对比度抽查、`npm test` + `npm run test:browser` 全绿。

---

## 10. 参考来源

- osu! 皮肤系统（HUD 可替换资源/可读性选择）：https://osu.ppy.sh/wiki/en/Skinning
- Guitar Hero HUD 布局（分数左/Star Power 右/Rock Meter 右下）：https://en.wikipedia.org/wiki/Guitar_Hero_(video_game)
- Beat Saber（双色+形状编码、能量条置舞台下方）：https://en.wikipedia.org/wiki/Beat_Saber
- Crypt of the NecroDancer（hub/货币分离）：https://en.wikipedia.org/wiki/Crypt_of_the_NecroDancer
- Hades（三选一 boon、hub、死后归所）：https://en.wikipedia.org/wiki/Hades_(video_game)
- Slay the Spire（敌人 Intents 意图预告）：https://en.wikipedia.org/wiki/Slay_the_Spire
- Thumper（稀疏高对比、极简暴力）：https://en.wikipedia.org/wiki/Thumper_(video_game)
- Juice it or lose it（GDC）：https://www.gdcvault.com/play/1016487/Juice-It-or-Lose-It
- Synthwave / Outrun 美学定义：https://en.wikipedia.org/wiki/Synthwave
- 游戏无障碍指南（不得只靠颜色）：https://gameaccessibilityguidelines.com/ensure-no-essential-information-is-conveyed-by-a-fixed-colour-alone/
- 字体 OFL 许可（Orbitron / Rajdhani / Audiowide / Monoton / Press Start 2P）：https://github.com/google/fonts/tree/main/ofl
