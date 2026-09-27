---
name: comfyui-h3-hq-skill
description: |
  Use when building high-quality text-to-video workflows with ComfyUI + MiniMax H3 Director
  on a 12GB RTX 3060. Covers performance tuning, multi-segment directing (fl2v/t2v/r2v/v2v),
  text-to-image pre-generation, prompt engineering, and refinement/upscale strategies.
  Guidance, not a script — verify every parameter against your live ComfyUI UI.
---

# ComfyUI MiniMax H3 高质量视频生成 Skill

## 定位

本 Skill 面向以下硬件和工作流：
- **GPU**: NVIDIA GeForce RTX 3060 (12GB VRAM)
- **CPU**: Intel i5-12400F / RAM 32GB
- **后端**: torch 2.13 + CUDA 12.6 + SageAttention (MSVC 编译)
- **模型栈**:
  - UNET: `minimax_h3_fl2va_pruned_int8_convrot.safetensors` (t2v/i2v/fl2v)
  - UNET: `minimax_h3_ref2va_pruned_int8_convrot.safetensors` (r2v/v2v/rv2v)
  - CLIP: `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` (type=minimax)
  - Video VAE: `minimax_h3_video_vae_fp16.safetensors`
  - Audio VAE: `minimax_h3_audio_vae_fp32.safetensors`
  - Turbo LoRA: `minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors`
- **输出**: 一采 864×480 (0.4MP) / 二采 1280×720 (0.9MP)，24fps，5秒/段

## 运行前提

每次使用本 Skill 前请确认：
1. ComfyUI ≥ v0.30.0，且已加载官方 MiniMax H3 节点
2. `ComfyUI_MiniMaxH3_Director` 自定义节点已安装并生效
3. 所有模型文件均在 `models/` 下正确放置
4. 启动脚本使用 `--use-sage-attention`（或 `run_nvidia_gpu_fast_fp16_accumulation.bat`）

## 核心工作流路径

```
文本 Prompt
    ↓
[文生图节点]  ← 可选：先生成高质量参考图
    ↓
[导演台 Director]  task_type = t2v 或 fl2v
    ↓
[Refine 二采]  mode=upscale, target=1280×720
    ↓
[SaveVideo]
```

## 高性能配置指南

### 启动参数优化

```
python_embeded\python.exe -s ComfyUI\main.py \
  --windows-standalone-build \
  --enable-manager \
  --use-sage-attention
```

**关键标志说明**：
- `--use-sage-attention`：用 SageAttention 替换原生 attention，RTX 3060 上提速 30-50%
- `--fast fp16_accumulation`（另一启动脚本）：FP16 累加加速，对 int8 convrot 模型额外有益

### 导演台性能参数推荐（12GB 场景）

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| `clear_vram_between_segments` | **True** | 每段结束后卸载模型，防止多段累积 OOM |
| `cache_frames_codec` | `ffv1` | 分段缓存用无损压缩，体积约为 raw 的 1/3 |
| `steps` | 25 (一采) + 4 (turbo 二采) | 官方模板 25 步；turbo LoRA 可降至 4 步 |
| `shift_video` | 12.0 | MiniMaxH3SigmaShift 默认值 |
| `shift_audio` | 3.0 | 音频 shift 略低，避免音频过平滑 |
| `cfg` | 1.0 | H3 官方推荐，不使用 CFG |
| `ref_max_size` | 864 | 参考图长边上限，与画布匹配 |

### 显存管理要点

1. **段间清理**：多段生成时务必开启 `clear_vram_between_segments=True`
2. **二采前清理**：`clear_vram_before_refine=True` 可降低二采峰值，代价是多一次模型加载
3. **避免同时开多个任务**：12GB 单卡同一时间只跑一个 Director 任务
4. **关闭不必要的预览**：`export_source_images=False`，未用时不占内存
5. **FFV1 缓存**：相比 raw `.pt`，FFV1 节省约 2/3 磁盘空间，对多段生成显著

## 导演台分镜技巧

### t2v（纯文生视频）

适合单镜头、快速验证。提示词结构：

```
[风格描述], [主体描述], [镜头运动], [环境/光影], [音频描述]
No text, logos or watermarks.
```

