"""ComfyUI MiniMax H3 HQ Nodes — prompt enhancer and image preparation helpers.

Provides two utility nodes for the text-to-video pipeline:
1. H3PromptEnhancer: expands a short prompt into H3-compatible cinematic prompt
2. H3ImagePrep: prepares reference images (resize, fit, normalize) for Director input

Usage: wire these into the MiniMaxH3Director workflow as needed.
"""

from __future__ import annotations

import hashlib
import logging
import os
from typing import Tuple

import numpy as np
import torch
from comfy.utils import common_upscale

log = logging.getLogger("ComfyUI-H3-HQ-Nodes")

# ---------------------------------------------------------------------------
# Prompt Enhancement Templates
# ---------------------------------------------------------------------------

_STYLE_TEMPLATES = {
    "cinematic": (
        "Cinematic film look, anamorphic lens flare, shallow depth of field, "
        "film grain, color graded, professional lighting"
    ),
    "documentary": (
        "Documentary style, natural lighting, handheld camera feel, "
        "authentic atmosphere, raw footage aesthetic"
    ),
    "anime": (
        "Anime style, vibrant colors, cel-shaded, studio Ghibli inspired, "
        "dreamy atmosphere, beautiful backgrounds"
    ),
    "photorealistic": (
        "Photorealistic, 8K resolution, professional photography, "
        "sharp focus, natural colors, DSLR quality"
    ),
    "noir": (
        "Film noir style, high contrast black and white, dramatic shadows, "
        "moody atmosphere, venetian blind lighting"
    ),
    "fantasy": (
        "Epic fantasy, magical atmosphere, ethereal lighting, "
        "detailed environment, cinematic scope"
    ),
}

_CAMERA_MOVES = [
    "slow push in",
    "gentle pan right",
    "smooth tracking shot",
    "subtle dolly zoom",
    "steadicam following",
    "aerial drone push forward",
    "handheld subtle shake",
    "static establishing shot with slow zoom",
]

_AUDIO_TAGS = [
    "ambient sounds, subtle background music",
    "natural ambience, wind, distant sounds",
    "cinematic score with soft percussion",
    "rain sounds, atmospheric ambiance",
    "city ambience, subtle traffic",
]


def _enhance_prompt(
    base_prompt: str,
    style: str = "cinematic",
    camera_move: str = "",
    add_audio: bool = True,
    negative: str = "blurry, low quality, distorted, deformed, bad anatomy, extra limbs, static, frozen",
) -> str:
    """Expand a short prompt into a full H3-compatible cinematic prompt."""
    parts = []

    # Style tag
    style_desc = _STYLE_TEMPLATES.get(style.lower(), _STYLE_TEMPLATES["cinematic"])
    parts.append(style_desc)

    # User base prompt
    if base_prompt.strip():
        parts.append(base_prompt.strip())
    else:
        parts.append("a cinematic scene with natural motion")

    # Camera move
    if camera_move:
        parts.append(camera_move)
    else:
        parts.append(_CAMERA_MOVES[0])

    # Audio
    if add_audio:
        audio_desc = _AUDIO_TAGS[0]
        parts.append(f"Audio: {audio_desc}")

    # Negative
    if negative:
        parts.append(negative)
    parts.append("No text, logos or watermarks.")

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Node Definitions
# ---------------------------------------------------------------------------


