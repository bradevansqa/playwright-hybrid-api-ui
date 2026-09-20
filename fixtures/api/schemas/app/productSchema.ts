import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';

/**
 * Schema for `GET /products/{id}`.
 *
 * Deliberately looser than a 1:1 OpenAPI mirror: verified live against
 * `GET /products/{id}` via playwright-cli, this response diverges from the
 * invoice-embedded `ProductResponse` schema (`fixtures/api/schemas/app/invoiceSchema.ts`) --
 * `brand` here omits `slug`, `category` omits the recursive
 * `sub_categories`, and an undocumented `specs` array is present. This
 * schema asserts only the fields the product-CRUD test consumes.
 */
export const ProductDetailResponseSchema = z.looseObject({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    price: z.number(),
    is_location_offer: z.boolean(),
    is_rental: z.boolean(),
    co2_rating: z.string().nullable(),
    in_stock: z.boolean(),
    is_eco_friendly: z.boolean(),
    brand: z.looseObject({
        id: z.string(),
        name: z.string(),
    }),
    category: z.looseObject({
        id: z.string(),
        name: z.string(),
    }),
    product_image: z.looseObject({
        id: z.string(),
        title: z.string(),
    }),
});

export type ProductDetailResponse = zOutput<typeof ProductDetailResponseSchema>;
