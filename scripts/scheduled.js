import { runCatalogBatch } from "backend/catalogSync.web.js";
import { fetchAllStock, applyStockBatch } from "backend/stockSync.web.js";

export function nightlyCatalog() { return runCatalogBatch(); }
export function hourlyCatalogContinue() { return runCatalogBatch(); }
export async function hourlyStock() {
  await fetchAllStock();
  for (let i = 0; i < 15; i++) { const r = await applyStockBatch(); if (r.done) break; }
}
