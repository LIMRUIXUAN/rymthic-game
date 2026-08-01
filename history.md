# HISTORY — 项目交接文档（给新会话）

> **用途**：开新 chat 前先读这份文档，即可快速恢复全部上下文，无需重新摸索。
> 对应实现：GAME_PLAN.md（机制规划）+ DESIGN.md（UI 视觉规范）均已落地。
> 最后更新：2026-07

---

## 1. 项目是什么

Phaser 3 + Vite 的网页节奏地牢 roguelike：程序化合成音乐（Web Audio，无音频文件），
鼠标驱动节奏玩法 **Ball Hop**（jumping tiles，唯一的保留玩法），按关推进打 BOSS。

- 技术栈：Phaser 3 / Vite / ESM / Node 内置测试（无测试框架依赖）
- 无美术素材：全部图形用 Phaser 图元（rectangle/circle/text）程序化绘制，synthwave 风格
- 无音频文件：`MusicEngine` 用 oscillator 实时合成 chiptune

## 2. 如何运行 / 验证

```bash
npm run dev           # 开发服务器
npm run build         # 产物在 dist/
npm test              # 机制/平衡单测（combat.test.js）→ 42 passed
npm run test:scene    # Phaser headless 场景测试（scene.test.mjs）→ 41 passed
npm run test:browser  # puppeteer 冒烟；没装 puppeteer 时干净跳过
npm run balance       # 平衡模拟（注意：脚本用 python3，本机需用 python tools/balance_sim.py）
```

**交付标准**：`npm test` + `npm run test:scene` + `npm run build` 全绿；改动 UI 后再跑 `test:browser`。

**环境怪癖（本机）**：
- Windows + git bash；`npm install` 会超时 —— **不要引入新 npm 依赖**
- `python3` 不可用（指向 Microsoft Store 占位），用 `python`；cargo/rustc 不可用

## 3. 架构速览

```
src/
├── core/
│   ├── Conductor.js      the beat clock — 一切以 AudioContext.currentTime 为准
│   ├── MusicEngine.js    程序化 chiptune 单例；含 combo 分层、所有 sfx
│   ├── ChartGen.js       确定性谱面生成（LANES=3 单点来源）
│   ├── Judge.js          判定窗口 → PERFECT/GREAT/GOOD/MISS
│   ├── CombatResolver.js 判定 → 双方伤害
│   ├── RunState.js       hp/mana/技能/宠物/连击 的 run 状态
│   ├── SkillEngine.js    技能钩子分发
│   ├── SaveManager.js    localStorage 元进度
│   ├── Theme.js          调色板/字号 token（DESIGN.md §3-§4 的实现）
│   └── Layout.js         布局常量：STAGE 1440×518、TOP_HUD_H=92、BOTTOM_HUD_H=200、HORIZON_Y_RATIO=0.25
├── ui/                   TopHUD / BottomHUD / backdrop / widgets（DESIGN.md 视觉系统；widgets = makeButton/makeCard/openModal 等 §5 组件）
├── minigames/            MiniGame.js 契约 + BallHop（主力）+ OsuCircles（暂缓）
├── scenes/               Boot → Calibration → Menu → Upgrade ⇄ Level → GameOver
└── data/                 enemies / skills(24) / pets(6)
tools/balance_sim.py      平衡模拟器（与 enemies.js 公式同步）
tests/                    combat.test.js + scene.test.mjs（Phaser headless）
```

## 4. 不可违背的约定（改代码前必读）

1. **时间只读 Conductor（AudioContext.currentTime）**，绝不用 frame delta 推拍子
2. **谱面是 MONOPHONIC**：同一时刻只有一个 note；`MIN_GAP_BEATS=0.5` 是硬物理约束
3. **敌人数值是派生的**：enemies.js 的 HP/ATK 由玩家输出公式算出，与 tools/balance_sim.py 镜像——改系数必须两边一起改并重跑 sim
4. **BallHop 只监听 pointermove**（无 pointerdown/up），scene.test.mjs 有测试断言这一点
5. **UI 一律用 Theme.js/Layout.js token**，禁止散落硬编码颜色/字体/布局（DESIGN.md 是执行标准）
6. **Combat 不感知 minigame 种类**，只监听 judgment 事件；需要 `if (minigame==='osu')` 就是抽象泄漏
7. 音乐分层/音效走 `MusicEngine` 单例；新 sfx 在 `sfx()` 里加 case

## 5. 已完成改造（2026-07）

