import { createPendingNewsStore } from "./news-item-store.mjs";

function decisionLabel(value) {
  return value === "publish" ? "바로 올리자아!!" : "애매하네? 일단 검토해!";
}

export function createDiscordNewsNotifier({ stateRoot, pendingChannel }) {
  const store = createPendingNewsStore({ root: stateRoot });

  async function notify(record) {
    if (record.workflow?.status !== "pending_review" || record.workflow?.discordPendingReceipt) return record;
    const marker = `[HANABIT-NEWS:${record.id}]`;
    const recent = await pendingChannel.messages.fetch({ limit: 100 });
    const existing = [...recent.values()].find((message) => String(message.content ?? "").includes(marker));
    const translation = record.workflow.translation;
    const triage = record.workflow.triage;
    let message = existing;
    if (!message) {
      const body = String(translation.body).slice(0, 800);
      const content = [
        marker,
        `**${decisionLabel(triage.decision)}**`,
        `**${translation.title}**`,
        body,
        `판정: ${triage.reason}`,
        record.source.url,
      ].join("\n\n").slice(0, 1_950);
      const files = (await store.mediaFiles(record.id)).slice(0, 10).map((file) => ({
        attachment: file.target,
        name: file.filename,
      }));
      message = await pendingChannel.send({ content, files });
    }
    return store.update(record.id, (current) => ({
      ...current,
      workflow: {
        ...current.workflow,
        discordPendingReceipt: { messageId: String(message.id), sentAt: new Date().toISOString() },
      },
    }));
  }

  return Object.freeze({ notify });
}
