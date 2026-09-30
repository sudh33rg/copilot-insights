import { describe, expect, it } from 'vitest';
import { listCost, priceCounterfactual, type ModelPrice } from './priceCounterfactual';

const price = (
  id: string,
  inputPrice: number,
  outputPrice: number,
  cacheReadPrice: number | null = null,
): ModelPrice => ({
  id,
  name: id.toUpperCase(),
  inputPrice,
  outputPrice,
  cacheReadPrice,
  batchSize: 1000,
});
const A = price('a', 10, 30, 1);
const B = price('b', 1, 3, 0.1);
const C = price('c', 20, 60, 2);
const turn = (
  modelId: string | null,
  input: number | null,
  output: number | null,
  cached: number | null = null,
) => ({
  modelId,
  inputTokens: input,
  outputTokens: output,
  cachedTokens: cached,
});

describe('listCost', () => {
  it('prices uncached input, cached input and output at list prices per batch', () => {
    // (800×10 + 200×1 + 100×30) ÷ 1000
    expect(listCost({ input: 1000, output: 100, cached: 200 }, A)).toBeCloseTo(11.2);
  });
  it('prices cached tokens like input when the catalog has no cache price', () => {
    expect(listCost({ input: 1000, output: 0, cached: 500 }, price('x', 2, 4))).toBeCloseTo(2);
  });
  it('never treats more cached tokens than input tokens as a discount beyond the input', () => {
    expect(listCost({ input: 100, output: 0, cached: 500 }, A)).toBeCloseTo((100 * 1) / 1000);
  });
});

describe('priceCounterfactual', () => {
  const session = [turn('a', 1000, 100, 200)];

  it('shows the same tokens at cheaper catalog models as a ratio to what actually ran', () => {
    const result = priceCounterfactual({ turns: session, prices: [A, B, C] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ model: 'b', name: 'B' });
    expect(result[0]?.relativeCost).toBeCloseTo(1.12 / 11.2); // 0.1
  });

  it('never lists models the session already used, nor more expensive ones', () => {
    const result = priceCounterfactual({
      turns: [turn('a', 1000, 100), turn('b', 1000, 100)],
      prices: [A, B, C],
    });
    expect(result.map((row) => row.model)).toEqual([]);
  });

  it('keeps the four cheapest alternatives, cheapest first', () => {
    const cheap = ['m1', 'm2', 'm3', 'm4', 'm5'].map((id, i) => price(id, 5 - i, 10 - i * 2));
    const result = priceCounterfactual({ turns: session, prices: [A, ...cheap] });
    expect(result.map((row) => row.model)).toEqual(['m5', 'm4', 'm3', 'm2']);
  });

  it('skips turns whose model has no catalog price or whose tokens are unknown', () => {
    const result = priceCounterfactual({
      turns: [turn('a', 1000, 100, 200), turn('ollama/qwen', 5_000_000, 1), turn('a', null, 100)],
      prices: [A, B],
    });
    expect(result[0]?.relativeCost).toBeCloseTo(0.1);
  });

  it('matches model ids case-insensitively', () => {
    expect(priceCounterfactual({ turns: [turn('A', 1000, 100, 200)], prices: [A, B] })).toHaveLength(1);
  });

  it('returns nothing when no turn can be priced or nothing was spent', () => {
    expect(priceCounterfactual({ turns: [turn('ollama/qwen', 10, 10)], prices: [A, B] })).toEqual([]);
    expect(priceCounterfactual({ turns: [turn('a', 0, 0)], prices: [A, B] })).toEqual([]);
    expect(priceCounterfactual({ turns: [], prices: [A, B] })).toEqual([]);
  });

  it('ignores catalog entries without a positive price', () => {
    expect(priceCounterfactual({ turns: session, prices: [A, price('free', 0, 0)] })).toEqual([]);
  });
});
