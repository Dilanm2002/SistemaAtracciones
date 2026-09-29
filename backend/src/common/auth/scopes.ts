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

export enum Rol {
  ADMIN = 'ADMIN',
  OPERADOR = 'OPERADOR',
  CLIENTE = 'CLIENTE',
}

export const SCOPES_POR_ROL: Record<Rol, Scope[]> = {
  [Rol.CLIENTE]: [SCOPES.READ, SCOPES.BOOK, SCOPES.CANCEL],
  [Rol.OPERADOR]: [SCOPES.READ, SCOPES.BOOK, SCOPES.CANCEL, SCOPES.MANAGE],
  [Rol.ADMIN]: [SCOPES.READ, SCOPES.BOOK, SCOPES.CANCEL, SCOPES.MANAGE, SCOPES.WRITE, SCOPES.ADMIN],
};

export interface AuthUser {
  sub: string;
  email: string;
  nombre: string;
  rol: Rol;
  scope: Scope[];
}