**示例**：
```
Cinematic aerial shot, morning mist over ancient Chinese village,
slow drone push-in toward stone bridge, soft golden hour light,
distant temple bell, gentle wind.
No text, logos or watermarks.
```

### fl2v（首尾帧生视频）— 多镜头导演核心

**关键优势**：精确控制每段开头和结尾画面，实现电影级转场。

**工作流**：
1. 选 `task_type = fl2v — 首尾帧生视频`
2. 点「添加一组」，上传首帧和/或尾帧（可只传尾帧）
3. 提示词写**中间运动**（首尾已钉死，提示词负责衔接）
4. 多段时开启「段间引导」+「引用上段」，上下文帧数默认 **22**
5. 「选择运行」可单独跑某几组

**提示词模板（fl2v 中间运动）**：
```
[镜头运动描述: dolly zoom / tracking shot / pan right / tilt up]
[主体动作: walking / turning / reaching]
[光影变化: light shifting / shadows lengthening]
```

### r2v（参考主体生视频）

**场景**：角色锁定、电商产品展示、连续多镜头同一主角。

**公共参数**（必须开启）：
- 上传角色参考图（Picture 1-3）
- 写公共提示词含 `<Picture 1>` 等标签
- 公共提示词会与每组提示词拼接

**组内提示词**：
```
Close-up: character looking at horizon, gentle wind in hair, Picture 1.
Medium shot: character walking through bamboo forest, Picture 1.
Wide shot: character small against mountain, Picture 1.
```

### v2v / rv2v（视频编辑）

- **v2v**：源视频时间轴分段 → 每段重写提示词 → 重新生成
- **rv2v**：源视频 + 参考图 → 改变角色外观但保持动作

**注意**：`rv2v` 和 `r2v` 使用 **ref2va** UNET，而非 fl2va。

### 段间引导（Motion Context）

- 默认关闭，多段时建议开启
- 上下文帧数推荐 **22**（平衡衔接与自然）
- 可用值：5 / 22 / 39 / 56（必须是 17k+5 网格的合法值）
- 原理：上一段末尾 N 帧的运动向量注入下一段起点，裁掉前缀后输出

## 文生图前置策略

### 为什么先生图

- 用 SDXL / Flux / SD1.5 等成熟文生图模型生成高质量单帧
- 再用 fl2v 以该图为**首帧**，精控镜头运动
- 图像质量远超 H3 直接生成的首帧

### 推荐流程

```
文生图 (SDXL/Flux) →  upscale (若需要) → fl2v 首帧 → 生视频
```

**注意事项**：
- 生图分辨率建议与导演台画布一致（864×480），或更大后 downscale
- 参考图长边不超过 `ref_max_size`（默认 864）
- 首帧图风格需与后续镜头一致，否则衔接会跳戏

## 二采与放大（Refine）

### 何时用 Refine

- 一采 480p 结果模糊 → 二采放大到 720p
- 一采细节不足 → 同分辨率精修
- fl2v 首尾帧需要保护 → 默认跳过二采，需手动关闭 `skip_fl2v`

### Refine 模式

| mode | 说明 | 适用场景 |
|------|------|----------|
| `refine` | 同分辨率再采一遍 | 修正瑕疵、增强细节 |
| `upscale` | 先放大到目标画布再二采 | 480p→720p/1080p |
| `latent_upscale` | 只放大 H3 latent，不二采 | 最快，质量一般 |

### 推荐配置

```
mode = upscale
目标 = 1280×720 (0.9MP)
upscale_method = h3_latent (3D权重，默认)
passes = 1（首次放大 + 精修）
sigmas = 接 BasicScheduler (refine_model 卸掉 turbo LoRA)
```

### Turbo LoRA 的使用策略

- **一采**：加载 `minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors`
  - steps 可降至 4 步，速度提升 6x
  - 质量略低于 25 步，但配合 Refine 可弥补
- **二采**：建议卸掉 turbo LoRA，换回原始 UNET + 25 步精修

## Prompt 工程指南

### MiniMax H3 Prompt 结构

H3 使用 Qwen3-VL-32B 作为 CLIP，支持自然语言 + 标签语法：

```
[Style]: [Subject], [Action], [Camera Movement], [Lighting], [Environment]
[Audio description]
No text, logos or watermarks.
```

### 镜头语言词汇表

