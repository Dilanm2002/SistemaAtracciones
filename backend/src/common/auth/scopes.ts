/**
 * Scopes OAuth2 declarados en contracts/atracciones-openapi.yaml.
 * El token JWT emitido por /auth/login los incluye en el claim `scope`,
 * de modo que al migrar a un Authorization Server real (API Gateway)
 * los controladores no necesitan cambiar.
 */
export const SCOPES = {
  READ: 'attractions:read',
  BOOK: 'attractions:book',
  CANCEL: 'attractions:cancel',
  WRITE: 'attractions:write',
  /** Gestión operativa de reservas de todos los clientes (operadores y admin) */
  MANAGE: 'attractions:manage',
  /** Administración de usuarios, reportes y mensajes */
  ADMIN: 'admin:full',
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

/** Roles de la tabla `rol`. Un usuario puede tener varios (tabla puente usuario_rol). */
export enum Rol {
  ADMIN = 'ADMIN',
  OPERADOR = 'OPERADOR',
  CLIENTE = 'CLIENTE',
}

export const SCOPES_POR_ROL: Record<Rol, Scope[]> = {
  [Rol.CLIENTE]: [SCOPES.READ, SCOPES.BOOK, SCOPES.CANCEL],
  // El operador mantiene el inventario de SU empresa (attractions:write): lo que crea queda
  // EN_REVISION hasta que el administrador lo aprueba. Los catálogos globales exigen admin:full.
  [Rol.OPERADOR]: [SCOPES.READ, SCOPES.BOOK, SCOPES.CANCEL, SCOPES.MANAGE, SCOPES.WRITE],
  [Rol.ADMIN]: [SCOPES.READ, SCOPES.BOOK, SCOPES.CANCEL, SCOPES.MANAGE, SCOPES.WRITE, SCOPES.ADMIN],
};

const PRIORIDAD: Rol[] = [Rol.ADMIN, Rol.OPERADOR, Rol.CLIENTE];

/** Rol principal (el de más privilegios) de un conjunto de roles. */
export const rolPrincipal = (roles: string[]): Rol => PRIORIDAD.find((r) => roles.includes(r)) ?? Rol.CLIENTE;

/**
 * Unión de los scopes de todos los roles del usuario. Una cuenta sin ningún rol válido es un
 * cliente común (igual que en rolPrincipal): recibe los permisos de CLIENTE (reservar y cancelar).
 */
export const scopesDe = (roles: string[]): Scope[] => {
  const validos = roles.filter((r): r is Rol => r in SCOPES_POR_ROL);
  return [...new Set((validos.length ? validos : [Rol.CLIENTE]).flatMap((r) => SCOPES_POR_ROL[r]))];
};

export interface AuthUser {
  /** usu_id (BIGINT como texto) */
  sub: string;
  /** Token ligado a la llave del navegador (DPoP, RFC 9449): huella de la llave pública */
  cnf?: { jkt: string };
  email: string;
  nombre: string;
  rol: Rol;
  roles?: Rol[];
  scope: Scope[];
  /** ope_codigo de la empresa operadora del usuario (null = ninguna) */
  operador?: number | null;
  /** ses_id de la sesión (tabla `sesion`): permite revocar el token */
  jti?: string;
}

export const esAdmin = (u: AuthUser) => u.scope.includes(SCOPES.ADMIN);
