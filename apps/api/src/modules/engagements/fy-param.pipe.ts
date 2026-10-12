import { BadRequestException, type PipeTransform } from '@nestjs/common';

/** A financial-year path segment: 2026-27. */
export const FyParamPipe: PipeTransform<string, string> = {
  transform(value: string): string {
    if (!/^[0-9]{4}-[0-9]{2}$/.test(value)) {
      throw new BadRequestException('The financial year must look like 2026-27.');
    }
    return value;
  },
};
