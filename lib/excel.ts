import * as XLSX from 'xlsx';

export function sheetToJson<T = Record<string, any>>(buffer: ArrayBuffer): T[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const first = wb.SheetNames[0];
  const ws = wb.Sheets[first];
  const rows = XLSX.utils.sheet_to_json<T>(ws, { defval: "" });
  return rows;
}

export function chunk<T>(arr: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
