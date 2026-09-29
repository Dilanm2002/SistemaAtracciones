/** Exporta hojas a un .xlsx (SheetJS se carga solo cuando se usa). */
export async function exportXlsx(filename, sheets) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: 'Sin datos en este período' }]);
    const keys = Object.keys(rows[0] ?? { Info: '' });
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(48, Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)) + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}
