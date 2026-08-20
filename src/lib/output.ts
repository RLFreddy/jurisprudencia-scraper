// lib/output — persistence into files/page-N/. The only filesystem layer.

import fs from "node:fs";
import AdmZip from "adm-zip";
import type { Resolution } from "../types";

const CSV_HEADER =
  "recurso,nroExpediente,pretension,tipoResolucion,fechaResolucion,sala,normaDI,sumilla,palabrasClave,uuid,urlDescarga";

// Creates the page folder and writes metadata.csv with the resolutions.
export function writeMetadata(dir: string, resolutions: Resolution[]): void {
  fs.mkdirSync(dir, { recursive: true });
  if (!resolutions.length) return;
  const rows = resolutions.map((r) =>
    Object.values(r).map((v) => `"${v.replace(/"/g, '""')}"`).join(","),
  );
  fs.writeFileSync(`${dir}/metadata.csv`, [CSV_HEADER, ...rows].join("\n"));
}

// Extracts the ZIP into the page folder and deletes it. Fails if the expected
// number of PDFs is missing (corrupt page → it's retried, the ZIP stays).
export function extractPdfs(dir: string, zip: Buffer, expectedCount: number): void {
  fs.mkdirSync(dir, { recursive: true });
  const archive = new AdmZip(zip);
  archive.extractAllTo(dir, true);
  const pdfs = fs.readdirSync(dir).filter((f) => f.endsWith(".pdf"));
  if (pdfs.length !== expectedCount) {
    throw new Error(
      `incomplete extraction: ${pdfs.length}/${expectedCount} PDFs in ${dir}`,
    );
  }
  fs.rmSync(`${dir}/descarga.zip`, { force: true });
}