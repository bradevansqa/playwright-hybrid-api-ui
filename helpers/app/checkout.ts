import { expect } from '@playwright/test';
import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';
import type { ApiRequestFn } from '../../fixtures/api/api-types';
import { ApiEndpoints, PaymentMethods } from '../../enums/app/app';
import { requireEnv } from '../util/requireEnv';

/*
 * API-side checkout plumbing shared by the checkout API tests and the
 * checkout E2E journey: pick real products by property, seed a cart, place
 * an order, and compute what the order *should* cost.
 *
 * Minimal local schemas: only the fields consumed here. The documented
 * product and invoice schemas are strict mirrors of the OpenAPI contract
 * and reject live responses (see the FIXME in invoiceSchema.ts).
 */

const CatalogProductSchema = z.looseObject({
    id: z.string(),
    name: z.string(),
    price: z.number(),
    is_eco_friendly: z.boolean(),
    is_rental: z.boolean(),
    in_stock: z.boolean().nullable(),
});

const CatalogPageSchema = z.looseObject({
    data: z.array(CatalogProductSchema),
    last_page: z.int(),
});

const CartCreatedSchema = z.looseObject({ id: z.string() });

const PostcodeLookupSchema = z.looseObject({
    street: z.string(),
    house_number: z.string(),
    city: z.string(),
    state: z.string(),
    country: z.string(),
    postcode: z.string(),
});

const InvoiceCreatedSchema = z.looseObject({ id: z.string() });

export type CatalogProduct = zOutput<typeof CatalogProductSchema>;

/** One product line in a cart: a real product and how many of it. */
export type CartLine = {
    product: CatalogProduct;
    quantity: number;
};

/** What an order is expected to cost, per the observed pricing rules. */
export type ExpectedTotals = {
    subtotal: number;
    /** 15 for a rental + purchase mix, otherwise 0 */
    combinationDiscountPercentage: number;
    /** 5 when the cart has an eco-friendly item and no combination discount */
    ecoDiscountPercentage: number;
    /** The one discount that applies, in currency, rounded to cents */
    discountAmount: number;
    total: number;
};

/** Fixed lookup key: the API rejects billing addresses whose parts disagree. */
const BILLING_LOOKUP = {
    country: 'The Netherlands',
    postcode: '1234AB',
} as const;

/** Combination discount for mixing a rental with a purchase. */
const COMBINATION_DISCOUNT_PERCENTAGE = 15;

/** Discount for carts containing an eco-friendly product. */
const ECO_DISCOUNT_PERCENTAGE = 5;

/**
 * Rounds a currency amount to cents.
 *
 * @param {number} amount - Amount to round.
 * @returns {number} The amount rounded half-up to two decimal places.
 */
