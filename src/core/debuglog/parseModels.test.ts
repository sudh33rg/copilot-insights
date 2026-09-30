import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEBUG_LOG_FIXTURES } from '../../../test/fixtures/fixtures';
import { parseModelsJson } from './parseModels';

const fixture = readFileSync(join(DEBUG_LOG_FIXTURES, 'fx-auto-1', 'models.json'), 'utf8');

describe('parseModelsJson', () => {
  it('reads identity, tier, limits and the price table exactly as recorded', () => {
    const [luna] = parseModelsJson(fixture);
    expect(luna).toEqual({
      id: 'gpt-5.6-luna',
      name: 'GPT-5.6 Luna',
      vendor: 'OpenAI',
      family: 'gpt-5.6',
      pickerCategory: 'powerful',
      priceCategory: 'high',
      maxContextTokens: 400000,
      maxOutputTokens: 128000,
      inputPrice: 5,
      outputPrice: 30,
      cacheReadPrice: 0.5,
      priceBatchSize: 1000000,
    });
  });

  it('leaves missing fields null and skips entries without an id', () => {
    const models = parseModelsJson(fixture);
    expect(models.map((model) => model.id)).toEqual(['gpt-5.6-luna', 'gpt-4o-mini', 'weird']);
    expect(models[1]).toMatchObject({ pickerCategory: 'lightweight', priceCategory: null, inputPrice: null });
  });

  it('survives wrong types without throwing', () => {
    expect(parseModelsJson(fixture)[2]).toEqual({
      id: 'weird',
      name: null,
      vendor: null,
      family: null,
      pickerCategory: null,
      priceCategory: null,
      maxContextTokens: null,
      maxOutputTokens: null,
      inputPrice: null,
      outputPrice: null,
      cacheReadPrice: null,
      priceBatchSize: null,
    });
    expect(parseModelsJson('not json')).toEqual([]);
    expect(parseModelsJson('{"a":1}')).toEqual([]);
    expect(parseModelsJson('[]')).toEqual([]);
  });
});
