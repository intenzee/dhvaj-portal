import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsIn } from 'class-validator';
import { ASSIGNABLE_ROLES, type RoleSlug } from '@hsdg/contracts';

export class SetUserRolesDto {
  @ApiProperty({
    isArray: true,
    enum: ASSIGNABLE_ROLES,
    description:
      'The complete set of roles the user should hold (replaces existing). May be empty.',
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(ASSIGNABLE_ROLES, { each: true })
  roles!: RoleSlug[];
}
