import { Permissions, webMethod } from "wix-web-module";
import { fetch } from "wix-fetch";
import { getSecret } from "wix-secrets-backend";


let cachedToken = null;
let tokenExpiry = 0;
const TOKEN_TTL_MS = 50 * 60 * 1000; // refresh every 50 min

async function getBaseConfig() {
  const [host, storeCode] = await Promise.all([
    getSecret("active_shop_host"),
    getSecret("active_shop_store_code")
  ]);
  return { host, storeCode };
}

async function requestToken() {
  const [user, password] = await Promise.all([
    getSecret("active_shop_user"),
    getSecret("active_shop_pass")
  ]);
  const { host, storeCode } = await getBaseConfig();

  const res = await fetch(
    `${host}/eng/rest/${storeCode}/V1/integration/customer/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password })
    }
  );
  if (!res.ok) throw new Error(`AUTH failed: HTTP ${res.status}`);

  const token = await res.json();
  return token;
}

async function getToken(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedToken && now < tokenExpiry) return cachedToken;
  cachedToken = await requestToken();
  tokenExpiry = now + TOKEN_TTL_MS;
  return cachedToken;
}

export async function apiGet(path, query = "") {
  const { host, storeCode } = await getBaseConfig();
  const url = `${host}/eng/rest/${storeCode}/${path}${query}`;

  let token = await getToken();
  let res = await fetch(url, {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
  });

  if (res.status === 401) { // token expired → refresh once, retry
    token = await getToken(true);
    res = await fetch(url, {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
    });
  }

  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json();
}

// --- testing ---
export const testAuth = webMethod(Permissions.Admin, async () => {
  const token = await getToken(true);
  return { gotToken: !!token, type: typeof token, preview: String(token).slice(0, 12) + "..." };
});

export const testConnection = webMethod(Permissions.Admin, async () => {
  const data = await apiGet("V1/catalogProducts/",
    "?searchCriteria[page_size]=1&searchCriteria[current_page]=1");
  const item = data.items ? data.items[0] : data;
  return { totalCount: data.total_count ?? "n/a", sample: item };
});



