# RYTHMIC — 机制分析与改进规划

> 状态：规划文档 · 日期：2026-07 · 核心玩法方向：**仅保留 Ball Hop（jumping tiles）**，Osu Circles 等其他模式暂缓
> **实施状态（2026-07）：A 组与 B 组全部落地。** A1 音乐分层（`MusicEngine.setComboLayer`）、A2 第 1 关教学谱、A3 approach tick、B4 Dash + hyperfruit、B5 视野四档递减（`visibleBeatsForLevel`）、B6 Hurry 真密度（`notesPerPhrase(level, tier)`）均已实现并通过全部测试。C 组：**软惩罚缓冲（第 9 条）已完成**；角色变体（第 7 条）/ 练习模式（第 8 条）仍为待办。
> 依据：`GAME_DESIGN.md` + 源码逐行验证（`src/minigames/BallHop.js` 等）+ 线上参考研究（来源见 §二）

---

## 一、我们的游戏机制是什么（Ball Hop 核心）

**一句话：一个只有"1 个自由度"的节奏游戏——玩家不控制时间，只控制位置。**

| 层 | 机制 | 实现（代码验证） |
|---|---|---|
| 输入 | 仅鼠标横向移动，**永无点击** | 只绑 `pointermove`（BallHop.js:107），`targetX` 夹在路肩内，球以 lerp 跟随 |
| 时间 | 球**自动**在每拍起跳，玩家碰不到时机 | `hop = \|sin(phase×π)\| × 46px`（BallHop.js:507） |
| 判定 | **纯位置判定**：把"距 tile 中心的距离"线性映射成"时间误差"，复用 Judge 的 ±45/±90/±135ms 窗口 | `judge((dist/0.5)×134, tier)`（BallHop.js:601）；beat 前 70ms 窗口取最近距离（`SAMPLE_MS`） |
| 结构 | 8 拍短语交替：敌人短语 = 格挡（MISS 掉血），英雄短语 = 伤害（accuracy → 输出） | CombatResolver：`dmg = ATK×0.25×weight×COMBO×PET×DIFF_ATK×(1−DEF/(DEF+100))` |
| 信息 | 视野 7.5 拍全谱可见，**sight-readable**；对齐发光（beat 前反馈）+ 引导轨 + 车道高亮 | `VISIBLE_BEATS=7.5`，`aligned` 时 tile 变白（BallHop.js:563-572） |
| 过渡 | 模式门：全宽横条横穿道路，**穿越 = 模式切换**（DEFEND/ATTACK），带光幕和球变色 | `drawGate`/`onGateCrossed`（BallHop.js:394-465） |
| 耦合 | mana = 4+10×ACC²，跨关携带；combo 乘数 `min(4, 1+floor(combo/25)×0.25)` | CombatResolver / RunState |
| 包裹 | 20 关 permadeath、3 stat 点/级、24 技能选 10、宠物、Shards meta | RunState / SkillEngine / SaveManager |

**这个设计为什么成立：**
1. 判定是"你早就该在哪"，不是"你此刻准不准"——**没有 timing 焦虑**，上手门槛极低；
2. 持续的目标跟踪（对齐发光在 beat 前就告诉你"你正对着"）制造了流畅感；
3. 模式门把 FNF 式的"突然切换"变成可预读的连续过渡；
4. 不对称难度（`DIFF_ATK`/`DIFF_RISK`）是**整个研究里没有任何先例的差异化设计**。

---

## 二、线上参考范例研究（带来源）

### 机制上最像我们的：osu!catch（osu 的接水果模式）
来源：https://osu.ppy.sh/wiki/en/Game_mode/osu!catch
- 判定**纯位置**：水果按节拍落下，接到就是 GREAT，**根本没有 timing 窗口**——和我们的位置判定是同一哲学。
- 它有而我们没有的三个关键机制：
  - **Dash 状态**：接球手可 2× 速度横移，激活时盘子发光 + 残影；
  - **Hyperfruit 自动警告**：当下一个水果远到需要 dash 才能接住时，自动生成一个红色发光水果提示你"该冲刺了"——**游戏自动预告不可达间隔**；
  - **Approach Rate（AR）**：官方把它作为"提前多少拍看到音符"的难度旋钮——和我们的 `VISIBLE_BEATS` 同物，但我们把它固定死了（7.5），它是我们的潜在难度维度。

### 结构上最像我们的：Crypt of the NecroDancer（节奏 roguelike 鼻祖）
来源：https://en.wikipedia.org/wiki/Crypt_of_the_NecroDancer
- 节拍门控移动、永久死亡、**钻石（meta 货币）死后保留**、**解锁角色 = 改变节奏规则**（Monk 碰金币即死、Bard 无视节奏）、tempo 升序 = 难度曲线。
- 差异：它把 miss 做成**软惩罚**（重置金币乘数 + 暴露位置），我们直接掉血；它有角色变体解锁，我们 meta 只有起始技能槽。

### 其他关键参考

