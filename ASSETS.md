# ASSETS.md — 素材接入规范

> 状态：2026-07 建立。所有素材由用户产出，放入 `public/assets/`，游戏启动时自动加载；
> **缺素材自动回退到程序化绘制**（不会报错、不会黑屏）。放一个文件就生效一个。
>
> 对应实现：`src/core/Assets.js`（清单 + 缺失收集）+ `BootScene.preload`（加载）。

---

## 0. 总则（所有素材必须遵守）

| 项 | 规范 |
|---|---|
| 格式 | **PNG-32，透明背景**（不是白底/黑底） |
| 命名 | 全部**小写 + 下划线**，与下表文件名完全一致（路径错了 = 不加载 = 回退程序化） |
| 目录 | `public/assets/` 下按类别子目录：`hero/` `enemies/` `skills/` `pets/` `ui/` |
| 画布尺寸 | 按每项要求；**画布四边留 ≥10% 安全边**（主体不贴边，游戏内会缩放+描边） |
| 清晰度 | 按每项给出的画布尺寸画（已是显示尺寸的 2–4 倍），不要更大（体积大加载慢） |
| 风格 | synthwave/outrun：深底画面 + 高饱和霓虹色（cyan `#00d4ff`、magenta `#ff2fd6`、amber `#ffd166`、hero 绿 `#2bff88`、enemy 红 `#ff3b6b`）；几何扁平 + 霓虹辉光感；**在 40px 缩放下必须可读**（主体轮廓清晰、高对比） |
| 禁止 | 纯白背景、细于 1px 的线（缩小时消失）、大量文字（图标内不要写字，名字游戏内已显示） |

**小技巧**：画的时候放大 4 倍画（如 160×160 画布），画完缩小预览一眼 40px 效果——看不清就加粗轮廓。

---

## 1. 核心素材（P0，最影响观感）

### 1.1 Logo —— `public/assets/ui/logo.png`
| 项 | 值 |
|---|---|
| 显示尺寸 | Boot 76px 高 / Menu 58px 高（横向居中） |
| 画布尺寸 | **1600 × 400**（透明背景） |
| 内容 | 游戏名 logo（如 "RYTHMIC"），横向宽幅 |
| 风格 | 霓虹灯管/发光字（cyan→magenta 渐变辉光），粗笔画 |
| 注意 | 主体占画布宽 80–90%、高 70–80%，四周留白；不要加背景块 |

### 1.2 英雄头像 —— `public/assets/hero/avatar.png`
| 项 | 值 |
|---|---|
| 显示尺寸 | 40×40（BottomHUD 左下角） |
| 画布尺寸 | **160 × 160**（4 倍） |
| 内容 | 玩家英雄形象（头/胸像），正面 |
| 风格 | 与敌人同语言：几何卡通 + 霓虹色（英雄主色 cyan `#00d4ff`）；40px 下可读 |
| 注意 | 主体占画布中央 80%（四周 10% 安全边）；游戏内会逐拍缩放（beat-bop）与受击白闪/红闪，不要画太复杂的表情 |

### 1.3 敌人头像 —— `public/assets/enemies/e01.png` … `e20.png`（共 20 张）
| 项 | 值 |
|---|---|
| 显示尺寸 | 40×40（TopHUD 左上角） |
| 画布尺寸 | **160 × 160**（4 倍） |
| 内容 | 每关敌人形象，按下表对照 |
| 风格 | 几何卡通 + 霓虹；**每张用其对应主色**（下表色值）；boss（5/10/15/20）可加皇冠/更强气场 |
| 注意 | 眼睛/表情要简单（游戏内会做 4px 瞳孔追踪鼠标 + 逐拍浮动 + 受击白闪）；主体占中央 80% |