### v1 机制（GAME_PLAN.md A/B 组全部落地）
| 项 | 实现 |
|---|---|
| A1 combo 音乐分层 | `MusicEngine.setComboLayer(0..4)`：每 8 连击编曲加一层（强度 +0.18/层），断 combo 清零 |
| A2 第 1 关教学谱 | ChartGen `teaching` 分支：只走相邻车道 + 50% 保持直行 |
| A3 approach tick | tile 进入最后 1 拍触发 `sfx('tick')`（920→720Hz 轻 blip，preview 不响） |
| B4 Dash | 甩动 >1200px/s → 260ms 2.2× 转向 + 6 段残影（DASH_VX 等常量） |
| B4 hyperfruit | 不可达 tile（beatsAway≤2.5 且超出可达距离）品红脉冲警告 |
| B5 视野旋钮 | `visibleBeatsForLevel`：7.5/6.5/5.5/4.5 四档随关卡递减，LevelScene 传入 MiniGame |
| B6 Hurry 密度 | `notesPerPhrase(level, tier)`：+15%/+30% 密度（clamp 32）；Sudden Death 先升档再生成谱面 |

### v2 UI（DESIGN.md §2-§7 全部落地）
- **全屏舞台**：Ball Hop 占满 1440×690（STAGE），地平线 y=0.25，球平面 y=0.80
- **TopHUD**（56px 顶部条）：敌人头像（全部状态动画）+ HP ghost 条 + 技能图标 + **意图预告**（敌人下个技能提前显示）+ combo/accuracy（Orbitron 大数字）
- **BottomHUD**（92px 底部条）：英雄头像 + HP/MP + 拍子脉冲指示器 + 2×5 技能栏（40px 格、tooltip、⛓ 联动标记、数字键绑定）
- **字体**：Monoton(logo) + Orbitron(标题/数字) + Rajdhani(正文)，7 个 OFL woff2 已本地化在 public/fonts/，index.html @font-face 预载
- **反馈**：25 连击里程碑（弹跳+cyan+上音）、断连灰化+低音、crit hit-stop 40ms（`_hitStopUntil`，音频时钟不受影响）、全局场景 fadeIn（main.js CREATE 事件）
- **外场景**：Boot/Menu/Calibration/Upgrade/GameOver 全部重做，共用 `ui/backdrop.js` 程序化 synthwave 背景（渐变天穹+汇聚网格+扫描线）
- 旧三面板 `src/panels/EnemyPanel.js`/`HeroPanel.js` **已删除**；scene.test.mjs 已迁移到 TopHUD/BottomHUD（含意图预告断言）

### v2.1 外场景组件规范化（本轮）
- **`src/ui/widgets.js`**：§5 组件收敛为共享函数 —— `makeButton`（圆角/描边/hover 辉光/pressed 0.96/disabled）、`makeCard`（hover strokeHi + 上浮 2px）、`openModal`（scale-in Modal）、`makeCircleButton`、`roundRect`/`popText`；新场景一律复用，禁止再造
- **Boot**：logo 改为 canvas 生成的 cyan→magenta 渐变霓虹管（`gradientLogo()`，字体未就绪自动回退单色 + 呼吸动画）；CLICK TO BEGIN 为 hero 主按钮
- **Menu**：按钮列等宽 420 走组件；UNLOCKS 改为 1180×660 Modal（技能 5×2 卡 + 宠物 1×6 卡，hover 上浮、买不起 dim、购买即时刷新不 restart）
- **Upgrade**：属性行 → 类型色圆角卡 + 圆形 + 按钮 + 剩余点数 amber 圆点 + 加点数字 pop；技能卡加类型色左边条（ACTIVE cyan/TOGGLE amber/PASSIVE hero）+ hover 上浮，选中锁定 hero 描边；宠物/技能丢弃弹窗走 Modal；全部颜色走 Theme token（新增 `violet`/`orange`）
- **布局约束（改 Menu/Upgrade 时注意）**：smoke.mjs 用硬编码坐标点击 —— Boot 按钮 (720,455)、Menu NEW RUN (720,168)、Upgrade 属性 + (382,194)、技能卡 (750,190)、Continue (720,766)，重排必须保持这些可点区域