| 英文术语 | 中文含义 | 用法 |
|----------|----------|------|
| `aerial shot` | 航拍 | 大场景开场 |
| `tracking shot` | 跟拍 | 跟随主体运动 |
| `dolly zoom` | 滑移变焦 | 悬疑/震撼效果 |
| `pan left/right` | 摇镜 | 展示环境 |
| `tilt up/down` | 俯仰 | 从脚到头或反之 |
| `close-up` | 特写 | 面部/细节 |
| `medium shot` | 中景 | 人物全身 |
| `wide shot` | 远景 | 环境关系 |
| `establishing shot` | 建立镜头 | 场景交代 |
| `push in` | 推进 | 强调主体 |
| `pull back` | 拉远 | 揭示环境 |
| `handheld` | 手持 | 纪实感/紧张感 |
| `steadicam` | 稳定器 | 流畅跟拍 |

### 负向提示

H3 官方推荐使用 `No text, logos or watermarks.` 作为固定尾部。

其他常用负向词：
- `blurry, low quality, distorted, deformed`
- `bad anatomy, extra limbs`
- `overexposed, underexposed`
- `static, frozen`

## 故障排查

### OOM（显存不足）

1. 降低画布分辨率（如 640×360）
2. 开启 `clear_vram_between_segments=True`
3. 关闭 `export_source_images`
4. 减少段落数量，分段生成
5. 使用 `latent_upscale` 而非 `upscale` 模式
6. 考虑 W4A4 量化版本（社区分支 `sepiablue-ai/ComfyUI-MiniMax-H3-W4A4-VSA`）

### 画面闪烁/跳切

1. 开启「段间引导」并勾选「引用上段」
2. 适当增加上下文帧数（22→39）
3. 检查 fl2v 首尾帧衔接是否自然
4. 保证相邻段提示词连贯

### 音频不同步

1. 检查 `shift_audio` 是否为 3.0
2. r2v/v2v/rv2v 音频模式选择正确（generate/source/mute）
3. 参考音频文件采样率与视频帧率匹配

### CLIP 加载失败

- 确认 `type=minimax` 在 CLIPLoader 中选择
- `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` 必须在 `models/text_encoders/` 下

## 参考资源

- 官方文档：[docs.comfy.org · MiniMax H3](https://docs.comfy.org/zh/tutorials/video/minimax/minimax-h3)
- 12GB 显存指南：[shiqikuangsan31/MiniMax-H3-12GB-ComfyUI-Guide](https://github.com/shiqikuangsan31/MiniMax-H3-12GB-ComfyUI-Guide)
- 3060 工作流：[tlano-z/ComfyUI-MiniMax-H3-Workflows-For3060](https://github.com/tlano-z/ComfyUI-MiniMax-H3-Workflows-For3060)
- H3 Turbo 4步蒸馏：[ModelTC/MiniMax-H3-Turbo](https://github.com/ModelTC/MiniMax-H3-Turbo)
- 插件教程 B 站：[AIMixer B 站合集](https://space.bilibili.com/1997403556/lists/8357740)
- Comfyit 搅拌站：[comfyit.cn/article/506](https://comfyit.cn/article/506)
- Semantic Bridge：[speach1sdef178/MiniMax-H3-Semantic-Bridge](https://huggingface.co/speach1sdef178/MiniMax-H3-Semantic-Bridge)
- SelfLift 渐进一采：[slmonker/selflift-Avatar](https://github.com/slmonker/selflift-Avatar)
- Motion Context：[NikoDemon80/ComfyUI-H3-Motion-Context](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context)
- VisionPromptor（本地 VLM 生成 H3 Prompt）：[benjiyaya/ComfyUI-H3-VisionPromptor](https://github.com/benjiyaya/ComfyUI-H3-VisionPromptor)

## 本 Skill 文件索引

| 文件 | 用途 |
|------|------|
| `nodes/comfyui_h3_hq_nodes.py` | Prompt 增强节点 + 图预处理节点 |
| `workflows/t2v_hq_baseline.json` | 高质量 T2V 基线工作流 |
| `workflows/fl2v_multishot_480p.json` | 多镜头 fl2v 480p 工作流 |
| `workflows/t2v_upscale_720p.json` | T2V 480p→720p 二采工作流 |
| `assets/prompt_templates.md` | 完整 Prompt 模板库 |