| 文件 | 关卡 | 敌人 | 主色 |
|---|---|---|---|
| `e01.png` | 1 | Tin Drummer | `#8b6f47` |
| `e02.png` | 2 | Snare Sprite | `#6fa8dc` |
| `e03.png` | 3 | Hi-Hat Harpy | `#a78bfa` |
| `e04.png` | 4 | Kick Golem | `#94743c` |
| `e05.png` | 5 | **THE CONDUCTOR** (boss) | `#ffd166` |
| `e06.png` | 6 | Bassline Wraith | `#6d4c9f` |
| `e07.png` | 7 | Loop Fiend | `#4ba3c3` |
| `e08.png` | 8 | Reverb Ghoul | `#7c6f9f` |
| `e09.png` | 9 | Clipping Beast | `#c75c5c` |
| `e10.png` | 10 | **THE MIXER** (boss) | `#ff9f43` |
| `e11.png` | 11 | Sine Serpent | `#4fd1c5` |
| `e12.png` | 12 | Glitch Imp | `#9be15d` |
| `e13.png` | 13 | Sidechain Stalker | `#5c7cfa` |
| `e14.png` | 14 | Distortion Djinn | `#f06595` |
| `e15.png` | 15 | **THE PRODUCER** (boss) | `#ffd43b` |
| `e16.png` | 16 | Null Chorus | `#868e96` |
| `e17.png` | 17 | Phase Reaper | `#845ef7` |
| `e18.png` | 18 | Silence Warden | `#4c6ef5` |
| `e19.png` | 19 | Feedback Titan | `#ff6b6b` |
| `e20.png` | 20 | **THE ENCORE** (boss) | `#ff3860` |

> 如果 20 张太多：**先做 5 个 boss（e05/e10/e15/e20）+ 1 张通用普通敌人**（命名 `e00.png`，普通关共用），其余后续补齐。

---

## 2. 技能图标（P1）

### 2.1 玩家技能图标 —— `public/assets/skills/skill_<id>.png`（共 24 张）
| 项 | 值 |
|---|---|
| 显示尺寸 | 40×40（BottomHUD 技能格 / Upgrade 技能卡 / UNLOCKS 卡） |
| 画布尺寸 | **128 × 128**（3.2 倍） |
| 内容 | 技能主题图形（不要写字） |
| 风格 | 单色或双色剪影 + 霓虹描边；图标主体占中央 80%；**每个技能一个主色**（下表） |
| 注意 | 同一技能在 40px 格子里要一眼认出（图形简单、对比强） |

| 文件 | 技能 | 建议主色 | 图形意象 |
|---|---|---|---|
| `skill_respawn_area.png` | Respawn Area | `#ff9f43` | 火焰/天平（以血换血） |
| `skill_respawn_happier.png` | Respawn Happier | `#8bff5e` | 心 + 音符 |
| `skill_hurry.png` | Hurry | `#ff4d6d` | 闪电/加速 |
| `skill_metronome_heart.png` | Metronome Heart | `#ffd166` | 节拍器/心形节拍 |
| `skill_second_wind.png` | Second Wind | `#8bff5e` | 双翼/风 |
| `skill_ghost_note.png` | Ghost Note | `#a78bfa` | 半透明音符 |
| `skill_mirror_shield.png` | Mirror Shield | `#5ef2ff` | 盾 + 镜面 |
| `skill_overclock.png` | Overclock | `#ff2fd6` | 齿轮/时钟 |
| `skill_vampire_beat.png` | Vampire Beat | `#ff3860` | 蝙蝠/滴血音符 |
| `skill_silence.png` | Silence | `#868e96` | 静音符号 |
| `skill_half_time.png` | Half Time | `#4c6ef5` | 半圆/减速 |
| `skill_double_down.png` | Double Down | `#ffd166` | 双骰子/×2 |
| `skill_pet_feast.png` | Pet Feast | `#9be15d` | 宠物碗/骨头 |
| `skill_encore.png` | Encore | `#ffd43b` | 舞台灯/重播 |
| `skill_bass_drop.png` | Bass Drop | `#6d4c9f` | 低音喇叭/下坠 |
| `skill_shield_loop.png` | Shield Loop | `#5ef2ff` | 循环箭头护盾 |
| `skill_greed_chord.png` | Greed Chord | `#ffd166` | 金币和弦 |
| `skill_scavenger.png` | Scavenger | `#6fa8dc` | 齿轮/拾取 |
| `skill_tempo_thief.png` | Tempo Thief | `#845ef7` | 偷拍/时钟盗贼 |
| `skill_last_stand.png` | Last Stand | `#ff6b6b` | 旗帜/堡垒 |
| `skill_chorus_echo.png` | Chorus Echo | `#4fd1c5` | 回声波纹 |
| `skill_cold_open.png` | Cold Open | `#4c6ef5` | 冰晶/开场 |
| `skill_dissonance.png` | Dissonance | `#ff2fd6` | 扭曲音符 |
| `skill_soul_trade.png` | Soul Trade | `#a78bfa` | 交易/灵魂 |