| 游戏 | 核心 | 判定 | 与我们的差异 / 可借鉴 |
|---|---|---|---|
| **Piano Tiles**（2014） | 黑砖下滑点按 | 时机判定、点白砖即死 | 类型祖先；教训：即时死亡 = 挫败，我们不学 |
| **Geometry Dash** | 自动滚动 + 单键跳 | 二分碰撞 | 哲学一致（节拍在关卡里）；教训：固定关卡催生"背板"，程序生成必须可 sight-read |
| **Hi-Fi Rush**（2023） | 动作战斗自动上拍 | **踩拍是奖励不是门槛**，自动同步 | 我们的"球自动跳"就是同一原则：精准度 = 加分项，不是通行证 |
| **Bit.Trip Runner** | 自动跑 + 跳跃 | 碰撞 | **combo 升层 = 音乐加层**（Hyper→Ultra 时编曲逐层加入）——最便宜的"爽"；教训：少动词（作者删掉了复杂动作） |
| **A Dance of Fire and Ice** | 单键严格踩拍 | 严格 timing | 法则："**no tricks, nothing is reaction-based**"——程序生成关卡的铁律，我们已符合 |
| **Rhythm Doctor** | 单键对拍 | 听感判定 | 教学模板：**每关先教一个新机制再破坏它**；无声拍、不规则拍号可做成难度/敌人技能 |
| **FNF**（2020） | 镜像对方音符 | 漏拍扣血 | 我们的短语结构原型；难度 = 速度+复杂度，我们却是纯数值（见 §四-B6） |
| **Guitar Hero** | 音符高速路 | 分级判定 | **Star Power**：玩家攒满主动激活 = 双倍分+回血，**主动风险开关**——我们 mana/技能已有雏形（Hurry 就是） |
| **Metal: Hellsinger** | FPS 踩拍输出 | 踩拍 = 增伤 | "accuracy as damage"的标杆；fury 计量器随表现**逐层加乐器** |
| **Thumper** | 节奏暴力 | 碰撞 | Play+ 模式"速度随你的乘数增长"——奖励喂难度，与我们的 Hurry 方向相反，值得对照 |
| **BPM: Bullets Per Minute** | 节奏 roguelike FPS | 脱拍 = 哑火 | **最重要的一课**：Metacritic 74、OpenCritic 54%——节奏×roguelike 两个技能层相乘放大挫败，官方缓解手段全是"宽松惩罚 + 教学" |

---

## 三、整合对比：我们有 / 他们没有

### 我们独有（研究确认无先例）
1. **不对称难度层级** `DIFF_ATK` 1.0/1.30/1.60/2.00 vs `DIFF_RISK` 1.0/1.45/2.00/2.80——所有参考游戏的难度都是对称的（NecroDancer 的 tempo 升序、FNF 的速度+复杂度、osu 的 AR），**"升档 = 收益递减的赌博"是真实卖点**；
2. **位置误差 → 时间窗口的线性映射**（dist→ms）——osu!catch 只有"接住/没接住"，我们有 PERFECT/GREAT/GOOD 梯度；
3. **模式门作为连续过渡**——FNF 是硬切横幅，我们是可预读的穿越。

### 他们有过半我们没有的（按价值排序）
1. **音乐分层组合奖励**（Bit.Trip Runner / Metal: Hellsinger）——最便宜的爽点，我们没有；
2. **Dash + hyperfruit 自动警告**（osu!catch）——车道跳限被物理约束，dash 能解锁更激进的谱面并变成资源决策；
3. **AR 式视野旋钮**——我们固定 7.5 拍；
4. **角色变体解锁**（NecroDancer）——meta 层最有力的扩展；
5. **逐关教学**（Rhythm Doctor）——我们只有一行 hint text；
6. **tile 临近的音频提示**（Rhythm Doctor 的"音频先行"）——我们判定音在调内（已实现），但没有 approach tick；
7. **练习模式**（osu! 的 retry 文化）——不消耗 run 的练习，降低学习成本；
8. **软惩罚选项**（NecroDancer）——我们 MISS 直接掉血，是硬惩罚。

### 我们的潜在隐患（BPM 教训 + Bit.Trip Runner 教训）
- 24 个技能 × 4 个难度档 = 两个叠加的技能层，挫败感会相乘——需要"宽松惩罚/教学"作为缓冲；
- `Hurry` 目前只加速接近 + 缩窗口（`approachBeats`），**不改变谱面密度**（`notesPerPhrase` 只随 level 走）——文档说密度会涨，代码没有。既是文档与代码的差异，也是设计上可修的点。

---

## 四、Ball Hop 改进建议（按落地优先级）