### v2.2 C 组软惩罚缓冲（本轮）
- **机制**：每短语第一个 MISS 免伤成为全体玩家默认规则——`RunState.missShieldUsed`（`resetPhraseFlags()` 每短语重置）+ `CombatResolver.resolveEnemyNote` miss 分支免伤（`onShielded` 回调）。触发时 **combo/acc/音乐层照断，只免伤害**（软惩罚本意：惩罚仍在，只是不致命）
- **反馈**：`LevelScene.showShielded()` 金色（amber）圆环 expand + "SHIELDED" 浮字 + `MusicEngine.sfx('shield')` 上行双音
- **Shield Loop 技能未动**：它把 MISS 改成 GOOD = 完全豁免（含 combo），成为默认保底之上的"保 combo"进阶层，两者独立不冲突（Shield Loop 触发时根本走不到 miss 分支）
- **平衡镜像**（约定 3）：`balance_sim.py` `taken()` 按"每短语免 min(1, 每短语 miss) 个"近似；`combat.test.js` `simulateLevel` 补上短语间 `resetPhraseFlags()`（原来漏了，保底只生效一次）；曲线右移约一档：80% 死 20 关 / 85% 险过 6% / 90% 47% / 95% 88%，GAME_DESIGN.md §11 表格与说明已更新

### v2.3 UI 可读性 + spotlight 光效（本轮）
- **字号整体放大**（用户反馈"太小看不清"）：Theme TYPE 上调（hudNumber 28→30 / hudLabel 15→16 / body 17→19 / caption 13→15 / keyHint 11→13）；外场景硬编码字号按档位 +2~4px（10→12、11→13、13→15、17→18、20→22…），HUD 内（56/92px 条）受空间限制 +1~2px（10→11…）。布局随之适配：Upgrade 技能卡 84→96 高、UNLOCKS 技能卡 96→104 高、宠物卡 150→166 高、宠物 cost 徽章移到右上
- **模糊问题诊断**（重要结论）：FIT 缩放下文字发虚的根因是 `ScaleManager` 对主 canvas 做 CSS transform 缩放（浏览器插值采样），`Text.setResolution()` 只对放大有效、`game config resolution` 在 Phaser 4.2.1 实测不生效（canvas 仍 1440×810）——**无法低成本根治，放大字号是正解**
- ~~Spotlight 光效~~：曾用离屏 canvas 径向渐变纹理 + ADD 混合 sprite 实现鼠标跟随光斑（`ensureGlow`/`addSpotlight`），**用户反馈"动画怪异"，已整体删除**——`makeButton`/`makeCard`/`makeCircleButton` 恢复为纯 hover 描边辉光 + 上浮/缩放反馈；scene.test.mjs 的 `createRadialGradient` mock 一并移除
- **测试**：像素级验证：hover 提亮、光斑跟随指针、文字无卡片溢出

### v2.4 素材接入管线（本轮）
- **规范文档 `ASSETS.md`**（用户提供素材路线）：每个素材的文件名/画布尺寸/显示尺寸/透明背景要求/主色/意象全部写死——logo（1600×400）、英雄头像（160×160）、20 个敌人头像（160×160，含 e00 通用替代）、24 技能图标（128×128）、6 敌人技能图标（64×64）、6 宠物（128×128）、可选按钮 9-slice 与全屏背景
- **管线 `src/core/Assets.js`**：manifest 从 data 模块自动生成（enemies/skills/pets id）；`BootScene.preload` 注册全部素材，缺文件静默跳过（console.info "[assets] missing"）；`hasTexture`/`enemyTexKey` 供消费方判断
- **接入点（全部带回退）**：Boot/Menu logo、TopHUD 敌人头像（素材时跳过程序化脸/眼睛/皇冠，HURT 白闪改 tint）、BottomHUD 英雄头像（flash 改 tint）+ 技能格图标（替换缩写文字）+ 宠物点、Upgrade 技能卡/宠物弹窗、MenuScene UNLOCKS 技能卡（文字右移 40px）/宠物卡、`drawBackdrop` 可被 bg_menu 整图替换
- **测试适配**：scene.test.mjs 的 stub 场景无 TextureManager → `hasTexture` 用可选链判空（stub 返回 false = 回退）；smoke.mjs 的 BENIGN_404 加 `/assets/`（素材可选是设计行为）
- **验证**：放临时 logo → 浏览器确认 textureLoaded=true 且 Boot 场景用 Image 渲染 → 删除后回退程序化；42 + 41 + build + smoke 全绿