### 2.2 敌人技能图标 —— `public/assets/ui/eskill_<id>.png`（共 6 张，可选）
| 项 | 值 |
|---|---|
| 显示尺寸 | 16×16（TopHUD 敌人技能栏 + 意图预告） |
| 画布尺寸 | **64 × 64**（4 倍） |
| 文件 | `eskill_jam.png`（音符隐藏，`#ff2fd6`）、`eskill_mirror.png`（镜像，`#5ef2ff`）、`eskill_accelerando.png`（加速，`#ff9f43`）、`eskill_shield.png`（护盾，`#5ef2ff`）、`eskill_mend.png`（治疗，`#8bff5e`）、`eskill_curse.png`（诅咒，`#a78bfa`） |
| 注意 | 16px 极小：**只画一个核心图形**，2 色以内，轮廓要粗 |

---

## 3. 宠物（P2）

### 3.1 宠物形象 —— `public/assets/pets/pet_<id>.png`（共 6 张）
| 项 | 值 |
|---|---|
| 显示尺寸 | Upgrade 弹窗约 100×100 / HUD 角标 12×12 |
| 画布尺寸 | **128 × 128** |
| 内容 | 宠物全身/头像 |
| 风格 | 见下表主色 |

| 文件 | 宠物 | 主色 | 意象 |
|---|---|---|---|
| `pet_metro.png` | Metro（节拍器史莱姆） | `#5ef2ff` | 节拍器/软泥 |
| `pet_kicker.png` | Kicker（鼓甲虫） | `#ff9f43` | 甲虫/鼓槌 |
| `pet_wisp.png` | Wisp（法力飞蛾） | `#a78bfa` | 发光飞蛾 |
| `pet_fang.png` | Fang（贝斯猎犬） | `#ff3860` | 猎犬/獠牙 |
| `pet_cinder.png` | Cinder（火焰金丝雀） | `#ffd166` | 燃烧小鸟 |
| `pet_echo.png` | Echo（镜猫） | `#9be15d` | 猫/镜像 |

---

## 4. 可选增强（P3，不着急）

| 文件 | 用途 | 规范 |
|---|---|---|
| `public/assets/ui/button.png` | 按钮底图（9-slice） | **96×96**，四角圆角 24px 的纯色/渐变方块；游戏内 9-slice 拉伸成任意按钮。不做就保持程序化圆角按钮 |
| `public/assets/ui/bg_menu.png` | 菜单/升级背景 | **2880 × 1620**（2 倍全屏），暗色 synthwave 场景插画；不做就保持程序化渐变网格背景 |

---

## 5. 精灵动画（多帧 sprite sheet）

> 状态：2026-07 建立。**每个敌人/英雄可独立提供动画**，放哪个文件哪个就生效，缺的自动回退到程序化动画（攻击前冲/受击白闪/死亡塌缩）。可分批发：先做 1-5 关 + 英雄，其余后补。

