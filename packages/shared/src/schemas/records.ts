import { z } from 'zod';
import { safeText } from './common';

export const ORDER_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
] as const;

export const createCustomerSchema = z.object({
  name: safeText(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});

export const createOrderSchema = z.object({
  orderNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,32}$/, 'Letters, digits and dashes only'),
  customerId: z.uuid(),
  status: z.enum(ORDER_STATUSES).default('PENDING'),
  totalCents: z.number().int().min(0).max(1_000_000_000),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('USD'),
  carrier: z.string().trim().max(60).optional(),
  trackingNumber: z.string().trim().max(80).optional(),
  estimatedDelivery: z.iso.date().optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderStatusSchema = z.object({ status: z.enum(ORDER_STATUSES) });
