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

function characterPackage(character) {
  return {
    name: character.name,
    anchor_text: character.anchor_text,
    height_text: character.height_text,
    image_anchor_path: character.image_anchor_path,
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

  if (job.mode === "pink-bridge") {
    const index = JSON.parse(await readFile(assetIndexPath, "utf8"));
    const appearance = String(index.pink_bridge?.appearance_prompt ?? "").trim();
    if (!appearance) throw new Error("핑크브릿지 외형 앵커를 자산 색인에서 찾지 못했습니다.");
    const userPrompt = context.job.prompt;
    context.job.mode = "natural";
    context.job.prompt = [
      "USER SCENE REQUEST (preserve this scene intent):",
      userPrompt,
      "LOCKED SUBJECT: exactly one clearly adult fictional Pink-Bridge Girl.",
      "PINK BRIDGE APPEARANCE (identity and appearance lock):",
      appearance,
      "Keep the user's requested scene, action, mood, and composition while preserving this locked identity.",
    ].join("\n\n");
    const hasDraftStyle = applyDraftStyle(context, job.style);
    context.guided_selection = {
      character_ids: ["pink-bridge"],
      style_id: hasDraftStyle ? context.selected_style.id : null,
    };
    return context;
  }

  if (job.mode === "prompt-style") {
    if (!applyDraftStyle(context, job.style)) {
      throw new Error("프롬프트 화풍 또는 렌더링 선택을 확인하지 못했습니다.");
    }
    return context;
  }

  if (!["style", "chapel"].includes(job.mode)) return context;

  const index = JSON.parse(await readFile(assetIndexPath, "utf8"));
  if (job.mode === "style") {
    const styles = Object.values(index.styles || {});
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
