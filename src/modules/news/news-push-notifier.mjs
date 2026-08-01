import { createPendingNewsStore } from "./news-item-store.mjs";

export function createNewsPushNotifier({ stateRoot, pushNotifications, now = () => new Date() }) {
  const store = createPendingNewsStore({ root: stateRoot });
  async function notify(record) {
    if (record.workflow?.status !== "pending_review" || record.workflow?.webPushReceipt) return record;
    const result = await pushNotifications.publish("news.created");
    if (result.sent < 1) return record;
    return store.update(record.id, (current) => ({
      ...current,
      workflow: {
        ...current.workflow,
        webPushReceipt: { sentAt: now().toISOString(), delivered: result.sent },
      },
    }));
  }
  return Object.freeze({ notify });
}
