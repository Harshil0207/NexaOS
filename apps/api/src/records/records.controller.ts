import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createCustomerSchema, createOrderSchema, updateOrderStatusSchema } from '@nexa/shared';
import { Org, RequirePermission } from '../common/decorators';
import type { OrgContext } from '../common/request-context';
import { parse } from '../common/validation';
import { listQuery, RecordsService } from './records.service';

@ApiTags('records')
@Controller('records')
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @Get('customers')
  @RequirePermission('records:read')
  customers(@Org() ctx: OrgContext, @Query() q: unknown) {
    return this.records.listCustomers(ctx, parse(listQuery, q));
  }

  @Post('customers')
  @RequirePermission('records:write')
  createCustomer(@Org() ctx: OrgContext, @Body() body: unknown) {
    return this.records.createCustomer(ctx, parse(createCustomerSchema, body));
  }

  @Get('orders')
  @RequirePermission('records:read')
  orders(@Org() ctx: OrgContext, @Query() q: unknown) {
    return this.records.listOrders(ctx, parse(listQuery, q));
  }

  @Post('orders')
  @RequirePermission('records:write')
  createOrder(@Org() ctx: OrgContext, @Body() body: unknown) {
    return this.records.createOrder(ctx, parse(createOrderSchema, body));
  }

  @Patch('orders/:id')
  @HttpCode(200)
  @RequirePermission('records:write')
  async updateOrder(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    await this.records.updateOrderStatus(ctx, id, parse(updateOrderStatusSchema, body).status);
    return { ok: true };
  }

  @Get('tickets')
  @RequirePermission('records:read')
  tickets(@Org() ctx: OrgContext, @Query() q: unknown) {
    return this.records.listTickets(ctx, parse(listQuery, q));
  }
}
