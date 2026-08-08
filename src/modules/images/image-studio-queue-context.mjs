import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { operationalDate } from "./operational-date.mjs";
import { resolveDraftStylePreset } from "./rendering-presets.mjs";

function stableIndex(seed, length) {
  if (!length) return 0;
  const digest = createHash("sha256").update(String(seed)).digest();
  return digest.readUInt32BE(0) % length;
}

function characterPackage(character, { includeImageAnchor = true } = {}) {
  return {
    name: character.name,
    anchor_text: character.anchor_text,
    height_text: character.height_text,
    image_anchor_path: includeImageAnchor ? character.image_anchor_path : null,
  };
}

function applyDraftStyle(context, style) {
  const selected = resolveDraftStylePreset(style);
  if (!selected) return false;
  context.job.mode = "style";
  context.job.style_request = selected.id;
  context.selected_style = selected;
  return true;
}

function indexedStyles(index) {
  return Array.isArray(index.styles)
    ? index.styles
    : Object.values(index.styles || {});
}

function selectedStyleIds(style) {
  if (style?.mode !== "selected") return [];
  return [...new Set(
    (Array.isArray(style.ids) ? style.ids : [style.id]).filter(Boolean).map(String),
  )];
}

function blendStyles(styles) {
  if (styles.length === 1) {
    const [selected] = styles;
    return { id: selected.id, filename: selected.filename, content: selected.content };
  }
  return {
    id: `blend:${styles.map((style) => style.id).join("+")}`,
    filename: null,
    component_ids: styles.map((style) => style.id),
    content: [
      "[STYLE BLEND] Merge the following style directions into one coherent visual language.",
      "Give every component meaningful influence; reconcile conflicts instead of choosing only one component.",
      "Do not make a split-screen, collage, or separate style regions unless the user's scene explicitly asks for that.",
      ...styles.map((style, index) => `\n[STYLE COMPONENT ${index + 1}: ${style.id}]\n${style.content}`),
    ].join("\n"),
  };
}

function applyGuidedStyle(context, style, index, seed) {
  if (applyDraftStyle(context, style)) {
    context.job.mode = "cast";
    return true;
  }
  if (style?.mode === "none") return false;
  const styles = indexedStyles(index);
  const requestedStyleIds = selectedStyleIds(style);
  const selected = style?.mode === "selected"
    ? requestedStyleIds.map((id) => styles.find((item) => item.id === id))
    : style?.mode === "auto"
      ? [styles[stableIndex(`${seed}:guided-style`, styles.length)]]
      : null;
  if (!selected || selected.some((item) => !item)) {
    if (style?.mode === "selected") {
      throw new Error(`선택한 화풍을 자산 색인에서 찾지 못했습니다: ${requestedStyleIds.join(", ")}`);
    }
    return false;
  }
  context.selected_style = blendStyles(selected);
  return true;
}

function guidedCastPackage(characterIds, index, { includeImageAnchors = false } = {}) {
  const characters = index.characters || {};
  const mixedCast = characterIds.length > 1;
  const selected = characterIds.map((id) => {
    if (id === "pink-bridge") {
      const guest = characters["핑크브릿지"]?.source === "special_guest"
        ? characters["핑크브릿지"]
        : null;
      const appearance = String(
        mixedCast && guest?.anchor_text
          ? guest.anchor_text
          : index.pink_bridge?.appearance_prompt ?? "",
      ).trim();
      if (!appearance) throw new Error("핑크브릿지 외형 앵커를 자산 색인에서 찾지 못했습니다.");
      return {
        name: "핑크브릿지",
        anchor_text: appearance,
        height_text: mixedCast ? String(guest?.height_text ?? "") : "",
        image_anchor_path: null,
      };
    }
    if (!characters[id]) throw new Error(`선택한 인물을 자산 색인에서 찾지 못했습니다: ${id}`);
    const character = characters[id];
    if (character.source === "special_guest" && !mixedCast && character.appearance_prompt) {
      return characterPackage(
        { ...character, anchor_text: character.appearance_prompt },
        { includeImageAnchor: includeImageAnchors },
      );
    }
    return characterPackage(character, { includeImageAnchor: includeImageAnchors });
  });
  const ordinaryNames = characterIds.filter((id) => id !== "pink-bridge");
  const matchingGroup = (index.relationship_groups || []).find(
    (group) =>
      Array.isArray(group.members) &&
      ordinaryNames.length > 0 &&
      ordinaryNames.every((name) => group.members.includes(name)),
  );
  return {
    id: "guided-cast",
    relationship: matchingGroup
      ? {
          id: matchingGroup.id,
          label: matchingGroup.label,
          note: matchingGroup.note,
        }
      : {
          id: "user-selected-cast",
          label: "사용자가 직접 선택한 인물 조합",
          note: "사용자 장면 요청에 맞는 자연스러운 관계와 상호작용을 만든다.",
        },
    characters: selected,
  };
}