### v2.5 精灵动画管线（本轮）
- **需求**：用户提供多帧 sprite sheet，做真正的角色/敌人状态动画（攻击/受击/施法/死亡/idle）
- **规范**：ASSETS.md §5 —— 行序从上到下 idle/attack/hurt/cast/death；文件 `public/assets/hero/anim.png` + `public/assets/enemies/enemy_anim_<n>.png`（每关一张，可分批发，缺的回退程序化动画）。**帧网格自适应**（v2.7 后）：只要「4 列、方形帧」即可，帧尺寸由图片实际尺寸推断（参考布局 320×400 = 5×4×80px；AI 生成的 1024×1536 = 4 列×6 行×256px 也直接生效，第 6 行忽略）
- **实现**：`src/core/Anims.js`（`createSheetAnims` 注册 5 状态动画，帧率 idle 8 / attack 14 / hurt 14 / cast 12 / death 12，idle 循环其余单次；anim key `hanim_<state>` / `eanim_<n>_<state>`；`inferSheetFrameSize` 推断网格）；BootScene preload 先按普通 image 加载 `*_raw`，create 时检测尺寸再 `textures.addSpriteSheet` 切片（不能直接 load.spritesheet——加载前不知道尺寸）
- **接入**：TopHUD 敌人有动画 → `animSprite` 替代程序化脸（setState 映射状态→动画，超时回 idle，death 播完停止；attack 保留位移 tween）；BottomHUD 英雄 idle 循环 + `playAttack()`/`playHurt()`（animationcomplete 回 idle）；LevelScene hero 命中 → `bottomHud.playAttack()`；播放前一律 `anims.exists` 防御（部分网格行数不足时缺状态回退程序化反馈）
- **验证**：伪造 320×400 测试 sheet → 10 个 anim 全部注册 ✓ 敌人/英雄 sprite 播放 idle ✓ 战斗中挂 animationstart 监听确认 attack/hurt/cast 真实触发 ✓ 删除素材回退正常；42 + 41 + build + smoke 全绿

### v2.6 外场景 BGM（本轮）
- **需求**：网络免费音乐，外场景（Boot/Menu/Upgrade 此前静音）加氛围曲；战斗合成音乐 + combo 分层保持不动
- **曲目**：Kevin MacLeod（incompetech.com）3 首 CC-BY 4.0，直链 `https://incompetech.com/music/royalty-free/mp3-royaltyfree/<Title>.mp3`，ffmpeg 转 128kbps 后 ~3MB/首，放 `public/music/`：
  - `Atlantean Twilight.mp3`（synthwave 氛围）/ `Backed Vibes.mp3`（放松电子）/ `8bit Dungeon Level.mp3`（chiptune）
- **管线 `src/core/Bgm.js`**：`BGM_TRACKS` manifest + `registerBgm()`（BootScene.preload 注册）+ `playMenuBgm()`（随机选曲、避开上次；已在播则不重启，Menu→Upgrade 连续）+ `stopMenuBgm()`；音量 = `musicVol × 0.8`，走 Phaser SoundManager（与 MusicEngine 的 Web Audio 独立）
- **场景接入**：Menu/Upgrade 播；Level（合成战斗音乐）+ Calibration（节拍器）+ GameOver（死亡音效）必须 `stopMenuBgm()`——防叠加是硬要求（用户抱怨过）；**Boot 的 CLICK TO BEGIN 点击瞬间即起播**（autoplay policy 下这是最早合法点，进入 Menu 时同曲续播不重启）
- **署名**：Menu 左下角 `♫ Kevin MacLeod (incompetech.com) — CC BY 4.0`（合规底线）
- **修了一个隐藏 bug**：`tests/smoke.mjs` 的静态服务器不解码 URL（空格→%20），首次出现多词文件名资源（mp3）就 404 且 `page.goto networkidle0` 超时——已加 `decodeURIComponent`
- **换歌**：下载新 mp3 进 `public/music/`（ffmpeg `-b:a 128k` 压体积），在 `BGM_TRACKS` 加一行即可；署名文案随曲目更新
- **验证**：42 + 41 + build + smoke（13/13）全绿；注意 `npm run test:browser` 要先 build（dist 会拷贝 public/）

### v2.7 动画自适应 + HUD 布局重构 + 剑气特效（本轮）

