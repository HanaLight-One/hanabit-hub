import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_STYLE_TEXT_LENGTH = 80;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function normalizeStyle(style) {
  const id = String(style?.id ?? "").trim();
  if (
    !id ||
    id.length > MAX_STYLE_TEXT_LENGTH ||
    CONTROL_CHARACTERS.test(id)
  ) {
    return null;
  }
  return Object.freeze({ id, label: id });
}

function normalizeCharacter(character, fallbackId) {
  const id = String(character?.name ?? fallbackId ?? "").trim();
  if (
    !id ||
    id.length > MAX_STYLE_TEXT_LENGTH ||
    CONTROL_CHARACTERS.test(id)
  ) {
    return null;
  }
  return Object.freeze({ id, label: id });
}

export function createCreationOptionsCatalog({ assetIndexPath }) {
  if (!path.isAbsolute(assetIndexPath ?? "")) {
    throw new TypeError("자산 색인 경로는 절대경로여야 합니다.");
  }

  async function list() {
    const info = await stat(assetIndexPath);
    if (!info.isFile() || info.size > MAX_INDEX_BYTES) {
      throw new Error("자산 색인을 안전하게 읽을 수 없습니다.");
    }

    const index = JSON.parse(await readFile(assetIndexPath, "utf8"));
    const rawStyles = Array.isArray(index.styles)
      ? index.styles
      : Object.values(index.styles ?? {});
    const seen = new Set();
    const styles = rawStyles
      .map(normalizeStyle)
      .filter((style) => style && !seen.has(style.id) && seen.add(style.id))
      .sort((left, right) => left.label.localeCompare(right.label, "ko"));
    const rawCharacters = Array.isArray(index.characters)
      ? index.characters.map((character) => [character?.name, character])
      : Object.entries(index.characters ?? {});
    const pinkBridgeAvailable = Boolean(
      String(index.pink_bridge?.appearance_prompt ?? "").trim(),
    );
    const seenCharacters = new Set();
    const characters = rawCharacters
      .map(([key, character]) => normalizeCharacter(character, key))
      .filter(
        (character) =>
          character &&
          !(pinkBridgeAvailable && character.id === "핑크브릿지") &&
          !seenCharacters.has(character.id) &&
          seenCharacters.add(character.id),
      )
      .sort((left, right) => left.label.localeCompare(right.label, "ko"));
    if (
      pinkBridgeAvailable &&
      !seenCharacters.has("pink-bridge")
    ) {
      characters.unshift(
        Object.freeze({ id: "pink-bridge", label: "핑크브릿지" }),
      );
    }

    return Object.freeze({
      styles: Object.freeze(styles),
      characters: Object.freeze(characters),
    });
  }

  return Object.freeze({ list });
}
