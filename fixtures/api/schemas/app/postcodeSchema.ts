import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';

/**
 * Schema for `GET /postcode-lookup` (200). The OpenAPI spec documents the
 * endpoint but no response body; captured live (missing docs flagged
 * upstream). The API rejects billing addresses whose parts disagree, so a
 * real lookup is the reliable way to get a self-consistent address.
 */
export const PostcodeLookupResponseSchema = z.strictObject({
    street: z.string(),
    house_number: z.string(),
    city: z.string(),
    state: z.string(),
    country: z.string(),
    postcode: z.string(),
});

// Type exports
export type PostcodeLookupResponse = zOutput<
    typeof PostcodeLookupResponseSchema
>;
