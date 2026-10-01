import { Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { AnthropicProvider } from './anthropic.provider';
import { LlmError, LlmProvider } from './llm.types';
import { PricingTable } from './pricing';

/** Resolves providers by id. New vendors are added here without touching the runtime. */
@Injectable()
export class LlmRegistry {
  private readonly providers = new Map<string, LlmProvider>();
  readonly pricing: PricingTable;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    this.register(
      new AnthropicProvider({
        apiKey: config.ANTHROPIC_API_KEY,
        baseUrl: config.ANTHROPIC_BASE_URL,
        timeoutMs: config.LLM_REQUEST_TIMEOUT_MS,
      }),
    );
    this.pricing = new PricingTable(config.LLM_PRICING_JSON);
  }

  register(provider: LlmProvider) {
    this.providers.set(provider.id, provider);
  }

  get(id: string): LlmProvider {
    const p = this.providers.get(id);
    if (!p) throw new LlmError('PROVIDER_NOT_CONFIGURED', `Unknown model provider "${id}"`, false);
    if (!p.isConfigured()) {
      throw new LlmError(
        'PROVIDER_NOT_CONFIGURED',
        `${p.displayName} is not configured on this server`,
        false,
      );
    }
    return p;
  }

  get allowedModels(): string[] {
    const list = this.config.LLM_ALLOWED_MODELS;
    return list.length
      ? [...new Set([this.config.LLM_DEFAULT_MODEL, ...list])]
      : [this.config.LLM_DEFAULT_MODEL];
  }

  isModelAllowed(provider: string, model: string): boolean {
    return this.providers.has(provider) && this.allowedModels.includes(model);
  }

  catalog() {
    return {
      defaultProvider: this.config.LLM_DEFAULT_PROVIDER,
      defaultModel: this.config.LLM_DEFAULT_MODEL,
      providers: [...this.providers.values()].map((p) => ({
        id: p.id,
        name: p.displayName,
        configured: p.isConfigured(),
        models: this.allowedModels.map((m) => ({ id: m, pricing: this.pricing.lookup(m) })),
      })),
    };
  }
}
