import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';

/*
 * Schemas for the invoice response (Toolshop API `InvoiceResponse`), built
 * as a 1:1 mirror of the OpenAPI contract — including the nested refs
 * returned on each invoice line (`ProductResponse` -> `BrandResponse` /
 * `CategoryResponse` / `ImageResponse`).
 *
 * FIXME: live `GET /invoices/{id}` responses also include a `payment` object
 * (`payment_method`, `payment_details`) and `eco_discount_percentage` /
 * `eco_discount_amount` fields that are absent from the documented
 * `InvoiceResponse` schema. Per the "Explore Before Generate" policy this
 * schema mirrors the documentation, not the live shape, so parsing a real
 * response currently throws `unrecognized_keys` — a contract bug to report,
 * not a reason to loosen the schema (see `api-testing` skill Phase 7).
 */

/** `BrandResponse` — brand attached to a product. */
export const BrandResponseSchema = z.strictObject({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
});

/**
 * `CategoryResponse` — product category. Recursive via `sub_categories`;
 * uses Zod 4's getter pattern for self-referential object schemas.
 */
export const CategoryResponseSchema = z.strictObject({
    id: z.string(),
    parent_id: z.string().nullable(),
    name: z.string(),
    slug: z.string(),
    get sub_categories() {
        return z.array(CategoryResponseSchema);
    },
});

/** `ImageResponse` — product image with attribution metadata. */
export const ImageResponseSchema = z.strictObject({
    id: z.string(),
    by_name: z.string(),
    by_url: z.string(),
    source_name: z.string(),
    source_url: z.string(),
    file_name: z.string(),
    title: z.string(),
});

/** `ProductResponse` — product embedded in each invoice line. */
export const ProductResponseSchema = z.strictObject({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    price: z.number(),
    is_location_offer: z.boolean(),
    is_rental: z.boolean(),
    in_stock: z.boolean(),
    co2_rating: z.string(),
    is_eco_friendly: z.boolean(),
    brand: BrandResponseSchema,
    category: CategoryResponseSchema,
    product_image: ImageResponseSchema,
});

/** `InvoiceLineResponse` — a single line item on an invoice. */
export const InvoiceLineResponseSchema = z.strictObject({
    id: z.string(),
    invoice_id: z.string(),
    product_id: z.string(),
    unit_price: z.number(),
    discount_percentage: z.number(),
    discounted_price: z.number(),
    quantity: z.int(),
    product: ProductResponseSchema,
});

/**
 * `InvoiceResponse` — full invoice as returned by the invoice endpoints
 * (`POST /invoices`, `GET /invoices/{id}`, etc.).
 *
 * `status` and `status_message` are documented on this schema as plain
 * `string` (no enum, no nullability) — kept as-is rather than importing the
 * stricter enum documented on the sibling `PUT /invoices/{id}/status`
 * request schema, since that constraint is not asserted here.
 */
export const InvoiceResponseSchema = z.strictObject({
    id: z.string(),
    user_id: z.string(),
    invoice_date: z.string(),
    invoice_number: z.string(),
    billing_street: z.string(),
    billing_city: z.string(),
    billing_state: z.string(),
    billing_country: z.string(),
    billing_postal_code: z.string(),
    additional_discount_percentage: z.number(),
    additional_discount_amount: z.number(),
    subtotal: z.number(),
    total: z.number(),
    status: z.string(),
    status_message: z.string(),
    invoicelines: z.array(InvoiceLineResponseSchema),
    created_at: z.string(),
});

// Type exports
export type BrandResponse = zOutput<typeof BrandResponseSchema>;
export type CategoryResponse = zOutput<typeof CategoryResponseSchema>;
export type ImageResponse = zOutput<typeof ImageResponseSchema>;
export type ProductResponse = zOutput<typeof ProductResponseSchema>;
export type InvoiceLineResponse = zOutput<typeof InvoiceLineResponseSchema>;
export type InvoiceResponse = zOutput<typeof InvoiceResponseSchema>;
