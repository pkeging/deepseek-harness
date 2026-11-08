# MiniMax H3 Prompt 模板库

## 镜头语言速查

### 相机运动

| 术语 | 英文 | 中文 | 适用场景 |
|------|------|------|----------|
| 推镜头 | Push in / Dolly in | 缓慢推进 | 强调主体、制造紧张感 |
| 拉镜头 | Pull back / Dolly out | 缓慢拉远 | 揭示环境、情感释放 |
| 摇镜 | Pan left/right | 左右摇摄 | 展示广阔场景 |
| 俯仰 | Tilt up/down | 上下俯仰 | 从脚到头/从天空到地面 |
| 跟拍 | Tracking shot | 跟随主体 | 人物行走、奔跑 |
| 滑移变焦 | Dolly zoom | 希区柯克效果 | 震惊、顿悟时刻 |
| 航拍 | Aerial / Drone shot | 无人机俯瞰 | 大场景开场 |
| 手持 | Handheld | 手持拍摄 | 纪实感、紧张感 |
| 稳定器 | Steadicam | 稳定跟拍 | 流畅长镜头 |
| 环绕 | Orbit / Arc shot | 环绕主体 | 戏剧性揭示 |
| 升降 | Crane shot | 升降镜头 | 史诗感 |
| 固定 | Static shot | 固定机位 | 对话、沉思 |

### 景别

| 术语 | 英文 | 范围 | 用途 |
|------|------|------|------|
| 大远景 | Extreme Wide Shot (EWS) | 环境为主 | 建立场景 |
| 远景 | Wide Shot (WS) | 全身+环境 | 展示关系 |
| 全景 | Full Shot (FS) | 全身 | 动作展示 |
| 中景 | Medium Shot (MS) | 腰部以上 | 对话、互动 |
| 近景 | Close Up (CU) | 肩部以上 | 情感表达 |
| 特写 | Extreme Close Up (ECU) | 面部/细节 | 强烈情感 |

## 风格模板

### 电影感 Cinematic

```
Cinematic film look, anamorphic lens flare, shallow depth of field,
film grain, color graded, professional lighting, 35mm film aesthetic
```

### 纪录片 Documentary

```
Documentary style, natural lighting, handheld camera feel,
authentic atmosphere, raw footage aesthetic, observational cinema
```

### 日系动漫 Anime

```
Anime style, vibrant colors, cel-shaded, studio Ghibli inspired,
dreamy atmosphere, beautiful backgrounds, soft lighting
```

### 写实摄影 Photorealistic

```
Photorealistic, 8K resolution, professional photography,
sharp focus, natural colors, DSLR quality, shallow DOF
```

### 黑色电影 Film Noir

```
Film noir style, high contrast black and white, dramatic shadows,
moody atmosphere, venetian blind lighting, chiaroscuro
```

### 奇幻史诗 Fantasy

```
Epic fantasy, magical atmosphere, ethereal lighting,
detailed environment, cinematic scope, volumetric fog
```

## 场景模板

### 自然风光 Nature

```
[Weather]: [Time of day], [Lighting quality]
[Movement]: [Camera movement]
[Details]: [Specific natural elements]
```

示例：
```
Morning mist rolling through ancient pine forest,
soft golden light filtering through canopy,
slow tracking shot following a deer through understory,
dew drops glistening on ferns, birds singing.
Audio: gentle wind, rustling leaves, distant bird calls.
No text, logos or watermarks.
```

### 城市都市 Urban

```
[City type]: [Weather/Time], [Architectural style]
[Movement]: [Camera movement]
[Activity]: [Human activity level]
```

示例：
```
Neo-Tokyo street at night, rain-slicked asphalt reflecting neon signs,
steady cam following protagonist through crowded crossing,
steam rising from manhole covers, holographic advertisements,
cyberpunk atmosphere with subtle anime influence.
Audio: city ambience, distant traffic, rain pattering, electronic hum.
No text, logos or watermarks.
```

### 人物 Portrait

```
[Subject]: [Appearance details]
[Setting]: [Environment]
[Lighting]: [Light quality and direction]
[Movement]: [Camera + subject movement]
```

示例：
```
Elegant woman in qipao standing on ancient stone bridge,
morning light casting long shadows, mist over river,
slow push in from wide to medium close-up,
wind gently moving her hair and silk ribbon,
traditional Chinese architecture in background.
Audio: flowing water, distant temple bell, gentle breeze.
No text, logos or watermarks.
```

