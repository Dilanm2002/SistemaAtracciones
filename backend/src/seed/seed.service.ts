import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { Rol } from '../common/auth/scopes';
import { Usuario } from '../modules/auth/entities/usuario.entity';
import { ReservationStatus } from '../modules/atracciones/dto/reservation.dto';
import { Atraccion } from '../modules/atracciones/entities/atraccion.entity';
import { Categoria } from '../modules/atracciones/entities/categoria.entity';
import { Destino } from '../modules/atracciones/entities/destino.entity';
import { FechaBloqueada } from '../modules/atracciones/entities/fecha-bloqueada.entity';
import { Operador } from '../modules/atracciones/entities/operador.entity';
import { Resena } from '../modules/atracciones/entities/resena.entity';
import { MetodoPago, Reserva } from '../modules/atracciones/entities/reserva.entity';
import { hoyEc, sumarDias } from '../modules/atracciones/utils/fechas';
import { Mensaje } from '../modules/contacto/contacto.module';
import { ATRACCIONES, CATEGORIAS, COMENTARIOS, DESTINOS, MENSAJES, OPERADORES, USUARIOS } from './seed-data';

/** PRNG determinista (mulberry32) para que los datos de demo sean siempre iguales. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Carga datos de demostración la primera vez que arranca la API
 * (solo si la tabla de atracciones está vacía). Desactivar con SEED_ON_START=false.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Seed');

  constructor(private readonly ds: DataSource, private readonly config: ConfigService) {}

  async onApplicationBootstrap() {
    if (this.config.get('SEED_ON_START', 'true') === 'false') return;
    if ((await this.ds.getRepository(Atraccion).count({ withDeleted: true })) > 0) return;
    this.logger.log('Base vacía: cargando datos de demostración…');
    await this.ds.transaction((m) => this.run(m));
    this.logger.log('Datos de demostración listos.');
  }

  private async run(m: import('typeorm').EntityManager) {
    const rnd = prng(2026);
    const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

    const categorias = await m.save(Categoria, CATEGORIAS.map((c) => m.create(Categoria, c)));
    const destinos = await m.save(Destino, DESTINOS.map((d) => m.create(Destino, d)));
    const operadores = await m.save(Operador, OPERADORES.map((o) => m.create(Operador, o)));

    const atracciones = await m.save(
      Atraccion,
      ATRACCIONES.map((a) => {
        const destino = destinos.find((d) => d.codigo === a.destino);
        return m.create(Atraccion, {
          nombre: a.nombre,
          descripcionCorta: a.corta,
          descripcion: a.descripcion,
          ciudad: destino.nombre,
          destino,
          operador: operadores.find((o) => o.codigo === a.operador),
          direccion: a.direccion,
          puntoEncuentro: a.punto,
          latitud: a.lat,
          longitud: a.lng,
          precioTicket: a.precio,
          precioNino: a.precioNino,
          duracionHoras: a.horas,
          tipoProducto: a.tipo,
          categorias: categorias.filter((c) => a.categorias.includes(c.slug)),
          incluye: a.incluye,
          noIncluye: a.noIncluye,
          recomendaciones: a.recomendaciones,
          insignias: a.insignias ?? [],
          idiomas: a.idiomas,
          horarios: a.horarios,
          cupoPorHorario: a.cupo,
          cancelacionGratuita: a.cancelacion ?? true,
          horasCancelacion: a.horasCancelacion ?? 24,
          destacado: a.destacado ?? false,
          fotos: a.fotos,
        });
      }),
    );

    const usuarios = await m.save(
      Usuario,
      await Promise.all(
        USUARIOS.map(async (u) =>
          m.create(Usuario, { nombre: u.nombre, email: u.email, telefono: u.telefono, rol: u.rol as Rol, passwordHash: await bcrypt.hash(u.password, 10) }),
        ),
      ),
    );
    const clientes = usuarios.filter((u) => u.rol === Rol.CLIENTE);
    const maria = clientes.find((u) => u.email === 'cliente@descubre-ec.com');

    // ── Reservas: 45 días atrás hasta 30 días adelante ──────────────────
    const hoy = hoyEc();
    const reservas: Reserva[] = [];
    const usados = new Set<string>();
    const codigo = () => {
      let c: string;
      do c = 'DEC-' + Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rnd() * 32)]).join('');
      while (usados.has(c));
      usados.add(c);
      return c;
    };
    const crear = (a: Atraccion, u: Usuario, fecha: string, estado: ReservationStatus, creadaDiasAntes: number) => {
      const adultos = 1 + Math.floor(rnd() * 3);
      const ninos = rnd() < 0.3 ? 1 + Math.floor(rnd() * 2) : 0;
      const metodo = estado === ReservationStatus.PENDING ? pick([MetodoPago.TRANSFERENCIA, MetodoPago.EN_SITIO]) : pick([MetodoPago.TARJETA, MetodoPago.TARJETA, MetodoPago.TRANSFERENCIA]);
      const precioNino = a.precioNino ?? a.precioTicket;
      const creada = new Date(`${sumarDias(fecha, -creadaDiasAntes)}T${String(8 + Math.floor(rnd() * 12)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00-05:00`);
      reservas.push(
        m.create(Reserva, {
          codigo: codigo(),
          atraccion: a,
          usuarioId: u.id,
          fecha,
          hora: pick(a.horarios),
          adultos,
          ninos,
          ticketCount: adultos + ninos,
          precioAdulto: a.precioTicket,
          precioNino,
          total: adultos * a.precioTicket + ninos * precioNino,
          moneda: 'USD',
          estado,
          metodoPago: metodo,
          clienteNombre: u.nombre,
          clienteEmail: u.email,
          clienteTelefono: u.telefono,
          idempotencyKey: randomUUID(),
          motivoCancelacion: estado === ReservationStatus.CANCELLED ? pick(['Cambio de planes', 'Problemas con el vuelo', 'Enfermedad']) : null,
          canceladaEn: estado === ReservationStatus.CANCELLED ? creada : null,
          createdAt: creada > new Date() ? new Date() : creada,
        }),
      );
    };

    for (let d = -45; d <= 30; d++) {
      const fecha = sumarDias(hoy, d);
      const n = d < 0 ? Math.floor(rnd() * 3) : Math.floor(rnd() * 3) + (d < 7 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const r = rnd();
        const estado = r < 0.1 ? ReservationStatus.CANCELLED : d >= 0 && r < 0.22 ? ReservationStatus.PENDING : ReservationStatus.CONFIRMED;
        // Las reservas futuras se crearon antes de hoy; las pasadas, 1-14 días antes del tour
        const antes = d >= 0 ? d + 1 + Math.floor(rnd() * 10) : 1 + Math.floor(rnd() * 14);
        crear(pick(atracciones), pick(clientes), fecha, estado, antes);
      }
    }
    // Reservas conocidas de la cliente de demo (para probar "Mis reservas" y reseñas)
    const byName = (s: string) => atracciones.find((a) => a.nombre.includes(s));
    crear(byName('Cotopaxi'), maria, sumarDias(hoy, -20), ReservationStatus.CONFIRMED, 10);
    crear(byName('Pailón'), maria, sumarDias(hoy, -5), ReservationStatus.CONFIRMED, 3);
    crear(byName('Mitad del Mundo'), maria, sumarDias(hoy, 6), ReservationStatus.CONFIRMED, 2);
    crear(byName('Kicker'), maria, sumarDias(hoy, 18), ReservationStatus.PENDING, 1);
    await m.save(Reserva, reservas);

    // ── Reseñas ─────────────────────────────────────────────────────────
    const resenas: Resena[] = [];
    for (const a of atracciones) {
      const n = 3 + Math.floor(rnd() * 5);
      const autores = [...clientes].sort(() => rnd() - 0.5).slice(0, Math.min(n, clientes.length)).filter((u) => u.id !== maria.id);
      for (const u of autores) {
        const x = rnd();
        const estrellas = x < 0.62 ? 5 : x < 0.92 ? 4 : 3;
        resenas.push(
          m.create(Resena, {
            atraccion: a,
            usuarioId: u.id,
            autorNombre: u.nombre,
            puntuacion: estrellas,
            comentario: pick(COMENTARIOS[estrellas]),
            visible: true,
            createdAt: new Date(Date.now() - Math.floor(rnd() * 120) * 86400000),
          }),
        );
      }
      const propias = resenas.filter((r) => r.atraccion.id === a.id);
      a.numeroResenas = propias.length;
      a.ratingPromedio = Math.round((propias.reduce((s, r) => s + r.puntuacion, 0) / propias.length) * 100) / 100;
    }
    await m.save(Resena, resenas);
    await m.save(Atraccion, atracciones);

    // ── Fechas bloqueadas y mensajes ────────────────────────────────────
    await m.save(FechaBloqueada, [
      m.create(FechaBloqueada, { atraccion: byName('Cotopaxi'), fecha: sumarDias(hoy, 12), motivo: 'Mantenimiento de senderos del parque' }),
      m.create(FechaBloqueada, { atraccion: byName('Nariz del Diablo'), fecha: `${hoy.slice(0, 4)}-12-25`, motivo: 'Feriado de Navidad' }),
    ].filter((b) => b.fecha >= hoy));
    await m.save(Mensaje, MENSAJES.map((x, i) => m.create(Mensaje, { ...x, leido: i >= 2 })));
  }
}