### 6.1 文件与网格

| 素材 | 文件 | 网格 |
|---|---|---|
| 英雄动画 | `public/assets/hero/anim.png` | 4 列 × 5 行（参考） |
| 敌人动画（第 n 关） | `public/assets/enemies/enemy_anim_<n>.png`（如 `enemy_anim_01.png`） | 4 列 × 5 行（参考） |

- **参考布局**：每帧 80×80 → 整图 **320 × 400**（5 行 × 4 列，行序从上到下）
- **自适应**：游戏会按图片实际尺寸自动检测帧大小——只要是「4 列、方形帧」的网格都能用（如 AI 生成的 1024×1536 = 4 列 × 6 行、每帧 256×256 也直接生效）。行数 ≥5 取前 5 行，多出的行（如 victory）忽略；行数不足则缺失状态自动回退程序化动画
- PNG-32 透明背景；主体占每帧中央 **85-90%**（显示时缩到 40×40，四边留安全边）

### 6.2 行序（从上到下，固定顺序，每行 4 帧从左到右）

| 行 | 状态 | 播放参数（游戏内已定） | 每帧动作建议 |
|---|---|---|---|
| 0 | `idle` | 8 fps，循环 | 呼吸/浮动 2-4 帧循环（首尾要能无缝衔接） |
| 1 | `attack` | 14 fps，播一次 | 前摇 → 挥击/前冲 → 收回（第 1 帧≈idle，第 4 帧≈idle，方便衔接） |
| 2 | `hurt` | 14 fps，播一次 | 受击后仰/闪白/抖动 |
| 3 | `cast` | 12 fps，播一次 | 施法蓄力（抬手发光/光环） |
| 4 | `death` | 12 fps，播一次（停最后一帧） | 塌缩/破碎/消散 |

### 6.3 绘制要求

- **同一角色形象**必须与静态头像（§1.3）一致——动画行和头像画同一个角色
- 动作幅度：**小但清晰**——显示尺寸只有 40×40，大幅位移会糊；用「关键帧差异」表达动作（前倾、后仰、压扁、拉伸），不要依赖微小位移
- attack 的第 4 帧与 idle 第 1 帧相似 → 攻击后平滑回 idle
- 每帧主体位置尽量居中稳定（不要整体漂移，游戏内还会叠加 beat-bop 缩放）
- 颜色沿用 §1.3 敌人主色表；boss 动画可加特效帧（闪光/粒子感）

### 6.4 生效方式

放文件 → 重启游戏（`npm run dev`）→ 对应敌人/英雄自动播放动画；没放的文件对应敌人继续用程序化动画。验证：浏览器 console 会打印 `[assets] missing, using procedural fallback: enemy_anim_03` 说明该关没放动画；打印 `does not look like a 4-column square-frame grid` 说明图片格式不对（不是 4 列方形帧网格）。

---

## 6. 命名速查（对应代码）

- 敌人头像 key：`enemy_1` … `enemy_20`（文件 `e01.png`…`e20.png`，`e00.png` 为通用替代）
- 英雄头像 key：`hero_avatar`
- Logo key：`logo`
- 技能图标 key：`skill_<skill_id>`（`skill_respawn_area.png` → key `skill_respawn_area`）
- 敌人技能 key：`eskill_<id>`
- 宠物 key：`pet_<pet_id>`

**动画**：
- spritesheet key：`hero_anim` / `enemy_anim_<n>`（n=1..20）
- 动画 key：`hanim_<state>`（英雄）/ `eanim_<n>_<state>`（敌人），state ∈ idle/attack/hurt/cast/death

**验证方式**：放入文件后跑 `npm run dev`，看对应位置是否替换了程序化图形；或跑 `npm run build && npm run test:browser`（smoke 不因缺素材失败——缺素材自动回退是设计行为）。
