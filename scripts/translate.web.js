import { fetch } from "wix-fetch";
import { getSecret } from "wix-secrets-backend";

/**
 * Minimal DeepL translation helper.
 * Requires a Wix Secret `deepl_api_key`.
 * Free keys (ending in ":fx") use the free endpoint automatically.
 */

const FREE_ENDPOINT = "https://api-free.deepl.com/v2/translate";
const PRO_ENDPOINT = "https://api.deepl.com/v2/translate";
const CHUNK = 45; // DeepL allows up to 50 text params per request

function endpointFor(key) {
  return key.endsWith(":fx") ? FREE_ENDPOINT : PRO_ENDPOINT;
}

/**
 * Translate an array of strings, preserving order and length.
 * Empty/blank entries are returned as "" without hitting the API.
 * @param {string[]} texts
 * @param {string} [target="LT"]
 * @param {string} [source="EN"]
 * @returns {Promise<string[]>}
 */
export async function translateMany(texts, target = "LT", source = "EN") {
  const out = new Array(texts.length).fill("");
  const idx = [];
  const payload = [];
  texts.forEach((t, i) => {
    if (t != null && String(t).trim()) { idx.push(i); payload.push(String(t)); }
  });
  if (!payload.length) return out;

  const key = await getSecret("deepl_api_key");
  const url = endpointFor(key);

  for (let c = 0; c < payload.length; c += CHUNK) {
    const slice = payload.slice(c, c + CHUNK);
    const parts = [`target_lang=${encodeURIComponent(target)}`];
    if (source) parts.push(`source_lang=${encodeURIComponent(source)}`);
    slice.forEach(t => parts.push(`text=${encodeURIComponent(t)}`));

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `DeepL-Auth-Key ${key}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: parts.join("&")
    });
    if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`);

    const data = await res.json();
    (data.translations || []).forEach((tr, j) => { out[idx[c + j]] = tr.text; });
  }
  return out;
}
