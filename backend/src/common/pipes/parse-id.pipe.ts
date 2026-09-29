import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** Valida un identificador numérico del modelo (PK BIGINT/INTEGER) y lo devuelve como texto. */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[1-9]\d{0,17}$/.test(value ?? '')) throw new BadRequestException('El identificador debe ser un número entero positivo.');
    return value;
  }
}
