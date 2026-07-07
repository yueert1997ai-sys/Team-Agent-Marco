const DB_NAME = "team-agent-marco-web";
const DB_VERSION = 1;
let database;

export const DEFAULT_AGENT_PROFILES = {
  deepseek: {
    displayName: "老D",
    role: "总控 / 产品反方",
    personality: "直接、务实、先找漏洞，再给能落地的方案。说话不要端着。",
    systemPrompt: "你叫老D。你负责把问题拆清楚、挑出风险、给出下一步动作。不要空话，不要过度礼貌。"
  },
  zhipu: {
    displayName: "智谱参谋",
    role: "中文策略 / 资料整理",
    personality: "稳、细、适合补充背景、梳理结构和中文表达。",
    systemPrompt: "你是智谱参谋。你负责补全信息、整理结构、指出遗漏和给出可执行建议。"
  },
  openai: {
    displayName: "GPT 总控",
    role: "最终整合 / 高阶判断",
    personality: "清晰、克制、负责最后整合。",
    systemPrompt: "你负责最终整合所有意见，给出清晰可执行的回答。"
  },
  gemini: {
    displayName: "Gemi",
    role: "技术 / 多模态 / 广角分析",
    personality: "视野宽，适合补充技术路线和替代方案。",
    systemPrompt: "你负责从技术、信息完整度和替代方案角度补充意见。"
  }
};

export async function initializeStorage() {
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("vault")) db.createObjectStore("vault", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "id" });
      if (!db.objectStoreNames.contains("conversations")) db.createObjectStore("conversations", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function store(name, mode = "readonly") {
  if (!database) throw new Error("浏览器存储尚未初始化。");
  return database.transaction(name, mode).objectStore(name);
}
export function getRecord(name, key) { return requestToPromise(store(name).get(key)); }
export function getAllRecords(name) { return requestToPromise(store(name).getAll()).then((value) => value || []); }
export function putRecord(name, value) { return requestToPromise(store(name, "readwrite").put(value)); }
export function removeRecord(name, key) { return requestToPromise(store(name, "readwrite").delete(key)); }
function requestToPromise(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }

export async function loadPreferences() {
  const defaults = { id: "preferences", primaryProviderId: "deepseek", consultExperts: true, showProcess: true, maxOutputTokens: 4000, timeoutMs: 120000 };
  return { ...defaults, ...((await getRecord("settings", "preferences")) || {}) };
}
export async function savePreferences(preferences) { await putRecord("settings", { id: "preferences", ...preferences }); }
export async function loadProviders() { return (await getRecord("settings", "providers"))?.items || []; }
export async function saveProviders(items) { await putRecord("settings", { id: "providers", items }); }
export async function loadAgentProfiles() { return { ...DEFAULT_AGENT_PROFILES, ...((await getRecord("settings", "agents"))?.items || {}) }; }
export async function saveAgentProfiles(items) { await putRecord("settings", { id: "agents", items }); }
export async function saveConversation(conversation) { await putRecord("conversations", conversation); }
export async function getConversation(id) { return getRecord("conversations", id); }
export async function listConversations() { return (await getAllRecords("conversations")).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 80); }

async function getVaultKey() {
  const stored = await getRecord("vault", "crypto-key");
  if (stored?.key) return stored.key;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await putRecord("vault", { id: "crypto-key", key });
  return key;
}
export async function saveProviderSecret(providerId, secret, remember) {
  sessionStorage.removeItem(`team-agent-key:${providerId}`);
  if (!remember) { sessionStorage.setItem(`team-agent-key:${providerId}`, secret); await removeRecord("vault", `secret:${providerId}`); return; }
  const key = await getVaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret));
  await putRecord("vault", { id: `secret:${providerId}`, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) });
}
export async function readProviderSecret(providerId, providerLabel = providerId) {
  const session = sessionStorage.getItem(`team-agent-key:${providerId}`);
  if (session) return session;
  const record = await getRecord("vault", `secret:${providerId}`);
  if (!record) throw new Error(`${providerLabel} Key 不存在，请重新添加。`);
  const key = await getVaultKey();
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(record.iv) }, key, base64ToBytes(record.ciphertext));
  return new TextDecoder().decode(plaintext);
}
export async function removeProviderSecret(providerId) { sessionStorage.removeItem(`team-agent-key:${providerId}`); await removeRecord("vault", `secret:${providerId}`); }
function bytesToBase64(bytes) { let binary = ""; bytes.forEach((byte) => binary += String.fromCharCode(byte)); return btoa(binary); }
function base64ToBytes(value) { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
