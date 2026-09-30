import { z } from 'zod';

export interface CatalogModel {
  id: string;
  name: string | null;
  vendor: string | null;
  family: string | null;
  pickerCategory: string | null;
  priceCategory: string | null;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  priceBatchSize: number | null;
}

// Lenient by construction: a field of the wrong type becomes undefined instead of dropping the whole entry.
const optionalNumber = z.number().optional().catch(undefined);
const optionalString = z.string().optional().catch(undefined);
const prices = z
  .looseObject({
    input_price: optionalNumber,
    output_price: optionalNumber,
    cache_read_price: optionalNumber,
  })
  .optional()
  .catch(undefined);
const entry = z.looseObject({
  id: z.string().min(1),
  name: optionalString,
  vendor: optionalString,
  model_picker_category: optionalString,
  model_picker_price_category: optionalString,
  capabilities: z
    .looseObject({
      family: optionalString,
      limits: z
        .looseObject({ max_context_window_tokens: optionalNumber, max_output_tokens: optionalNumber })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
  billing: z
    .looseObject({
      token_prices: z
        .looseObject({ batch_size: optionalNumber, default: prices })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
});

export function parseModelsJson(text: string): CatalogModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item: unknown): CatalogModel[] => {
    const result = entry.safeParse(item);
    if (!result.success) return [];
    const model = result.data;
    const price = model.billing?.token_prices?.default;
    return [
      {
        id: model.id,
        name: model.name ?? null,
        vendor: model.vendor ?? null,
        family: model.capabilities?.family ?? null,
        pickerCategory: model.model_picker_category ?? null,
        priceCategory: model.model_picker_price_category ?? null,
        maxContextTokens: model.capabilities?.limits?.max_context_window_tokens ?? null,
        maxOutputTokens: model.capabilities?.limits?.max_output_tokens ?? null,
        inputPrice: price?.input_price ?? null,
        outputPrice: price?.output_price ?? null,
        cacheReadPrice: price?.cache_read_price ?? null,
        priceBatchSize: model.billing?.token_prices?.batch_size ?? null,
      },
    ];
  });
}
