import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser, Scopes } from '../../common/auth/auth.decorators';
import { StorageService } from '../../common/storage/storage.service';
import { JwtAuthGuard, OptionalJwtGuard } from '../../common/auth/jwt-auth.guard';
import { AuthUser, SCOPES } from '../../common/auth/scopes';
import { AtraccionMapper } from './atraccion.mapper';
import { CatalogoService } from './catalogo.service';
import {
  CatalogoQueryDto,
  CreateCategoriaDto,
  CreateDestinoDto,
  CreateOperadorDto,
  UpdateCategoriaDto,
  UpdateDestinoDto,
  UpdateOperadorDto,
} from './dto/catalogo.dto';
import { ModerarResenaDto, ResenasQueryDto } from './dto/resena.dto';
import { ReportesService } from './reportes.service';
import { ResenasService } from './resenas.service';
import { hoyEc, sumarDias } from './utils/fechas';

const verTodo = (q: CatalogoQueryDto, u?: AuthUser) => q.all === 'true' && !!u?.scope?.includes(SCOPES.WRITE);

@ApiTags('Atracciones - Catálogo auxiliar')
@Controller()
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  // ── Categorías ────────────────────────────────────────────────────────
  @Get('categorias')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Listar categorías (activas; ?all=true con attractions:write)' })
  listCategorias(@Query() q: CatalogoQueryDto, @CurrentUser() u?: AuthUser) {
    return this.catalogo.listCategorias(verTodo(q, u));
  }

  @Post('categorias')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.WRITE)
  @ApiBearerAuth()
  createCategoria(@Body() dto: CreateCategoriaDto) {
    return this.catalogo.createCategoria(dto);
  }

  @Patch('categorias/:id')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.WRITE)
  @ApiBearerAuth()
  updateCategoria(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoriaDto) {
    return this.catalogo.updateCategoria(id, dto);
  }

  @Delete('categorias/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.WRITE)
  @ApiBearerAuth()
  deleteCategoria(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogo.deleteCategoria(id);
  }

  // ── Destinos ──────────────────────────────────────────────────────────
  @Get('destinos')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Listar destinos/ciudades (el `codigo` es el city ID del contrato)' })
  listDestinos(@Query() q: CatalogoQueryDto, @CurrentUser() u?: AuthUser) {
    return this.catalogo.listDestinos(verTodo(q, u));
  }

  @Post('destinos')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.WRITE)
  @ApiBearerAuth()
  createDestino(@Body() dto: CreateDestinoDto) {
    return this.catalogo.createDestino(dto);
  }

  @Patch('destinos/:id')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.WRITE)
  @ApiBearerAuth()
  updateDestino(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDestinoDto) {
    return this.catalogo.updateDestino(id, dto);
  }

  @Delete('destinos/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.WRITE)
  @ApiBearerAuth()
  deleteDestino(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogo.deleteDestino(id);
  }

  // ── Operadores ────────────────────────────────────────────────────────
  @Get('operadores')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Listar empresas operadoras' })
  listOperadores(@Query() q: CatalogoQueryDto, @CurrentUser() u?: AuthUser) {
    return this.catalogo.listOperadores(verTodo(q, u));
  }

  @Post('operadores')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.WRITE)
  @ApiBearerAuth()
  createOperador(@Body() dto: CreateOperadorDto) {
    return this.catalogo.createOperador(dto);
  }

  @Patch('operadores/:id')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.WRITE)
  @ApiBearerAuth()
  updateOperador(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOperadorDto) {
    return this.catalogo.updateOperador(id, dto);
  }

  @Delete('operadores/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.WRITE)
  @ApiBearerAuth()
  deleteOperador(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogo.deleteOperador(id);
  }
}

@ApiTags('Atracciones - Administración')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AdminAtraccionesController {
  constructor(
    private readonly resenas: ResenasService,
    private readonly reportes: ReportesService,
    private readonly mapper: AtraccionMapper,
    private readonly storage: StorageService,
  ) {}

  // ── Moderación de reseñas ─────────────────────────────────────────────
  @Get('resenas')
  @Scopes(SCOPES.WRITE)
  @ApiOperation({ summary: 'Todas las reseñas (moderación)' })
  listResenas(@Query() q: ResenasQueryDto) {
    return this.resenas.listAdmin(q);
  }

  @Patch('resenas/:id')
  @Scopes(SCOPES.WRITE)
  @ApiOperation({ summary: 'Mostrar u ocultar una reseña' })
  moderar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerarResenaDto) {
    return this.resenas.moderar(id, dto.visible);
  }

  @Delete('resenas/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Scopes(SCOPES.WRITE)
  deleteResena(@Param('id', ParseUUIDPipe) id: string) {
    return this.resenas.remove(id);
  }

  // ── Reportes ──────────────────────────────────────────────────────────
  @Get('reportes/dashboard')
  @Scopes(SCOPES.MANAGE)
  @ApiOperation({ summary: 'KPIs del panel de administración' })
  dashboard() {
    return this.reportes.dashboard();
  }

  @Get('reportes/ventas')
  @Scopes(SCOPES.ADMIN)
  @ApiOperation({ summary: 'Reporte de ventas por rango (from/to en AAAA-MM-DD, por defecto últimos 30 días)' })
  ventas(@Query('from') from?: string, @Query('to') to?: string) {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const hasta = to ?? hoyEc();
    const desde = from ?? sumarDias(hasta, -29);
    if (!re.test(desde) || !re.test(hasta)) throw new BadRequestException('from y to deben tener formato AAAA-MM-DD.');
    return this.reportes.ventas(desde, hasta);
  }

  @Get('reportes/clientes')
  @Scopes(SCOPES.ADMIN)
  @ApiOperation({ summary: 'Clientes con su historial de compras' })
  clientes() {
    return this.reportes.clientes();
  }

  // ── Subida de imágenes ────────────────────────────────────────────────
  @Post('uploads')
  @Scopes(SCOPES.WRITE)
  @ApiOperation({ summary: 'Subir una imagen (JPG, PNG o WebP, máx. 4 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 4 * 1024 * 1024 },
      fileFilter: (_, file, cb) =>
        /^image\/(jpeg|png|webp)$/.test(file.mimetype)
          ? cb(null, true)
          : cb(new BadRequestException('Solo se permiten imágenes JPG, PNG o WebP.'), false),
    }),
  )
  async upload(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('Adjunta una imagen en el campo "file".');
    const path = await this.storage.save(file);
    return { path, url: this.mapper.absUrl(path) };
  }
}