**问题 1：提供动画图后没有动画**（用户：`src/core/Anims.js` 需要照片）
- **根因**：代码硬编码「5 行×4 列、每帧 80×80（整图 320×400）」，而用户实际提供的是 AI 生成的 **1024×1536（每帧 256×256，4 列×6 行）**。Phaser 按 80×80 硬切出 12×19=228 帧——加载不报错但每帧只显示角色的一小片，看起来"没动画"
- **解法**：`Anims.js` 新增 `inferSheetFrameSize(width, height)`——只要是 4 列方形帧网格就按实际尺寸推断（320×400→80px×5 行；1024×1536→256px×6 行）；`BootScene` 改为两段式：preload 先 `load.image` 加载 `*_raw` 原图 → create 时检测尺寸 → `textures.addSpriteSheet` 切片 → 注册动画（不能直接 `load.spritesheet`，加载前拿不到尺寸）。行数 ≥5 取前 5 行（idle/attack/hurt/cast/death），多出的行（如 victory）忽略；行数不足时缺失状态自动回退程序化反馈
- **附带发现**：英雄动画没生效的另一个原因——`public/assets/hero/anim.png` 文件缺失（用户只放了 avatar.png），放对路径即可

**问题 2（历史级渲染 bug）：BottomHUD 整个渲染在屏幕顶部，盖住 TopHUD**
- **症状**：屏幕顶部叠着底部条内容（技能栏/英雄区在 y 20~151），底部 650px 以下全空，TopHUD 的敌人头像/名字/HP/PHRASE/combo 全部不可见——**这就是用户"看不到敌人动画"的真正原因**（动画一直在播放，只是被盖住）。此 bug 从最初版本就存在（92px 时代同样盖住 y 0~92）
- **根因**：BottomHUD 所有坐标从 y=0 开始写，背景 `fillRect(0, 0, 1440, barH)` 盖在屏幕顶部；displayList 顺序 TopHUD→BottomHUD→舞台，后创建的 BottomHUD 渲染在 TopHUD 之上
- **解法**：`BAR_Y = CANVAS_H - BOTTOM_HUD_H` 偏移，所有 BottomHUD 对象坐标 +BAR_Y（DESIGN.md 已加"坐标约定"警示，防止回归）
- **发现过程**（供日后排查参考）：对象坐标/displayList/world transform 全部正常 → 用探针对象 + 像素级截图比对定位：隐藏 BottomHUD 的 bg graphics 后 TopHUD 全部显形 → 实锤

**需求 3：HUD 布局重构**（用户指定）
- 英雄 avatar+HP/MP 移到右侧技能栏上方（HP/MP 加大：190×14→220×16 / 190×11→220×12）；底部左侧加迷你敌人区 → 后按用户要求**删除**（敌人信息只在顶部，避免重复）；enemy/hero 头像**放大 2 倍**（40→80 / 44→88）
- 常量随之调整：`TOP_HUD_H` 56→92（容纳 80px 敌人头像）、`BOTTOM_HUD_H` 160→200（88px 英雄头像 + 2×5 技能栏沉底）、STAGE 1440×518

**需求 4：剑气 slash 特效**（被攻击时显示"被剑气打伤"）
- **实现**：`src/ui/SlashFX.js` 的 `playSlash(scene, x, y, opts)`——纯 Graphics 程序化刀光：45° 白色主刃（8px）+ 平行副光晕 + 尖端微光，闪现→沿刀刃展开→淡出，~260ms 后自动 destroy；方向随机（正/反 45° ± 小角度）
- **接入**：`LevelScene.onEnemyDamaged`（玩家命中敌人）→ 敌人头像处，普通 `cyan` / 暴击 `amber`；`onHeroDamaged`（敌人命中英雄）→ 英雄头像处，`enemy` 红粉

**环境坑：vite 依赖预构建缓存损坏**
- **症状**：页面加载正常但 `game.scene.getScenes()` 返回空（场景从未启动，卡在 Boot preload），`npm test`/build 正常——只有浏览器端出问题
- **解法**：`npx vite --force` 强制重新预构建依赖（node_modules/.vite 缓存坏了一次）；遇到"代码没问题但浏览器行为诡异"先试这个

## 6. 待办 / 已知缺口

- **C 组（GAME_PLAN.md）**：~~软惩罚缓冲（已完成 2026-07）~~、角色变体解锁、练习模式——未做
- **DESIGN.md §9 第 8 步**：色盲模拟抽查未做
- **OsuCircles 模式**：用户明确暂缓，只保留 Ball Hop
- **真实音频**：现在全是合成音；换真人声/录音需替换 `scheduleBeat()`

## 7. 用户偏好

- 中文交流（代码/路径/命令保持英文）
- 只保留 Ball Hop 玩法；"先完善机制再谈别的"
- 改动前先出分析/讨论，达成一致再动手；最终产物要能玩、测试全绿
- 重要产出以 Markdown 文档沉淀（GAME_PLAN.md / DESIGN.md / history.md）
