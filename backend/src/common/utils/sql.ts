/** Escapa los comodines de LIKE/ILIKE (\, % y _) para que el texto del usuario se busque literal. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
