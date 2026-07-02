const DB_NAME = "team-agent-marco-web";
const DB_VERSION = 1;
let database;

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

export function getRecord(name, key) {
  return new Promise((resolve, reject) => {
    const request = store(name).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getAllRecords(name) {
  return new Promise((resolve, reject) => {
    const request = store(name).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export function putRecord(name, value) {
  return new Promise((resolve, reject) => {
    const request = store(name, "readwrite").put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function removeRecord(name, key) {
  return new Promise((resolve, reject) => {
    const request = store(name, "readwrite").delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function loadPreferences() {
  return (await getRecord("settings", "preferences")) || {
    id: "preferences",
    consultExperts: true,
    maxOutputTokens: 4000,
    reasoningEffort: "medium",
    timeoutMs: 120000
  };
}

export async function savePreferences(preferences) {
  await putRecord("settings", { id: "preferences", ...preferences });
}

export async function loadProviders() {
  return (await getRecord("settings", "providers"))?.items || [];
}

export async function saveProviders(items) {
  await putRecord("settings", { id: "providers", items });
}

export async function saveConversation(conversation) {
  await putRecord("conversations", conversation);
}

export async function getConversation(id) {
  return getRecord("conversations", id);
}

export async function listConversations() {
  return (await getAllRecords("conversations"))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 80);
}

async function getVaultKey() {
  const stored = await getRecord("vault", "crypto-key");
  if (stored?.key) return stored.key;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await putRecord("vault", { id: "crypto-key", key });
  return key;
}

export async function saveProviderSecret(providerId, secret, remember) {
  sessionStorage.removeItem(`team-agent-key:${providerId}`);
  if (!remember) {
    sessionStorage.setItem(`team-agent-key:${providerId}`, secret);
    await removeRecord("vault", `secret:${providerId}`);
    return;
  }
  const key = await getVaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(secret);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  await putRecord("vault", {
    id: `secret:${providerId}`,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  });
}

export async function readProviderSecret(providerId, providerLabel = providerId) {
  const session = sessionStorage.getItem(`team-agent-key:${providerId}`);
  if (session) return session;
  const record = await getRecord("vault", `secret:${providerId}`);
  if (!record) throw new Error(`${providerLabel} Key 不存在，请重新添加。`);
  const key = await getVaultKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

export async function removeProviderSecret(providerId) {
  sessionStorage.removeItem(`team-agent-key:${providerId}`);
  await removeRecord("vault", `secret:${providerId}`);
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
