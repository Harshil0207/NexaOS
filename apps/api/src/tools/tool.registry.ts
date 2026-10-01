import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { sendCustomerEmailTool } from './builtin/email.tool';
import { httpRequestTool } from './builtin/http.tool';
import { getOrderTool, searchOrdersTool } from './builtin/orders.tools';
import { createSupportTicketTool } from './builtin/tickets.tools';
import type { ToolDefinition } from './tool.types';

export const BUILTIN_TOOLS: ToolDefinition[] = [
  getOrderTool,
  searchOrdersTool,
  createSupportTicketTool,
  httpRequestTool,
  sendCustomerEmailTool,
];

/** Generic registry: the runtime only depends on ToolDefinition, so tools are added by registration. */
@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor() {
    for (const t of BUILTIN_TOOLS) this.register(t);
  }

  register(tool: ToolDefinition) {
    if (this.tools.has(tool.key)) throw new Error(`Duplicate tool key ${tool.key}`);
    this.tools.set(tool.key, tool);
  }

  get(key: string): ToolDefinition | undefined {
    return this.tools.get(key);
  }

  has(key: string): boolean {
    return this.tools.has(key);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** JSON Schema for the model-facing input definition. */
  inputJsonSchema(tool: ToolDefinition): Record<string, unknown> {
    const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >;
    delete schema.$schema;
    return schema;
  }
}