export function roundToCents(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Loads every orderable product: in-stock purchases plus all rentals.
 *
 * Rentals never appear in the default `GET /products` listing, only behind
 * `?is_rental=true`, and always report `in_stock: false` -- yet they can be
 * added to a cart and invoiced (verified live), since a rental has no stock
 * to run out of. So the stock filter applies to purchases only.
 *
 * @param {ApiRequestFn} apiRequest - The apiRequest fixture.
 * @returns {Promise<CatalogProduct[]>} All orderable products.
 */
export async function fetchCatalog(
    apiRequest: ApiRequestFn
): Promise<CatalogProduct[]> {
    const products: CatalogProduct[] = [];

    for (const query of ['', '&is_rental=true']) {
        let page = 1;
        let lastPage = 1;

        do {
            const { status, body } = await apiRequest({
                method: 'GET',
                url: `${ApiEndpoints.PRODUCTS}?page=${page}${query}`,
                baseUrl: requireEnv('API_URL'),
            });

            expect(status).toBe(200);
            const parsed = CatalogPageSchema.parse(body);
            products.push(...parsed.data);
            lastPage = parsed.last_page;
            page += 1;
        } while (page <= lastPage);
    }

    return products.filter(
        (product) => product.is_rental || product.in_stock !== false
    );
}

/**
 * Picks the first catalog product matching a description of what is needed.
 * Products are chosen by property, never by id: the shared instance is
 * periodically reset and every id changes.
 *
 * @param {CatalogProduct[]} catalog - Products from `fetchCatalog`.
 * @param {(product: CatalogProduct) => boolean} matches - Required properties.
 * @param {string} description - What is needed, for the failure message.
 * @param {CatalogProduct[]} [exclude=[]] - Products already picked.
 * @returns {CatalogProduct} A matching product.
 */
export function pickProduct(
    catalog: CatalogProduct[],
    matches: (product: CatalogProduct) => boolean,
    description: string,
    exclude: CatalogProduct[] = []
): CatalogProduct {
    const product = catalog.find(
        (candidate) =>
            matches(candidate) &&
            !exclude.some((excluded) => excluded.id === candidate.id)
    );

    expect(
        product,
        `No orderable product found that is ${description}`
    ).toBeDefined();

    return product!;
}

/**
 * Creates an anonymous cart through the API and fills it.
 *
 * @param {ApiRequestFn} apiRequest - The apiRequest fixture.
 * @param {CartLine[]} lines - Products and quantities to add.
 * @returns {Promise<string>} The new cart's id.
 */
export async function createCart(
    apiRequest: ApiRequestFn,
    lines: CartLine[]
): Promise<string> {
    const { status, body } = await apiRequest({
        method: 'POST',
        url: ApiEndpoints.CARTS,
        baseUrl: requireEnv('API_URL'),
    });

    expect(status).toBe(201);
    const { id: cartId } = CartCreatedSchema.parse(body);

    for (const { product, quantity } of lines) {
        const { status: addStatus } = await apiRequest({
            method: 'POST',
            url: `${ApiEndpoints.CARTS}/${cartId}`,
            baseUrl: requireEnv('API_URL'),
            body: { product_id: product.id, quantity },
        });

        expect(addStatus).toBe(200);
    }

    return cartId;
}

/**
 * Checks out a cart as the token's user, paying cash on delivery, with a
 * self-consistent billing address from the postcode lookup.
 *
 * @param {ApiRequestFn} apiRequest - The apiRequest fixture.
 * @param {string} token - The buyer's bearer token.
 * @param {string} cartId - Cart to check out.
 * @returns {Promise<string>} The created invoice's id.
 */
export async function placeOrder(
    apiRequest: ApiRequestFn,
    token: string,
    cartId: string
): Promise<string> {
    const { status: addressStatus, body: addressBody } = await apiRequest({
        method: 'GET',
        url: `${ApiEndpoints.POSTCODE_LOOKUP}?country=${encodeURIComponent(BILLING_LOOKUP.country)}&postcode=${BILLING_LOOKUP.postcode}`,
        baseUrl: requireEnv('API_URL'),
    });

    expect(addressStatus).toBe(200);
    const address = PostcodeLookupSchema.parse(addressBody);

    const { status, body } = await apiRequest({
        method: 'POST',
        url: ApiEndpoints.INVOICES,
        baseUrl: requireEnv('API_URL'),
        headers: token,
        body: {
            billing_street: `${address.street} ${address.house_number}`,
            billing_city: address.city,
            billing_state: address.state,
            billing_country: address.country,
            billing_postal_code: address.postcode,
            payment_method: PaymentMethods.CASH_ON_DELIVERY,
            payment_details: {},
            cart_id: cartId,
        },
    });

    // OpenAPI documents 200; the live API returns 201 for a created invoice.
    expect(status).toBe(201);

    return InvoiceCreatedSchema.parse(body).id;
}

/**
 * Computes what a cart should cost, from product prices alone.
 *
 * The pricing rules are undocumented; these were established by checking
 * out probe carts and confirmed against the cart page, which shows the
 * same discount line before checkout:
 * - a rental mixed with a purchased item earns a 15% combination discount;
 * - otherwise, any eco-friendly item earns 5% off the *whole* subtotal;
 * - the two never stack -- the combination discount wins;
 * - the total is the subtotal minus the discount, rounded to cents.
 *
 * @param {CartLine[]} lines - The cart's contents.
 * @returns {ExpectedTotals} The expected subtotal, discounts and total.
 */
export function expectedTotals(lines: CartLine[]): ExpectedTotals {
    const subtotal = roundToCents(
        lines.reduce(
            (sum, { product, quantity }) => sum + product.price * quantity,
            0
        )
    );

    const hasRental = lines.some(({ product }) => product.is_rental);
    const hasPurchase = lines.some(({ product }) => !product.is_rental);
    const hasEco = lines.some(({ product }) => product.is_eco_friendly);

    const combinationDiscountPercentage =
        hasRental && hasPurchase ? COMBINATION_DISCOUNT_PERCENTAGE : 0;
    const ecoDiscountPercentage =
        combinationDiscountPercentage === 0 && hasEco
            ? ECO_DISCOUNT_PERCENTAGE
            : 0;

    const discount =
        (subtotal * (combinationDiscountPercentage + ecoDiscountPercentage)) /
        100;

    return {
        subtotal,
        combinationDiscountPercentage,
        ecoDiscountPercentage,
        discountAmount: roundToCents(discount),
        total: roundToCents(subtotal - discount),
    };
}