### A 组 · 快赢（✅ 已完成 2026-07）
1. **Combo 升层 = 音乐加层**（借鉴 Bit.Trip Runner / Metal: Hellsinger）：我们已经程序合成音乐（`MusicEngine.makeSong`）且判定音在调内，把"连续 PERFECT 每 8 拍加一层合成器（bass→drums→lead），断 combo 掉层"做成音频反馈——整个研究里性价比最高的 juice；
2. **逐关教学**（借鉴 Rhythm Doctor）：第 1 关只出直行 tile，第 2 关引入变道，第 3 关引入模式门，第 4 关引入首个 debuff——成本低，直接改善前 10 分钟的留存；
3. **tile 接近音**：每个 tile 进入最后 1 拍时给一个轻声"嗒"（approach tick），帮助听感弱的玩家。

### B 组 · 机制级（✅ 已完成 2026-07）
4. **Dash + Hyperfruit**（借鉴 osu!catch，且保持鼠标-only）：甩鼠标速度超过阈值 → 球 2× 横向速度 + 发光残影；当下一 tile 超出当前可达距离时 tile 自动变红发光（"需要冲刺"警告）。这把"车道跳限"从硬约束变成**资源决策**，也是新的技能设计空间（dash 强化/无限 dash）；
5. **AR 式视野旋钮**：`VISIBLE_BEATS` 7.5 → 每关递减（7.5/6.5/5.5/4.5），比只加 BPM 更精细的难度轴；
6. **Hurry 真正加密度**：让 tier 影响谱面生成（或二次采样），兑现文档 §8 的承诺，同时让低准确率玩家明确感知到"升档 = 更密 + 窗口更小"。

### C 组 · 结构级（待办）
7. **角色变体解锁**（NecroDancer 式）：meta 解锁"换规则"的英雄——例如窄判定英雄（+10% 伤害）、慢球英雄（+1 宽容车道）、双球英雄（判定取较差者）。这是 Shards 的最优出口；
8. **练习模式**：关卡开始前可"免费试玩当前谱面一次"（不消耗 run），学谱成本归零；
9. **软惩罚缓冲**（BPM 教训）——✅ 已完成 2026-07：不推翻 MISS 掉血，但"每短语第一个 MISS 免伤"成为**全体玩家默认规则**（`CombatResolver.resolveEnemyNote` 首个 miss 免伤 + 金色护盾反馈 + `sfx('shield')`）。触发时 combo/acc/音乐层照断，只免伤害——惩罚仍在，只是不致命。**Shield Loop 技能保留原样**（它把 MISS 改成 GOOD = 完全豁免，成为"保 combo"的进阶层，与默认保底差异化）。效果：整体曲线右移约一个准确率档（80% 死 20 关 / 85% 险过 / 90% 47% / 95% 88%），`balance_sim.py` 与 `combat.test.js` 已镜像。

### 明确不建议做的
- **加点击/按键**（Bit.Trip Runner 教训：少动词）——"never click"是 Ball Hop 的立身之本，保留；
- **做成 GD 式固定关卡**——程序生成 + sight-readable 是对的，别回头；
- **严格 timing 变体**（ADoFaI 路线）——那是另一种游戏，且与 roguelike 的挫败叠加。

---

## 五、一句话总结

核心机制（**自动节奏 + 纯位置判定 + 短语攻防 + 不对称难度**）在参考研究里没有直接对手——osu!catch 有位置判定但无战斗/roguelike，NecroDancer 有 roguelike 但无位置判定。**差异化已经成立，缺的是"反馈层"**：音乐分层、教学、dash 警告这些把"玩得对"变成"感觉得到"的机制。

建议先做 A 组（全部低风险），再做 B 组的 dash——它最能解锁 Ball Hop 的上限。

---

## 附：参考来源清单

- osu!catch 官方 wiki：https://osu.ppy.sh/wiki/en/Game_mode/osu!catch
- Crypt of the NecroDancer：https://en.wikipedia.org/wiki/Crypt_of_the_NecroDancer
- Piano Tiles：https://en.wikipedia.org/wiki/Piano_Tiles
- Geometry Dash：https://en.wikipedia.org/wiki/Geometry_Dash
- Hi-Fi Rush：https://en.wikipedia.org/wiki/Hi-Fi_Rush
- Bit.Trip Runner：https://en.wikipedia.org/wiki/Bit.Trip_Runner
- A Dance of Fire and Ice（Steam）：https://store.steampowered.com/app/977950/A_Dance_of_Fire_and_Ice/
- Rhythm Doctor：https://en.wikipedia.org/wiki/Rhythm_Doctor
- Friday Night Funkin'：https://en.wikipedia.org/wiki/Friday_Night_Funkin%27
- Guitar Hero：https://en.wikipedia.org/wiki/Guitar_Hero_(video_game)
- Metal: Hellsinger：https://en.wikipedia.org/wiki/Metal:_Hellsinger
- BPM: Bullets Per Minute：https://en.wikipedia.org/wiki/BPM:_Bullets_Per_Minute
- Thumper：https://en.wikipedia.org/wiki/Thumper_(video_game)

> 注：Ball Hop 3D（Voodoo）、Beat Stomper、Magic Tiles 3 因搜索源不可用未能核实，文中未作为事实引用。
