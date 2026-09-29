export const API_PREFIX = '/api/v1';

export interface Link {
  href: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
}

export const link = (path: string, method: Link['method'] = 'GET'): Link => ({ href: `${API_PREFIX}${path}`, method });

/** Construye la respuesta paginada estándar de la plantilla (PaginatedResponseDto). */
export function paginate<T>(data: T[], totalItems: number, page: number, limit: number, basePath: string, extraQuery = '') {
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const q = (p: number) => `${API_PREFIX}${basePath}?page=${p}&limit=${limit}${extraQuery}`;
  return {
    data,
    meta: { totalItems, itemCount: data.length, itemsPerPage: limit, totalPages, currentPage: page },
    _links: {
      first: q(1),
      ...(page > 1 ? { previous: q(page - 1) } : {}),
      ...(page < totalPages ? { next: q(page + 1) } : {}),
      last: q(totalPages),
    },
  };
}
