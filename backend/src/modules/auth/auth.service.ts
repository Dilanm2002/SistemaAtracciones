import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { ILike, Repository } from 'typeorm';
import { AuthUser, Rol, SCOPES_POR_ROL } from '../../common/auth/scopes';
import { CambiarPasswordDto, CreateUsuarioDto, LoginDto, RegisterDto, UpdatePerfilDto, UpdateUsuarioDto, UsuariosQueryDto } from './dto/auth.dto';
import { Usuario } from './entities/usuario.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    private readonly jwt: JwtService,
  ) {}

  toPublic(u: Usuario) {
    const { passwordHash, ...rest } = u as any;
    return { ...rest, scope: SCOPES_POR_ROL[u.rol] };
  }

  private async issueToken(u: Usuario) {
    const payload: AuthUser = { sub: u.id, email: u.email, nombre: u.nombre, rol: u.rol, scope: SCOPES_POR_ROL[u.rol] };
    return {
      access_token: await this.jwt.signAsync(payload),
      token_type: 'Bearer',
      scope: payload.scope.join(' '),
      user: this.toPublic(u),
    };
  }

  async register(dto: RegisterDto) {
    if (await this.usuarios.exist({ where: { email: dto.email } })) {
      throw new ConflictException('Ya existe una cuenta con ese correo. ¿Quieres iniciar sesión?');
    }
    const u = await this.usuarios.save(
      this.usuarios.create({
        nombre: dto.nombre,
        email: dto.email,
        telefono: dto.telefono ?? null,
        passwordHash: await bcrypt.hash(dto.password, 10),
        rol: Rol.CLIENTE,
      }),
    );
    return this.issueToken(u);
  }

  async login(dto: LoginDto) {
    const u = await this.usuarios
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: dto.email })
      .getOne();
    if (!u || !(await bcrypt.compare(dto.password, u.passwordHash))) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }
    if (!u.activo) throw new ForbiddenException('Tu cuenta está desactivada. Contacta al administrador.');
    u.ultimoAcceso = new Date();
    await this.usuarios.update(u.id, { ultimoAcceso: u.ultimoAcceso });
    return this.issueToken(u);
  }

  async me(id: string) {
    const u = await this.usuarios.findOne({ where: { id } });
    if (!u || !u.activo) throw new UnauthorizedException('Tu sesión ya no es válida.');
    return this.toPublic(u);
  }

  async updatePerfil(id: string, dto: UpdatePerfilDto) {
    await this.usuarios.update(id, dto);
    return this.me(id);
  }

  async cambiarPassword(id: string, dto: CambiarPasswordDto) {
    const u = await this.usuarios.createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id }).getOne();
    if (!u || !(await bcrypt.compare(dto.actual, u.passwordHash))) {
      throw new BadRequestException('La contraseña actual no es correcta.');
    }
    await this.usuarios.update(id, { passwordHash: await bcrypt.hash(dto.nueva, 10) });
  }

  // ── Administración de usuarios ──────────────────────────────────────────
  async list(query: UsuariosQueryDto) {
    const where: any[] = [];
    const base: any = query.rol ? { rol: query.rol } : {};
    if (query.q) {
      where.push({ ...base, nombre: ILike(`%${query.q}%`) }, { ...base, email: ILike(`%${query.q}%`) });
    }
    const rows = await this.usuarios.find({ where: where.length ? where : base, order: { createdAt: 'DESC' } });
    return rows.map((u) => this.toPublic(u));
  }

  async create(dto: CreateUsuarioDto) {
    if (await this.usuarios.exist({ where: { email: dto.email } })) throw new ConflictException('Ya existe un usuario con ese correo.');
    const u = await this.usuarios.save(
      this.usuarios.create({
        nombre: dto.nombre,
        email: dto.email,
        telefono: dto.telefono ?? null,
        rol: dto.rol,
        passwordHash: await bcrypt.hash(dto.password, 10),
      }),
    );
    return this.toPublic(u);
  }

  async update(id: string, dto: UpdateUsuarioDto, actorId: string) {
    const u = await this.usuarios.findOne({ where: { id } });
    if (!u) throw new NotFoundException('Usuario no encontrado.');
    if (id === actorId && (dto.activo === false || (dto.rol && dto.rol !== Rol.ADMIN))) {
      throw new BadRequestException('No puedes desactivarte ni quitarte el rol de administrador a ti mismo.');
    }
    const { password, ...rest } = dto;
    Object.assign(u, rest);
    if (password) (u as any).passwordHash = await bcrypt.hash(password, 10);
    await this.usuarios.save(u);
    return this.toPublic(u);
  }
}