function selectRelationshipPackages(job, index) {
  const characters = index.characters || {};
  const groups = (index.relationship_groups || []).filter(
    (group) =>
      Array.isArray(group.members) &&
      group.members.some((name) => characters[name]),
  );
  const mentioned = Object.keys(characters).filter((name) =>
    String(job.prompt).includes(name),
  );

  if (mentioned.length) {
    const selectedNames = mentioned.slice(0, 3);
    const matchingGroup = groups.find((group) =>
      selectedNames.every((name) => group.members.includes(name)),
    );
    return [
      {
        id: "mentioned-cast",
        relationship: matchingGroup
          ? {
              id: matchingGroup.id,
              label: matchingGroup.label,
              note: matchingGroup.note,
            }
          : {
              id: "user-mentioned-cast",
              label: "사용자가 지정한 인물 조합",
              note: "사용자 요청 안에서 자연스러운 상호작용을 만든다.",
            },
        characters: selectedNames.map((name) =>
          characterPackage(characters[name]),
        ),
      },
    ];
  }

  const packageCount = Math.max(1, Math.min(Number(job.count) || 1, 4));
  const selected = [];
  const used = new Set();
  for (
    let offset = 0;
    offset < groups.length && selected.length < packageCount;
    offset += 1
  ) {
    const group =
      groups[
        (stableIndex(`${job.id}:relationship`, groups.length) + offset) %
          groups.length
      ];
    if (used.has(group.id)) continue;
    const names = group.members
      .filter((name) => characters[name])
      .slice(0, 3);
    if (!names.length) continue;
    used.add(group.id);
    selected.push({
      id: `cast-${selected.length + 1}`,
      relationship: {
        id: group.id,
        label: group.label,
        note: group.note,
      },
      characters: names.map((name) => characterPackage(characters[name])),
    });
  }
  return selected;
}

function selectAutomaticCharacterIds(job, index) {
  const [relationshipPackage] = selectRelationshipPackages(job, index);
  if (relationshipPackage?.characters?.length) {
    return relationshipPackage.characters.map((character) => character.name).slice(0, 3);
  }
  const candidates = Object.entries(index.characters || {})
    .filter(([, character]) => character?.source !== "special_guest")
    .map(([id]) => id)
    .sort((left, right) => left.localeCompare(right, "ko"));
  if (!candidates.length) return [];
  return [candidates[stableIndex(`${job.id}:automatic-character`, candidates.length)]];
}

