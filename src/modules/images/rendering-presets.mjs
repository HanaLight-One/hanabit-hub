export const RENDERING_PRESETS = Object.freeze({
  "hyper-realistic": Object.freeze({
    id: "hyper-realistic",
    label: "Hyper-realistic",
    instruction: "Render in a strictly hyper-realistic photographic style with realistic anatomy, materials, optics, lighting, and physical detail.",
  }),
  "hyper-realistic-anime": Object.freeze({
    id: "hyper-realistic-anime",
    label: "Hyper-realistic-anime",
    instruction: "Render as hyper-realistic anime: retain deliberate anime character design and expressive shapes while using highly realistic materials, lighting, depth, and environmental detail.",
  }),
  "semi-realistic-anime": Object.freeze({
    id: "semi-realistic-anime",
    label: "Semi-realistic-anime",
    instruction: "Render as semi-realistic anime with clearly illustrated anime design, believable anatomy and lighting, refined materials, and a balanced painterly finish.",
  }),
  "2.5d-semi-realistic-anime-reality-forward": Object.freeze({
    id: "2.5d-semi-realistic-anime-reality-forward",
    label: "2.5D Semi-realistic-anime · reality-forward",
    instruction: "Render as 2.5D semi-realistic anime with a reality-forward finish: preserve anime identity while prioritizing dimensional form, realistic light, materials, spatial depth, and cinematic physical presence.",
  }),
});

const PROMPT_DEFINED_STYLE = Object.freeze({
  id: "prompt-defined",
  filename: "prompt-defined",
  content: "The user's request defines the complete visual style. Preserve those style instructions exactly and do not add a default photographic, realistic, semi-realistic, anime, or house style.",
});

export function resolveDraftStylePreset(style) {
  if (style?.mode === "prompt") return PROMPT_DEFINED_STYLE;
  if (style?.mode !== "rendering") return null;
  const preset = RENDERING_PRESETS[style.id];
  if (!preset) return null;
  return Object.freeze({
    id: preset.id,
    filename: preset.id,
    content: preset.instruction,
  });
}
