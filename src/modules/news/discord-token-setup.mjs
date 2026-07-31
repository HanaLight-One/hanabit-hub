import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TOKEN_KEY = "DISCORD_BOT_TOKEN";
const TOKEN_PATTERN = /^[A-Za-z0-9._-]{50,200}$/;

function setupError(code, message) {
  return Object.assign(new Error(message), { code });
}

function parseTokenLine(content) {
  const lines = content.split(/\r?\n/);
  const values = lines
    .filter((line) => line.startsWith(`${TOKEN_KEY}=`))
    .map((line) => line.slice(TOKEN_KEY.length + 1).trim());

  if (values.length === 0) {
    throw setupError("TOKEN_KEY_MISSING", `${TOKEN_KEY} 항목이 없습니다.`);
  }
  return values.find(Boolean) ?? "";
}

function validateToken(tokenInput) {
  const token = String(tokenInput ?? "");
  if (!TOKEN_PATTERN.test(token)) {
    throw setupError("INVALID_TOKEN", "올바른 Discord Bot Token을 입력해 주세요.");
  }
  return token;
}

export function createDiscordTokenSetup({ envPath }) {
  if (!path.isAbsolute(envPath)) {
    throw new TypeError(".env 경로는 절대경로여야 합니다.");
  }

  let saveInProgress = false;

  async function readEnv() {
    try {
      return await readFile(envPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        throw setupError("ENV_FILE_MISSING", ".env 파일이 없습니다.");
      }
      throw error;
    }
  }

  async function status() {
    const content = await readEnv();
    return Object.freeze({ configured: Boolean(parseTokenLine(content)) });
  }

  async function save(tokenInput) {
    if (saveInProgress) {
      throw setupError("SAVE_IN_PROGRESS", "다른 저장 요청을 처리 중입니다.");
    }

    saveInProgress = true;
    try {
      const token = validateToken(tokenInput);
      const content = await readEnv();
      if (parseTokenLine(content)) {
        throw setupError("ALREADY_CONFIGURED", "Bot Token이 이미 설정되어 있습니다.");
      }

      const newline = content.includes("\r\n") ? "\r\n" : "\n";
      const lines = content.split(/\r?\n/);
      let replaced = false;
      const updatedLines = [];

      for (const line of lines) {
        if (!line.startsWith(`${TOKEN_KEY}=`)) {
          updatedLines.push(line);
        } else if (!replaced) {
          updatedLines.push(`${TOKEN_KEY}=${token}`);
          replaced = true;
        }
      }

      if (!replaced) {
        throw setupError("TOKEN_KEY_MISSING", `${TOKEN_KEY} 항목이 없습니다.`);
      }

      await writeFile(envPath, updatedLines.join(newline), {
        encoding: "utf8",
        mode: 0o600,
      });
      return Object.freeze({ saved: true, configured: true });
    } finally {
      saveInProgress = false;
    }
  }

  return Object.freeze({ status, save });
}