class H3PromptEnhancer:
    """Enhance a short prompt into a full H3-compatible cinematic prompt."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "base_prompt": ("STRING", {"default": "", "multiline": True}),
                "style": (
                    ["cinematic", "documentary", "anime", "photorealistic", "noir", "fantasy"],
                    {"default": "cinematic"},
                ),
                "camera_move": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": "Optional camera movement description. Leave empty for random.",
                    },
                ),
                "add_audio": ("BOOLEAN", {"default": True}),
                "negative_prompt": (
                    "STRING",
                    {
                        "default": "blurry, low quality, distorted, deformed, bad anatomy, extra limbs, static, frozen",
                        "multiline": True,
                    },
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    FUNCTION = "enhance"
    CATEGORY = "MiniMaxH3/HQ"
    OUTPUT_NODE = False

    def enhance(
        self,
        base_prompt: str,
        style: str,
        camera_move: str,
        add_audio: bool,
        negative_prompt: str,
    ) -> Tuple[str]:
        if not camera_move.strip():
            import random
            camera_move = random.choice(_CAMERA_MOVES)

        result = _enhance_prompt(
            base_prompt=base_prompt,
            style=style,
            camera_move=camera_move,
            add_audio=add_audio,
            negative=negative_prompt,
        )
        return (result,)


class H3ImagePrep:
    """Prepare reference images for H3 Director input."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "max_size": ("INT", {"default": 864, "min": 32, "max": 2048, "step": 32}),
                "fit_mode": (["fill", "fit", "center_crop"], {"default": "fit"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("images", "width", "height")
    FUNCTION = "prep"
    CATEGORY = "MiniMaxH3/HQ"
    OUTPUT_NODE = False

    def prep(
        self,
        images: torch.Tensor,
        max_size: int,
        fit_mode: str,
    ) -> Tuple[torch.Tensor, int, int]:
        """Resize images to fit within max_size while preserving aspect ratio."""
        if images.dim() == 3:
            images = images.unsqueeze(0)

        orig_h, orig_w = images.shape[2], images.shape[3]
        scale = min(max_size / orig_w, max_size / orig_h, 1.0)
        new_w = int(orig_w * scale // 32 * 32)
        new_h = int(orig_h * scale // 32 * 32)

        if new_w != orig_w or new_h != orig_h:
            images = common_upscale(
                images.movedim(-1, 1), new_w, new_h, "lanczos", "disabled"
            ).movedim(1, -1)

        if fit_mode == "fill":
            # Pad to square if needed
            h, w = images.shape[2], images.shape[3]
            if h != w:
                pad = abs(h - w)
                pad_left = pad // 2
                pad_right = pad - pad_left
                images = torch.nn.functional.pad(images, (pad_left, pad_right, 0, 0), mode="constant", value=0)
                new_w = max_size
            elif h > max_size:
                images = common_upscale(
                    images.movedim(-1, 1), max_size, max_size, "lanczos", "disabled"
                ).movedim(1, -1)
                new_w = max_size
                new_h = max_size
            else:
                new_h = h
                new_w = w
        elif fit_mode == "center_crop":
            h, w = images.shape[2], images.shape[3]
            size = min(h, w)
            y1 = (h - size) // 2
            x1 = (w - size) // 2
            images = images[:, :, y1:y1+size, x1:x1+size]
            new_w = size
            new_h = size
        else:  # fit
            new_h, new_w = images.shape[2], images.shape[3]

        # Normalize to [0, 1] if needed
        if images.max() > 1.0:
            images = images / 255.0

        return (images, new_w, new_h)


class H3TurboLoader:
    """Load the MiniMax H3 Turbo 4-step LoRA and apply to UNET model."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "lora_name": (
                    [f for f in os.listdir("models/loras") if f.endswith(".safetensors")]
                    if os.path.isdir("models/loras") else ["minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"]
                ),
                "strength_model": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "load_turbo"
    CATEGORY = "MiniMaxH3/HQ"
    OUTPUT_NODE = False

    def load_turbo(self, model, lora_name: str, strength_model: float):
        try:
            import comfy.model_management as mm
            from comfy.utils import load_torch_file

            lora_path = os.path.join("models/loras", lora_name)
            if not os.path.exists(lora_path):
                log.warning("Turbo LoRA not found: %s", lora_path)
                return (model,)

            lora = load_torch_file(lora_path, safe_load=True)
            model = mm.load_model_gpu(model)
            model.add_object_patches({
                "diffusion_model": lora,
            })
            return (model,)
        except Exception as e:
            log.error("Failed to load Turbo LoRA: %s", e)
            return (model,)


# ---------------------------------------------------------------------------
# Node Registration
# ---------------------------------------------------------------------------

NODE_CLASS_MAPPINGS = {
    "H3PromptEnhancer": H3PromptEnhancer,
    "H3ImagePrep": H3ImagePrep,
    "H3TurboLoader": H3TurboLoader,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "H3PromptEnhancer": "H3 Prompt Enhancer",
    "H3ImagePrep": "H3 Image Prep",
    "H3TurboLoader": "H3 Turbo LoRA Loader",
}
