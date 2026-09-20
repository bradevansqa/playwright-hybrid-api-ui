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

/**
 * One item in the paginated `GET /products` list response.
 *
 * Deliberately NOT a reuse of `ProductDetailResponseSchema`: although both
 * carry the same twelve top-level keys, the list item's nested objects are a
 * different shape -- `category` carries an extra `slug`, and
 * `product_image` carries seven fields rather than the two the detail
 * endpoint documents. Every key and type below was verified live against
 * `GET /products?by_category_slug=chisels`, so this one is `strictObject`
 * per the Constitution rather than loose.
 */
const ProductListItemSchema = z.strictObject({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    price: z.number(),
    is_location_offer: z.boolean(),
    is_rental: z.boolean(),
    co2_rating: z.string().nullable(),
    in_stock: z.boolean(),
    is_eco_friendly: z.boolean(),
    brand: z.strictObject({
        id: z.string(),
        name: z.string(),
    }),
    category: z.strictObject({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
    }),
    product_image: z.strictObject({
        id: z.string(),
        by_name: z.string(),
        by_url: z.url(),
        file_name: z.string(),
        source_name: z.string(),
        source_url: z.url(),
        title: z.string(),
    }),
});

/**
 * Schema for the paginated `GET /products` list response.
 *
 * `from` and `to` are null when the filtered set is empty (verified against
 * a category slug with no matches), hence nullable.
 */
export const ProductListResponseSchema = z.strictObject({
    current_page: z.int(),
    data: z.array(ProductListItemSchema),
    from: z.int().nullable(),
    last_page: z.int(),
    per_page: z.int(),
    to: z.int().nullable(),
    total: z.int(),
});

export type ProductListResponse = zOutput<typeof ProductListResponseSchema>;
