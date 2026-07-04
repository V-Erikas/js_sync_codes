import wixData from "wix-data";
const OPTS = { suppressAuth: true, suppressHooks: true };

export async function getState(key) {
  const r = await wixData.query("SyncState").eq("key", key).limit(1).find(OPTS);
  return r.items[0] || null;
}
export async function setState(key, { value, text } = {}) {
  const existing = await getState(key);
  const row = existing || { key };
  if (value !== undefined) row.value = value;
  if (text !== undefined) row.text = text;
  return existing ? wixData.update("SyncState", row, OPTS)
                  : wixData.insert("SyncState", row, OPTS);
}
export async function startLog(job) {
  return wixData.insert("SyncLog", { job, startedAt: new Date(), status: "running" }, OPTS);
}
export async function finishLog(logRow, patch) {
  return wixData.update("SyncLog",
    { ...logRow, ...patch, finishedAt: new Date(), status: patch.status || "done" }, OPTS);
}
