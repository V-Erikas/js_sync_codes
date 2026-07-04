import { Permissions, webMethod } from "wix-web-module";
import wixData from "wix-data";
import { apiGet } from "backend/b2bClient.web.js";
import { getState, setState, startLog, finishLog } from "backend/syncHelpers.web.js";
import { translateMany } from "backend/translate.web.js";

const OPTS = { suppressAuth: true, suppressHooks: true };
const PER_PAGE = 25;
const PAGES_PER_RUN = 5;

function attr(p, code) {
  const f = (p.custom_attributes || []).find(a => a.attribute_code === code);
  return f ? f.value : null;
}
function ext(p) { return p.extension_attributes || {}; }

function transform(p) {
  const e = ext(p);
  const images = Array.isArray(e.images) ? e.images : [];
  const paths = Array.isArray(e.category_paths) ? e.category_paths : [];
  return {
    sku: String(p.sku),
    name: p.name,
    description: attr(p, "description") || "",
    retailPrice: Number(e.retail_price) || 0,
    costPrice: Number(e.final_price) || 0,
    weight: p.weight != null ? Number(p.weight) : null,
    ean: attr(p, "ean"),
    brand: attr(p, "brand"),
    color: attr(p, "color"),
    urlKey: attr(p, "url_key"),
    imageUrl: images[0] || null,
    images: images.length ? JSON.stringify(images) : null,
    primaryCategory: paths[0] || null,
    active: p.status === 1,
    updatedAt: p.updated_at || null,
    lastCatalogSync: new Date()
  };
}

function makeHash(p) {
  const e = ext(p);
  const s = [p.name, e.retail_price, e.final_price, p.weight, p.status,
    attr(p, "description"), attr(p, "brand"), attr(p, "color"),
    JSON.stringify(e.category_paths || []), JSON.stringify(e.images || [])].join("|");
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return String(h);
}

function buildQuery(page, sinceIso) {
  let q = `?searchCriteria[page_size]=${PER_PAGE}&searchCriteria[current_page]=${page}`;

  // If no cursor yet, default to a bounded window instead of "everything"
  if (!sinceIso) {
    const d = new Date();
    d.setHours(0,0,0,0);                       // last day
    sinceIso = d.toISOString().slice(0, 19).replace("T", " ");
  }

  q += `&searchCriteria[filter_groups][0][filters][0][field]=updated_at`;
  q += `&searchCriteria[filter_groups][0][filters][0][value]=${encodeURIComponent(sinceIso)}`;
  q += `&searchCriteria[filter_groups][0][filters][0][condition_type]=gteq`;
  return q;
}

async function upsertPage(items) {
  const rows = items.map(p => ({ mapped: transform(p), hash: makeHash(p) }));
  const skus = rows.map(r => r.mapped.sku);
  const existing = await wixData.query("b2bProducts").hasSome("sku", skus).limit(1000).find(OPTS);
  const bySku = {};
  existing.items.forEach(e => { bySku[e.sku] = e; });

  const pending = [];
  let inserted = 0, updated = 0, skipped = 0;
  for (const r of rows) {
    const cur = bySku[r.mapped.sku];
    if (!cur) { pending.push({ r, cur: null }); inserted++; }
    else if (cur.sourceHash !== r.hash) { pending.push({ r, cur }); updated++; }
    else skipped++;
  }

  // Translate name/description/color to Lithuanian for new/changed rows only.
  const texts = [];
  pending.forEach(p => texts.push(p.r.mapped.name || "", p.r.mapped.description || "", p.r.mapped.color || ""));
  let lt = [];
  let translated = true;
  if (texts.length) {
    try { lt = await translateMany(texts, "LT", "EN"); }
    catch (err) { translated = false; console.warn("Translation failed, saving without LT:", err.message); }
  }

  const toSave = [];
  pending.forEach((p, i) => {
    let tr = {};
    if (translated) {
      const b = i * 3;
      tr = { nameLt: lt[b] || null, descriptionLt: lt[b + 1] || null, colorLt: lt[b + 2] || null };
    }
    // If translation failed, don't advance sourceHash so it retries next run.
    const sourceHash = translated ? p.r.hash : (p.cur ? p.cur.sourceHash : undefined);
    if (!p.cur) toSave.push({ ...p.r.mapped, ...tr, sourceHash });
    else toSave.push({ ...p.cur, ...p.r.mapped, ...tr, _id: p.cur._id, sourceHash });
  });

  if (toSave.length) await wixData.bulkSave("b2bProducts", toSave, OPTS);
  return { inserted, updated, skipped };
}

export const runCatalogBatch = webMethod(Permissions.Admin, async () => {
  const log = await startLog("catalog");
  const totals = { inserted: 0, updated: 0, skipped: 0 };
  try {
    const cursor = (await getState("catalogPage"))?.value || 1;
    const sinceIso = (await getState("catalogSince"))?.text || null;
    let page = cursor, done = false;

    for (let i = 0; i < PAGES_PER_RUN; i++, page++) {
      const data = await apiGet("V1/catalogProducts/", buildQuery(page, sinceIso));
      const items = data.items || (Array.isArray(data) ? data : []);
      if (!items.length) { done = true; break; }
      const res = await upsertPage(items);
      totals.inserted += res.inserted; totals.updated += res.updated; totals.skipped += res.skipped;
      if (items.length < PER_PAGE) { done = true; page++; break; }
    }

    if (done) {
      await setState("catalogPage", { value: 1 });
      await setState("catalogSince", { text: new Date().toISOString().slice(0, 19).replace("T", " ") });
    } else {
      await setState("catalogPage", { value: page });
    }
    await finishLog(log, { ...totals, status: "done" });
    return { ...totals, nextPage: done ? 1 : page, cycleComplete: done };
  } catch (err) {
    await finishLog(log, { ...totals, status: "error", errors: err.message });
    throw err;
  }
});
