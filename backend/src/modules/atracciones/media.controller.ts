import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { DbService } from '../../common/db/db.service';
import { firmaValida, MEDIA_PREFIJO, objetoValido } from '../../common/storage/media';
import { StorageService } from '../../common/storage/storage.service';

/**
 * Fotos del catálogo desde el bucket PRIVADO de Supabase (SEG-008). Solo se entregan:
 *  - las que están en uso (foto de una atracción no eliminada o portada de un destino),
 *    con caché larga en el CDN (los nombres son UUID inmutables);
 *  - o una recién subida con enlace firmado vigente (vista previa antes de guardar), sin caché pública.
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
  raiz(@Param('archivo') archivo: string, @Query('t') t: string | undefined, @Res() res: Response) {
    return this.servir(archivo, t, res);
  }

  @Get(':carpeta/:archivo')
  carpeta(@Param('carpeta') carpeta: string, @Param('archivo') archivo: string, @Query('t') t: string | undefined, @Res() res: Response) {
    return this.servir(`${carpeta}/${archivo}`, t, res);
  }

  private async servir(objeto: string, t: string | undefined, res: Response) {
    if (!objetoValido(objeto)) throw new NotFoundException('La imagen no existe.');
    const ruta = `${MEDIA_PREFIJO}${objeto}`;
    const enUso = await this.db.one(
      `SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM atraccion_foto f JOIN atraccion a ON a.atr_id = f.atr_id
                                     WHERE f.fot_url = $1 AND a.atr_eliminado_en IS NULL)
                        OR EXISTS (SELECT 1 FROM ciudad WHERE ciu_imagen = $1)`,
      [ruta],
    );
    const firmada = !enUso && firmaValida(objeto, t, this.config.getOrThrow<string>('JWT_SECRET'));
    if (!enUso && !firmada) throw new NotFoundException('La imagen no existe.');
    const archivo = await this.storage.leer(objeto);
    if (!archivo) throw new NotFoundException('La imagen no existe.');
    res.setHeader('Content-Type', archivo.tipo);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Cache-Control',
      enUso ? 'public, max-age=86400, s-maxage=31536000, immutable' : 'private, max-age=7200',
    );
    res.send(archivo.cuerpo);
  }
}
