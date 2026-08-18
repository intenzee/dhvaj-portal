import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { OrganisationService } from './organisation.service';
import type { EmployeeFilter, EmployeeRecord } from './organisation.types';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeListQueryDto } from './dto/employee-list-query.dto';

@ApiTags('employees')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly org: OrganisationService) {}

  @Get()
  @RequirePermissions(PERMISSION.employeeRead)
  @ApiOperation({
    summary: 'List employees within the caller’s permitted scope',
    description:
      'RLS-scoped (firm-wide roles see everyone; others see their office). Optional filters.',
  })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: EmployeeListQueryDto,
  ): Promise<Paginated<EmployeeRecord>> {
    const filter: EmployeeFilter = {};
    if (query.status) filter.status = query.status;
    if (query.grade) filter.gradeSlug = query.grade as EmployeeFilter['gradeSlug'];
    if (query.office) filter.officeCode = query.office;
    const result = await this.org.listEmployees(rlsContextFromPrincipal(principal), filter, query);
    return paginate(result, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.employeeRead)
  @ApiOperation({
    summary: 'Get one employee',
    description: 'Returns 404 if outside the caller’s RLS scope (scope is not leaked).',
  })
  async getById(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EmployeeRecord> {
    const employee = await this.org.getEmployeeById(rlsContextFromPrincipal(principal), id);
    if (!employee) throw new NotFoundException('Employee not found.');
    return employee;
  }

  @Get(':id/reports')
  @RequirePermissions(PERMISSION.employeeRead)
  @ApiOperation({
    summary: 'List an employee’s direct reports',
    description: 'Org structure only — reporting lines do not grant data access.',
  })
  reports(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EmployeeRecord[]> {
    return this.org.listDirectReports(rlsContextFromPrincipal(principal), id);
  }

  @Post()
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({ summary: 'Create an employee (audited)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateEmployeeDto,
  ): Promise<EmployeeRecord> {
    return this.org.createEmployee(rlsContextFromPrincipal(principal), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({ summary: 'Update an employee (audited, records before/after)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<EmployeeRecord> {
    return this.org.updateEmployee(rlsContextFromPrincipal(principal), id, dto);
  }
}
