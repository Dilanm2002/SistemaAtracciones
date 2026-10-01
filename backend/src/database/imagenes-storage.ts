import { existsSync, readFileSync } from 'fs';
import { basename, extname, join } from 'path';

type Consulta = (sql: string, params?: unknown[]) => Promise<unknown>;

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/** Columnas del modelo que guardan la URL de una imagen. */
const COLUMNAS = [
  { tabla: 'atraccion_foto', columna: 'fot_url' },
  { tabla: 'ciudad', columna: 'ciu_imagen' },
];

export interface OpcionesStorage {
  url?: string;
  key?: string;
  bucket?: string;
  dir?: string;
  log?: (m: string) => void;
}

/**
 * Lleva las fotos del catálogo a Supabase Storage (igual que Sal y Canela: el archivo va al
 * bucket y la tabla guarda su URL pública). Busca en la base las rutas locales "/img/…",
 * sube cada archivo a `<bucket>/catalogo/<nombre>` y reemplaza la ruta por la URL de Storage.
 * Es idempotente: si ya no quedan rutas "/img/…" no hace nada. Sin credenciales de Supabase
 * (desarrollo local) deja las rutas como están.
 */
export async function moverImagenesAStorage(query: Consulta, opciones: OpcionesStorage = {}): Promise<number> {
  const url = (opciones.url ?? process.env.SUPABASE_URL)?.replace(/\/$/, '');
  const key = opciones.key ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = opciones.bucket ?? process.env.SUPABASE_BUCKET ?? 'uploads';
  const dir = opciones.dir ?? join(process.cwd(), 'public', 'img');
  const log = opciones.log ?? (() => undefined);
  if (!url || !key) {
    log('Imágenes: sin SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, se sirven desde /img.');
    return 0;
  }

  const union = COLUMNAS.map((c) => `SELECT ${c.columna} AS url FROM ${c.tabla} WHERE ${c.columna} LIKE '/img/%'`).join(' UNION ');
  const filas = (await query(`SELECT DISTINCT url FROM (${union}) x`)) as { url: string }[];
  let movidas = 0;
  for (const { url: ruta } of filas) {
    const nombre = basename(ruta);
    const archivo = join(dir, nombre);
    const mime = MIME[extname(nombre).toLowerCase()];
    if (!mime || !existsSync(archivo)) {
      log(`Imágenes: no se encontró ${archivo}, se deja ${ruta}.`);
      continue;
    }
    const objeto = `catalogo/${nombre}`;
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${objeto}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': mime, 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' },
      body: new Uint8Array(readFileSync(archivo)),
    });
    if (!res.ok) throw new Error(`Supabase Storage ${res.status} al subir ${objeto}: ${await res.text()}`);
    const publica = `${url}/storage/v1/object/public/${bucket}/${objeto}`;
    for (const c of COLUMNAS) await query(`UPDATE ${c.tabla} SET ${c.columna} = $1 WHERE ${c.columna} = $2`, [publica, ruta]);
    movidas++;
  }
  log(movidas ? `Imágenes: ${movidas} foto(s) del catálogo subidas a Supabase Storage (${bucket}/catalogo).` : 'Imágenes: el catálogo ya está en Supabase Storage.');
  return movidas;
}

/**
 * Endurece el bucket (SEG-008): lectura pública solo porque son fotos del catálogo que cualquier
 * visitante debe ver (igual que Sal y Canela), pero Supabase rechaza en el propio bucket todo lo
 * que no sea JPG/PNG/WebP de hasta 4 MB. Escribir sigue siendo posible únicamente desde la API.
 */
export async function configurarBucket(opciones: OpcionesStorage = {}): Promise<boolean> {
  const url = (opciones.url ?? process.env.SUPABASE_URL)?.replace(/\/$/, '');
  const key = opciones.key ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = opciones.bucket ?? process.env.SUPABASE_BUCKET ?? 'uploads';
  if (!url || !key) return false;
  const res = await fetch(`${url}/storage/v1/bucket/${bucket}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ public: true, file_size_limit: 4 * 1024 * 1024, allowed_mime_types: Object.values(MIME).filter((m, i, a) => a.indexOf(m) === i) }),
  });
  if (!res.ok) throw new Error(`Supabase Storage ${res.status} al configurar el bucket ${bucket}: ${await res.text()}`);
  opciones.log?.(`Imágenes: bucket ${bucket} limitado a JPG/PNG/WebP de hasta 4 MB.`);
  return true;
}
