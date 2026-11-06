import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { DbService } from '../../common/db/db.service';
import { firmaValida, MEDIA_PREFIJO, objetoValido, variante } from '../../common/storage/media';
import { StorageService } from '../../common/storage/storage.service';

/**
 * Fotos del catálogo desde el bucket PRIVADO de Supabase (SEG-008). Solo se entregan:
 *  - las que están en uso (foto de una atracción no eliminada o portada de un destino),
 *    con caché larga en el CDN (los nombres son UUID inmutables);
 *  - o una recién subida con enlace firmado vigente (vista previa antes de guardar), sin caché pública.
 * `?w=480|960` entrega una variante WebP más liviana para tarjetas y celulares (MOV-002).
 * Cualquier otro objeto del bucket (subidas abandonadas, pruebas) responde 404.
 */
@ApiExcludeController()
@Controller('media')
export class MediaController {
  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  @Get(':archivo')
  raiz(@Param('archivo') archivo: string, @Query('t') t: string | undefined, @Query('w') w: string | undefined, @Res() res: Response) {
    return this.servir(archivo, t, w, res);
  }

  @Get(':carpeta/:archivo')
  carpeta(
    @Param('carpeta') carpeta: string,
    @Param('archivo') archivo: string,
    @Query('t') t: string | undefined,
    @Query('w') w: string | undefined,
    @Res() res: Response,
  ) {
    return this.servir(`${carpeta}/${archivo}`, t, w, res);
  }

  private async servir(objeto: string, t: string | undefined, w: string | undefined, res: Response) {
    if (!objetoValido(objeto)) throw new NotFoundException('La imagen no existe.');
    const ruta = `${MEDIA_PREFIJO}${objeto}`;
    const enUso = await this.db.one(
      `SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM atraccion_foto f JOIN atraccion a ON a.atr_id = f.atr_id
                                     WHERE f.fot_url = $1 AND a.atr_eliminado_en IS NULL)
                        OR EXISTS (SELECT 1 FROM ciudad WHERE ciu_imagen = $1)`,
      [ruta],
    );
    const usada = enUso ?? (await this.enUsoEnMicroservicios(ruta));
    const firmada = !usada && firmaValida(objeto, t, this.config.getOrThrow<string>('JWT_SECRET'));
    if (!usada && !firmada) throw new NotFoundException('La imagen no existe.');
    const archivo = await this.storage.leer(objeto);
    if (!archivo) throw new NotFoundException('La imagen no existe.');
    const reducida = w ? await variante(archivo.cuerpo, Number(w)) : null;
    res.setHeader('Content-Type', reducida ? 'image/webp' : archivo.tipo);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Cache-Control',
      usada ? 'public, max-age=86400, s-maxage=31536000, immutable' : 'private, max-age=7200',
    );
    res.send(reducida ?? archivo.cuerpo);
  }

  /**
   * Las atracciones que se crean en el panel viven en el microservicio de catálogo (schema ms_catalog de la
   * misma base), que guarda la URL de la foto completa o relativa. Solo se lee: sin ese schema (p. ej. en
   * local) la foto se trata como no usada.
   */
  private async enUsoEnMicroservicios(ruta: string): Promise<boolean> {
    try {
      const r = await this.db.one(
        `SELECT 1 AS ok FROM ms_catalog.atraccion_foto f JOIN ms_catalog.atraccion a ON a.atr_id = f.atr_id
          WHERE (f.fot_url = $1 OR right(f.fot_url, length($1)) = $1) AND a.atr_eliminado_en IS NULL LIMIT 1`,
        [ruta],
      );
      return !!r;
    } catch {
      return false;
    }
  }
}
