/** USD per million tokens. Estimates for cost tracking; override via LLM_PRICING_JSON. */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  'claude-sonnet-4-5': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-sonnet-4': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-opus-4-1': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-3-5-haiku': { inputPerMTok: 0.8, outputPerMTok: 4 },
};

export class PricingTable {
  private readonly prices: Record<string, ModelPrice>;

  constructor(overridesJson?: string) {
    let overrides: Record<string, ModelPrice> = {};
    if (overridesJson) {
      const parsed = JSON.parse(overridesJson) as Record<string, ModelPrice>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v?.inputPerMTok !== 'number' || typeof v?.outputPerMTok !== 'number') {
          throw new Error(`LLM_PRICING_JSON: invalid entry for ${k}`);
        }
      }
      overrides = parsed;
    }
    this.prices = { ...DEFAULT_PRICES, ...overrides };
  }

  /** Resolves dated model ids (e.g. claude-haiku-4-5-20251001) to their family price. */
  lookup(model: string): ModelPrice | null {
    if (this.prices[model]) return this.prices[model]!;
    const key = Object.keys(this.prices)
      .filter((k) => model.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    return key ? this.prices[key]! : null;
  }

  /** Cost in micro-dollars (1e-6 USD), or null when the model has no known price. */
  costMicros(model: string, inputTokens: number, outputTokens: number): number | null {
    const p = this.lookup(model);
    if (!p) return null;
    return Math.round(inputTokens * p.inputPerMTok + outputTokens * p.outputPerMTok);
  }
}
