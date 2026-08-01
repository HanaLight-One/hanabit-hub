const STREAM_ENDPOINT = "https://api.x.com/2/tweets/search/stream";
const RULES_ENDPOINT = "https://api.x.com/2/tweets/search/stream/rules";
export const HANABIT_X_RULE_TAG = "hanabit-news-v1";

function apiError(status) {
  const error = new Error(`X API 요청에 실패했습니다. (${status})`);
  error.statusCode = status;
  error.terminal = status === 401 || status === 403;
  return error;
}

export function buildXStreamRule(handles) {
  const normalized = [...handles].map((handle) => String(handle).trim());
  if (!normalized.length || normalized.some((handle) => !/^[A-Za-z0-9_]{1,15}$/u.test(handle))) {
    throw new TypeError("X 스트림 출처가 올바르지 않습니다.");
  }
  const value = `(${normalized.map((handle) => `from:${handle}`).join(" OR ")}) -is:retweet`;
  if (value.length > 1_024) throw new Error("X 스트림 규칙이 너무 깁니다.");
  return Object.freeze({ value, tag: HANABIT_X_RULE_TAG });
}

function safePost(post) {
  const id = String(post?.id ?? "");
  const authorId = String(post?.author_id ?? "");
  if (!/^\d{5,25}$/u.test(id) || !/^\d{1,25}$/u.test(authorId)) return null;
  return { id, authorId };
}

export function xLinksFromStreamEvent(payload, { allowedHandles }) {
  const main = safePost(payload?.data);
  if (!main) return null;
  const users = new Map((payload?.includes?.users ?? []).map((user) => [
    String(user?.id ?? ""),
    String(user?.username ?? ""),
  ]));
  const username = users.get(main.authorId);
  if (!username || !allowedHandles.has(username.toLowerCase())) return null;

  const includedPosts = new Map((payload?.includes?.tweets ?? [])
    .map((post) => safePost(post))
    .filter(Boolean)
    .map((post) => [post.id, post]));
  const links = [`https://x.com/${username}/status/${main.id}`];
  const seen = new Set([main.id]);
  for (const reference of payload?.data?.referenced_tweets ?? []) {
    if (links.length >= 4 || reference?.type === "retweeted") continue;
    const referenced = includedPosts.get(String(reference?.id ?? ""));
    const referencedUsername = referenced && users.get(referenced.authorId);
    if (!referenced || !referencedUsername || seen.has(referenced.id)) continue;
    if (!/^[A-Za-z0-9_]{1,15}$/u.test(referencedUsername)) continue;
    seen.add(referenced.id);
    links.push(`https://x.com/${referencedUsername}/status/${referenced.id}`);
  }
  return Object.freeze({ handle: username, statusId: main.id, links: Object.freeze(links) });
}

export async function readXFilteredStream({
  bearerToken,
  signal,
  onEvent,
  onConnected = async () => {},
  fetchImpl = fetch,
}) {
  const endpoint = new URL(STREAM_ENDPOINT);
  endpoint.searchParams.set("tweet.fields", "author_id,created_at,referenced_tweets");
  endpoint.searchParams.set("expansions", "author_id,referenced_tweets.id,referenced_tweets.id.author_id");
  endpoint.searchParams.set("user.fields", "id,name,username");
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: { authorization: `Bearer ${bearerToken}` },
    signal,
  });
  if (!response.ok) throw apiError(response.status);
  if (!response.body) throw new Error("X 스트림 응답 본문이 없습니다.");
  await onConnected();

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 1_048_576) throw new Error("X 스트림 이벤트가 너무 큽니다.");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const clean = line.trim();
      if (clean) await onEvent(JSON.parse(clean));
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) await onEvent(JSON.parse(buffer.trim()));
}

export async function getXStreamRules({ bearerToken, fetchImpl = fetch }) {
  const response = await fetchImpl(RULES_ENDPOINT, {
    headers: { authorization: `Bearer ${bearerToken}` },
  });
  if (!response.ok) throw apiError(response.status);
  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

export async function syncXStreamRule({ bearerToken, rule, existingRules, fetchImpl = fetch }) {
  const owned = existingRules.filter((entry) => entry?.tag === HANABIT_X_RULE_TAG);
  if (owned.length === 1 && owned[0].value === rule.value) {
    return Object.freeze({ changed: false });
  }
  const deleteIds = owned.map((entry) => String(entry?.id ?? "")).filter((id) => /^\d{5,25}$/u.test(id));
  const added = await fetchImpl(RULES_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${bearerToken}`, "content-type": "application/json" },
    body: JSON.stringify({ add: [rule] }),
  });
  if (!added.ok) throw apiError(added.status);
  if (deleteIds.length) {
    const removed = await fetchImpl(RULES_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${bearerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ delete: { ids: deleteIds } }),
    });
    if (!removed.ok) throw apiError(removed.status);
  }
  return Object.freeze({ changed: true });
}

export async function runXFilteredStream({
  bearerToken,
  signal,
  onEvent,
  onConnected = async () => {},
  onError = async () => {},
  connect = readXFilteredStream,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  let delay = 5_000;
  while (!signal.aborted) {
    try {
      await connect({ bearerToken, signal, onEvent, onConnected });
      delay = 5_000;
    } catch (error) {
      if (signal.aborted) return;
      await onError(error);
      if (error?.terminal) return;
    }
    if (!signal.aborted) await wait(delay);
    delay = Math.min(delay * 2, 60_000);
  }
}