export async function buildImageStudioQueueContext(
  job,
  {
    assetIndexPath,
    outputRoot,
    now = new Date(),
    timezone = "Asia/Seoul",
    dayStartsAtHour = 2,
  },
) {
  if (!path.isAbsolute(assetIndexPath) || !path.isAbsolute(outputRoot)) {
    throw new TypeError("assetIndexPath와 outputRoot는 절대경로여야 합니다.");
  }

  const count = Math.max(1, Math.min(20, Number(job.count) || 1));
  const purposeDirectory = {
    "theme-followup": "theme-followup",
    "free-play": "free-play",
  }[job.purpose];
  const outputParts = purposeDirectory
    ? ["extra-requests", purposeDirectory, job.id]
    : ["extra-requests", job.id];
  const context = {
    version: 2,
    job: {
      id: job.id,
      prompt: String(job.prompt || "").trim(),
      composition_direction: String(job.compositionDirection || "").trim() || null,
      count,
      mode: job.mode,
      style_request: job.style || null,
      purpose: purposeDirectory || null,
    },
    output_directory: path.join(
      outputRoot,
      operationalDate(now, { timezone, dayStartsAtHour }),
      ...outputParts,
    ),
    existing_outputs: Array.isArray(job.outputs) ? job.outputs : [],
    generation_rules: {
      one_image_per_call: true,
      never_overwrite_success: true,
      clearly_adult_fictional_people: true,
      no_real_people_or_celebrities: true,
      no_minors: true,
      no_logos_watermarks_or_unintended_text: true,
      reference_images_are_identity_only: true,
    },
  };

  if (count > 1) {
    context.job.prompt += "\n\nBATCH OUTPUT RULE: Each numbered slot is one independent final image. Never create a collage, montage, contact sheet, split screen, or multi-panel layout.";
  }

  if (job.sourceImagePath) {
    if (!path.isAbsolute(job.sourceImagePath)) {
      throw new TypeError("sourceImagePath는 절대경로여야 합니다.");
    }
    context.user_reference_image = path.resolve(job.sourceImagePath);
    context.generation_rules.user_reference_follows_prompt = true;
  }

  if (["guided-cast", "pink-bridge"].includes(job.mode)) {
    const index = JSON.parse(await readFile(assetIndexPath, "utf8"));
    const characterIds = job.mode === "pink-bridge"
      ? ["pink-bridge"]
      : job.characters?.mode === "auto"
        ? selectAutomaticCharacterIds(job, index)
      : Array.isArray(job.characters?.ids)
        ? job.characters.ids
        : [];
    const maximumCharacters = job.batchMode === "per-character" ? 10 : 6;
    if (characterIds.length < 1 || characterIds.length > maximumCharacters) {
      throw new Error(`실제 생성에는 1명부터 최대 ${maximumCharacters}명의 인물 선택이 필요합니다.`);
    }
    const imageAnchorsEnabled = job.useImageAnchors === true;
    const castPackages = job.batchMode === "per-character"
      ? characterIds.map((characterId, packageIndex) => ({
          ...guidedCastPackage([characterId], index, {
            includeImageAnchors: imageAnchorsEnabled,
          }),
          id: `guided-cast-${packageIndex + 1}`,
        }))
      : [guidedCastPackage(characterIds, index, {
          includeImageAnchors: imageAnchorsEnabled,
        })];
    context.job.mode = "cast";
    context.cast_packages = castPackages;
    context.slots = Array.from({ length: count }, (_, indexValue) => ({
      number: indexValue + 1,
      cast_package_id: castPackages[indexValue % castPackages.length].id,
    }));
    const hasDraftStyle = applyGuidedStyle(context, job.style, index, job.id);
    context.guided_selection = {
      character_ids: characterIds,
      style_id: hasDraftStyle ? context.selected_style.id : null,
      style_ids: hasDraftStyle
        ? context.selected_style.component_ids ?? [context.selected_style.id]
        : [],
      image_anchors_enabled: imageAnchorsEnabled,
    };
    return context;
  }

  if (job.mode === "prompt-style") {
    if (!applyDraftStyle(context, job.style)) {
      throw new Error("프롬프트 화풍 또는 렌더링 선택을 확인하지 못했습니다.");
    }
    return context;
  }

  if (job.mode === "selected-style") {
    const index = JSON.parse(await readFile(assetIndexPath, "utf8"));
    const hasStyle = applyGuidedStyle(context, job.style, index, job.id);
    if (!hasStyle || !context.selected_style) {
      throw new Error("선택한 화풍을 자산 색인에서 찾지 못했습니다.");
    }
    context.job.mode = "style";
    return context;
  }

  if (!["style", "chapel"].includes(job.mode)) return context;

  const index = JSON.parse(await readFile(assetIndexPath, "utf8"));
  if (job.mode === "style") {
    const styles = indexedStyles(index);
    const selected =
      job.style && job.style !== "random"
        ? styles.find((style) => style.filename === job.style)
        : styles[stableIndex(`${job.id}:style`, styles.length)];
    if (!selected) {
      throw new Error(`선택한 화풍을 자산 색인에서 찾지 못했습니다: ${job.style}`);
    }
    context.selected_style = {
      id: selected.id,
      filename: selected.filename,
      content: selected.content,
    };
  }

  if (job.mode === "chapel") {
    const castPackages = selectRelationshipPackages(job, index);
    if (!castPackages.length) {
      throw new Error("예배당 인물 패키지를 선택하지 못했습니다.");
    }
    context.cast_packages = castPackages;
    context.slots = Array.from({ length: count }, (_, indexValue) => ({
      number: indexValue + 1,
      cast_package_id: castPackages[indexValue % castPackages.length].id,
    }));
  }

  return context;
}

export async function writeImageStudioQueueContext(filePath, context) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(
    temporary,
    `\uFEFF${JSON.stringify(context, null, 2)}\n`,
    "utf8",
  );
  await rename(temporary, filePath);
}
