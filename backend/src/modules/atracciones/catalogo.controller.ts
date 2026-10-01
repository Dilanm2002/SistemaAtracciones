import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser, Scopes } from '../../common/auth/auth.decorators';
import { StorageService } from '../../common/storage/storage.service';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
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

const verTodo = (q: CatalogoQueryDto, u?: AuthUser) => q.all === 'true' && !!u?.scope?.includes(SCOPES.ADMIN);

@ApiTags('Atracciones - Catálogo auxiliar')
@Controller()
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  // ── Geografía e idiomas ───────────────────────────────────────────────
  @Get('provincias')
  @ApiOperation({ summary: 'Provincias del Ecuador con su región (tabla provincia)' })
  listProvincias() {
    return this.catalogo.listProvincias();
  }

  @Get('idiomas')
  @ApiOperation({ summary: 'Idiomas en que se pueden ofrecer las atracciones (tabla idioma)' })
  listIdiomas() {
    return this.catalogo.listIdiomas();
  }

  // ── Categorías ────────────────────────────────────────────────────────
  @Get('categorias')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Listar categorías (activas; ?all=true con attractions:write)' })
  listCategorias(@Query() q: CatalogoQueryDto, @CurrentUser() u?: AuthUser) {
    return this.catalogo.listCategorias(verTodo(q, u));
  }

  @Post('categorias')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  createCategoria(@Body() dto: CreateCategoriaDto, @CurrentUser() u: AuthUser) {
    return this.catalogo.createCategoria(dto, u);
  }

  @Patch('categorias/:id')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  updateCategoria(@Param('id', ParseIdPipe) id: string, @Body() dto: UpdateCategoriaDto, @CurrentUser() u: AuthUser) {
    return this.catalogo.updateCategoria(id, dto, u);
  }

  @Delete('categorias/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  deleteCategoria(@Param('id', ParseIdPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.catalogo.deleteCategoria(id, u);
  }

  // ── Destinos ──────────────────────────────────────────────────────────
  @Get('destinos')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Listar destinos (tabla ciudad; `codigo` = ciu_id = city del contrato). Públicamente solo los que tienen atracciones' })
  listDestinos(@Query() q: CatalogoQueryDto, @CurrentUser() u?: AuthUser) {
    return this.catalogo.listDestinos(verTodo(q, u));
  }

  @Post('destinos')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  createDestino(@Body() dto: CreateDestinoDto, @CurrentUser() u: AuthUser) {
    return this.catalogo.createDestino(dto, u);
  }

  @Patch('destinos/:id')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  updateDestino(@Param('id', ParseIdPipe) id: string, @Body() dto: UpdateDestinoDto, @CurrentUser() u: AuthUser) {
    return this.catalogo.updateDestino(id, dto, u);
  }

  @Delete('destinos/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  deleteDestino(@Param('id', ParseIdPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.catalogo.deleteDestino(id, u);
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
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  createOperador(@Body() dto: CreateOperadorDto, @CurrentUser() u: AuthUser) {
    return this.catalogo.createOperador(dto, u);
  }

  @Patch('operadores/:id')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  updateOperador(@Param('id', ParseIdPipe) id: string, @Body() dto: UpdateOperadorDto, @CurrentUser() u: AuthUser) {
    return this.catalogo.updateOperador(id, dto, u);
  }

  @Delete('operadores/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  deleteOperador(@Param('id', ParseIdPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.catalogo.deleteOperador(id, u);
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
  @Scopes(SCOPES.ADMIN)
  @ApiOperation({ summary: 'Todas las reseñas (moderación)' })
  listResenas(@Query() q: ResenasQueryDto) {
    return this.resenas.listAdmin(q);
  }

  @Patch('resenas/:id')
  @Scopes(SCOPES.ADMIN)
  @ApiOperation({ summary: 'Mostrar u ocultar una reseña' })
  moderar(@Param('id', ParseIdPipe) id: string, @Body() dto: ModerarResenaDto, @CurrentUser() u: AuthUser) {
    return this.resenas.moderar(id, dto.visible, u);
  }

  @Delete('resenas/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Scopes(SCOPES.ADMIN)
  deleteResena(@Param('id', ParseIdPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.resenas.remove(id, u);
  }

  // ── Reportes ──────────────────────────────────────────────────────────
  @Get('reportes/dashboard')
  @Scopes(SCOPES.MANAGE)
  @ApiOperation({ summary: 'KPIs del panel de administración' })
  dashboard(@CurrentUser() user: AuthUser) {
    return this.reportes.dashboard(user);
  }

  @Get('reportes/ventas')
  @Scopes(SCOPES.ADMIN)
  @ApiOperation({ summary: 'Reporte de ventas por rango (from/to en AAAA-MM-DD, por defecto últimos 30 días)' })
  ventas(@Query('from') from?: string, @Query('to') to?: string) {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const hasta = to ?? hoyEc();
    const desde = from ?? sumarDias(hasta, -29);
    if (!re.test(desde) || !re.test(hasta) || Number.isNaN(Date.parse(desde)) || Number.isNaN(Date.parse(hasta))) {
      throw new BadRequestException('from y to deben ser fechas válidas con formato AAAA-MM-DD.');
    }
    if (hasta > hoyEc()) throw new BadRequestException('"to" no puede ser una fecha futura.');
    if (Date.parse(hasta) - Date.parse(desde) > 366 * 86400000) throw new BadRequestException('El rango máximo del reporte es de un año.');
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
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } }) // 30 imágenes por hora
  @ApiResponse({ status: 400, description: 'El archivo no es una imagen JPG, PNG o WebP válida.' })
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
  async upload(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Adjunta una imagen en el campo "file".');
    const path = await this.storage.save(file);
    return { path, url: this.mapper.absUrl(path) };
  }
}
