import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

/** Tipos permitidos: la extensión sale del tipo detectado en los bytes, nunca del nombre del archivo. */
const TIPOS: { mime: string; ext: string; firma: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', ext: '.jpg', firma: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: '.png', firma: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: '.webp', firma: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

/** Detecta el tipo real por sus "magic bytes" (auditoría SEG-007). */
export function detectarImagen(buffer: Buffer) {
  return TIPOS.find((t) => t.firma(buffer)) ?? null;
}

/**
 * Guarda imágenes subidas desde el panel.
 * - Con SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY: Supabase Storage (necesario en Vercel,
 *   cuyo sistema de archivos es de solo lectura y efímero).
 * - Sin ellas: carpeta local public/uploads (desarrollo).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger('Storage');
  private readonly url?: string;
  private readonly key?: string;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.url = config.get<string>('SUPABASE_URL')?.replace(/\/$/, '');
    this.key = config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.bucket = config.get<string>('SUPABASE_BUCKET', 'uploads');
  }

  /** Devuelve una ruta relativa (/uploads/x.jpg) o una URL absoluta pública. */
  async save(file: { buffer: Buffer; mimetype: string; originalname: string }): Promise<string> {
    const tipo = detectarImagen(file.buffer);
    if (!tipo) throw new BadRequestException('El archivo no es una imagen JPG, PNG o WebP válida.');
    const name = `${randomUUID()}${tipo.ext}`;

    if (this.url && this.key) {
      const res = await fetch(`${this.url}/storage/v1/object/${this.bucket}/${name}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.key}`, apikey: this.key, 'Content-Type': tipo.mime, 'x-upsert': 'false' },
        body: new Uint8Array(file.buffer),
      });
      if (!res.ok) {
        this.logger.error(`Supabase Storage ${res.status}: ${await res.text()}`);
        throw new InternalServerErrorException('No se pudo guardar la imagen. Intenta de nuevo.');
      }
      return `${this.url}/storage/v1/object/public/${this.bucket}/${name}`;
    }

    const dir = join(process.cwd(), 'public', 'uploads');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), file.buffer);
    return `/uploads/${name}`;
  }
}
