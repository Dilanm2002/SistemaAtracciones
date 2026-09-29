import { TransformFnParams } from 'class-transformer';

/** Recorta espacios si el valor es texto (para @Transform). */
export const trim = ({ value }: TransformFnParams): unknown => (typeof value === 'string' ? value.trim() : value);

/** Recorta y pasa a minúsculas (correos). */
export const lower = ({ value }: TransformFnParams): unknown => (typeof value === 'string' ? value.trim().toLowerCase() : value);
