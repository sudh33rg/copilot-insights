export interface ModelPrice {
  id: string;
  name: string | null;
  inputPrice: number;
  outputPrice: number;
  cacheReadPrice: number | null;
  /** Tokens the catalog prices refer to (the price is per `batchSize` tokens). */
  batchSize: number;
}

export interface TokenUse {
  input: number;
  output: number;
  cached: number;
}

/** List-price cost of `use` on `price`: uncached input, cached input and output, per batch of tokens. */
export function listCost(use: TokenUse, price: ModelPrice): number {
  const cached = Math.min(Math.max(use.cached, 0), use.input);
  const cacheRead = price.cacheReadPrice ?? price.inputPrice;
  return (
    ((use.input - cached) * price.inputPrice + cached * cacheRead + use.output * price.outputPrice) /
    price.batchSize
  );
}

const MAX_ALTERNATIVES = 4;

/**
 * The same exact tokens priced on other catalog models, relative to the list cost of the models that actually ran
 * (D-P5-3: a relative list-price index, never a credit figure). Only cheaper models the session did not use appear.
 */
export function priceCounterfactual(input: {
  turns: readonly {
    modelId: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cachedTokens: number | null;
  }[];
  prices: readonly ModelPrice[];
}): { model: string; name: string | null; relativeCost: number }[] {
  const priced = input.prices.filter(
    (price) => price.inputPrice > 0 && price.outputPrice > 0 && price.batchSize > 0,
  );
  const byId = new Map(priced.map((price) => [price.id.toLowerCase(), price]));
  const uses: { use: TokenUse; price: ModelPrice }[] = [];
  for (const turn of input.turns) {
    const price = turn.modelId === null ? undefined : byId.get(turn.modelId.toLowerCase());
    if (price === undefined || turn.inputTokens === null || turn.outputTokens === null) continue;
    uses.push({
      use: { input: turn.inputTokens, output: turn.outputTokens, cached: turn.cachedTokens ?? 0 },
      price,
    });
  }
  const actual = uses.reduce((sum, entry) => sum + listCost(entry.use, entry.price), 0);
  if (actual <= 0) return [];
  const used = new Set(uses.map((entry) => entry.price.id.toLowerCase()));
  return priced
    .filter((price) => !used.has(price.id.toLowerCase()))
    .map((price) => ({
      model: price.id,
      name: price.name,
      relativeCost: uses.reduce((sum, entry) => sum + listCost(entry.use, price), 0) / actual,
    }))
    .filter((row) => row.relativeCost < 1)
    .sort((a, b) => a.relativeCost - b.relativeCost)
    .slice(0, MAX_ALTERNATIVES);
}