### 动作 Action

```
[Action type]: [Specific movements]
[Cinematography]: [Camera technique]
[Pacing]: [Speed and rhythm]
```

示例：
```
Martial arts duel on bamboo platform above misty valley,
dynamic tracking shots weaving between combatants,
slow motion impact moments intercut with real-time flow,
bamboo bending and snapping, leaves swirling in wind.
Audio: whooshes, impacts, breathing, bamboo creaking,
epic orchestral score with traditional instruments.
No text, logos or watermarks.
```

## 提示词结构模板

### 基础结构

```
[风格描述]: [主体描述], [动作/运动], [镜头运动], [光影], [环境]
[音频描述]
No text, logos or watermarks.
```

### 多段叙事结构 (fl2v)

```
Shot [N] ([timecode]): [镜头类型], [主体动作], [镜头运动], [光影], [环境细节]
```

### 负向提示词模板

```
blurry, low quality, distorted, deformed, bad anatomy,
extra limbs, missing limbs, static, frozen,
overexposed, underexposed, noise, artifacts,
text, watermark, logo, timestamp
```

## 音频描述模板

### 自然环境

```
Audio: gentle wind, rustling leaves, birds singing,
distant water flowing, peaceful atmosphere
```

### 城市环境

```
Audio: city ambience, distant traffic, footsteps on pavement,
crowd murmuring, rain pattering on umbrellas
```

### 戏剧性

```
Audio: dramatic orchestral score building tension,
heartbeat rhythm, whooshing transitions,
subtle bass pulses
```

### 宁静

```
Audio: soft ambient sounds, gentle breeze,
distant temple bell, flowing water,
peaceful and meditative
```

## 导演台参数速查

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| Resolution | 864×480 | 0.4MP, 16:9 |
| FPS | 24 | H3 训练帧率 |
| Duration | 5s (124 frames) | 单段标准时长 |
| Steps | 25 (非turbo) / 4 (turbo) | |
| CFG | 1.0 | 官方默认 |
| Sigma shift (video) | 12.0 | |
| Sigma shift (audio) | 3.0 | |
| Context frames | 22 | 段间引导默认值 |
| Sampler | res_multistep | |
| Scheduler | simple | |

## fl2v 分镜提示词技巧

### 首帧描述 (关键帧)

```
Start frame: [精确描述第一帧画面]
Key visual elements: [必须出现在开头的元素]
Composition: [构图要求]
```

### 尾帧描述 (关键帧)

```
End frame: [精确描述最后一帧画面]
Final composition: [结尾构图]
Fade element: [淡出元素]
```

### 中间运动描述

```
[Timecode range]: [运动描述]
Camera: [具体运动方式]
Subject: [主体动作变化]
Transition: [过渡效果]
```

### 完整 fl2v 提示词示例

```
Start frame: Wide aerial view of cherry blossom valley at dawn, pink petals filling the air.
End frame: Close-up of single petal landing on still pond surface, ripples expanding.

[0s-1.5s] Aerial push-in descending through cherry blossom canopy, petals swirling
[1.5s-3s] Camera weaves between ancient trees, light rays piercing through pink haze
[3s-4.2s] Descent continues, valley floor revealed, stream glinting below
[4.2s-5s] Final approach to pond surface, petal drifts into frame, lands gently
```

## 质量提升技巧

### 提示词增强

1. **具体化**: 避免模糊描述，用具体的视觉元素
2. **光影明确**: 指定光源方向、强度、色温
3. **运动描述**: 相机运动和主体动作分开描述
4. **音频同步**: 画面描述与音频描述呼应
5. **负向词**: 始终包含基本负向提示词

### 参数调优

1. **Seed 选择**: 找到满意的 seed 后固定，微调时仅改提示词
2. **Steps 权衡**: 480p 可用 25 步，720p 二采建议 15-25 步
3. **Shift 调整**: shift_video 影响动态范围，过高导致过曝感
4. **分辨率阶梯**: 480p → 720p → 1080p 逐步放大比直接 1080p 质量好

### 多段连贯性

1. **共享元素**: 相邻段保留 1-2 个视觉锚点
2. **运动延续**: 使用段间引导，上下文帧数 22
3. **音频桥接**: 环境音连续，避免突然切换
4. **色彩一致**: 相同场景保持色调统一
