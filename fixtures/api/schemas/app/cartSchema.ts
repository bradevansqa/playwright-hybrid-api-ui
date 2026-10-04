import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';

/**
 * Schema for `POST /carts` (201). Mirrors the documented `CartResponse`,
 * which declares only `id`; verified live to return exactly that.
 */
export const CartCreatedResponseSchema = z.strictObject({
    id: z.string(),
});

/**
 * Schema for `POST /carts/{id}` (200), adding an item. The OpenAPI spec
 * documents no body for this response; captured live as
 * `{"result": "item added or updated"}` (missing docs flagged upstream).
 */
export const CartItemAddedResponseSchema = z.strictObject({
    result: z.string(),
});

// Type exports
export type CartCreatedResponse = zOutput<typeof CartCreatedResponseSchema>;
export type CartItemAddedResponse = zOutput<typeof CartItemAddedResponseSchema>;
