import { Permissions, webMethod } from "wix-web-module";
import wixData from "wix-data";
import { apiGet } from "backend/b2bClient.web.js";
import { startLog, finishLog } from "backend/syncHelpers.web.js";

const OPTS = { suppressAuth: true, suppressHooks: true };
const DRAIN = 400;

export const fetchAllStock = webMethod(Permissions.Admin, async () => {
  const log = await startLog("stock-fetch");
  try {
    const data = await apiGet("V1/catalogProductsStockInventory");
    const list = Array.isArray(data) ? data : (data.items || []);
    await wixData.truncate("StockStaging", OPTS);
    const rows = list.map(s => ({
      sku: String(s.sku), ean: s.ean ? String(s.ean) : null,
      stock: Number(s.qty) || 0, inStock: !!s.is_in_stock, applied: false
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      await wixData.bulkInsert("StockStaging", rows.slice(i, i + 1000), OPTS);
    }
    await finishLog(log, { inserted: rows.length, status: "done" });
    return { staged: rows.length };
  } catch (err) {
    await finishLog(log, { status: "error", errors: err.message }); throw err;
  }
});

export const applyStockBatch = webMethod(Permissions.Admin, async () => {
  const log = await startLog("stock-apply");
  try {
    const pending = await wixData.query("StockStaging").eq("applied", false).limit(DRAIN).find(OPTS);
    if (!pending.items.length) { await finishLog(log, { status: "done", updated: 0 }); return { done: true }; }

    const skus = pending.items.map(s => s.sku);
    const prods = await wixData.query("b2bProducts").hasSome("sku", skus).limit(1000).find(OPTS);
    const bySku = {};
    prods.items.forEach(p => { bySku[p.sku] = p; });

    const updates = [];
    for (const s of pending.items) {
      const p = bySku[s.sku];
      if (p) { p.stock = s.stock; p.inStock = s.inStock; p.ean = s.ean; p.lastStockSync = new Date(); updates.push(p); }
      s.applied = true;
    }
    if (updates.length) await wixData.bulkSave("b2bProducts", updates, OPTS);
    await wixData.bulkSave("StockStaging", pending.items, OPTS);
    await finishLog(log, { updated: updates.length, status: "done" });
    return { done: false, updated: updates.length };
  } catch (err) {
    await finishLog(log, { status: "error", errors: err.message }); throw err;
  }
});

export const runStockSync = webMethod(Permissions.Admin, async () => {
  await fetchAllStock();
  for (let i = 0; i < 15; i++) { const r = await applyStockBatch(); if (r.done) break; }
  return { ok: true };
});
