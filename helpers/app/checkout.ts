import { expect, test } from '@playwright/test';
import { generateStatusMessage } from '../../test-data/factories/app/invoice.factory';
import type { ApiRequestFn } from '../../fixtures/api/api-types';
import {
    ApiEndpoints,
    ApiEndpointSuffixes,
    DiscountPercentages,
    InvoiceStatus,
    PaymentMethods,
} from '../../enums/app/app';
import {
    ProductListResponse,
    ProductListResponseSchema,
} from '../../fixtures/api/schemas/app/productSchema';
import {
    CartCreatedResponseSchema,
    CartItemAddedResponseSchema,
} from '../../fixtures/api/schemas/app/cartSchema';
import { PostcodeLookupResponseSchema } from '../../fixtures/api/schemas/app/postcodeSchema';
import { CurrentUserResponseSchema } from '../../fixtures/api/schemas/app/userSchema';
import { Roles } from '../../enums/util/roles';
import {
    InvoiceRef,
    InvoiceRefProjection,
    InvoiceStatusProjection,
} from '../../fixtures/api/schemas/app/invoiceSchema';
import { requireEnv } from '../util/requireEnv';

/*
 * API-side checkout plumbing shared by the checkout API tests and the
 * checkout E2E journey: pick real products by property, seed a cart, place
 * an order, close it again afterwards, and compute what the order *should*
 * cost.
 *
 * Every API call runs in its own `test.step`, so each one shows up as a
 * named sub-step under whichever spec step called the helper.
 */

export type CatalogProduct = ProductListResponse['data'][number];

/** One product line in a cart: a real product and how many of it. */
export type CartLine = {
    product: CatalogProduct;
    quantity: number;
};

/** What an order is expected to cost, per the observed pricing rules. */
export type ExpectedTotals = {
    subtotal: number;
    /** DiscountPercentages.COMBINATION for a rental + purchase mix, otherwise 0 */
    combinationDiscountPercentage: number;
    /** DiscountPercentages.ECO when the cart has an eco item and no combination discount */
    ecoDiscountPercentage: number;
    /** The one discount that applies, in currency, rounded to cents */
    discountAmount: number;
    total: number;
};

/**
 * Fixed billing lookup key, for the API checkout and the UI billing form
 * alike: the API rejects billing addresses whose parts disagree, and the UI
 * fills street, city and state from country + postcode + house number.
 */
export const BILLING_LOOKUP = {
    country: 'The Netherlands',
    countryCode: 'NL',
    postcode: '1234AB',
    houseNumber: '12',
} as const;

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
            const url = `${ApiEndpoints.PRODUCTS}?page=${page}${query}`;

            await test.step(`GET ${url}`, async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url,
                    baseUrl: requireEnv('API_URL'),
                });

                expect(status).toBe(200);
                expect(ProductListResponseSchema.parse(body)).toBeTruthy();
                const parsed = ProductListResponseSchema.parse(body);
                products.push(...parsed.data);
                lastPage = parsed.last_page;
            });

            page += 1;
        } while (page <= lastPage);
    }

    return products.filter((product) => product.is_rental || product.in_stock);
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
    const cartId = await test.step(`POST ${ApiEndpoints.CARTS}`, async () => {
        const { status, body } = await apiRequest({
            method: 'POST',
            url: ApiEndpoints.CARTS,
            baseUrl: requireEnv('API_URL'),
        });

        expect(status).toBe(201);
        expect(CartCreatedResponseSchema.parse(body)).toBeTruthy();

        return CartCreatedResponseSchema.parse(body).id;
    });

    for (const { product, quantity } of lines) {
        await test.step(`POST ${ApiEndpoints.CARTS}/{id} -- ${quantity} x ${product.name}`, async () => {
            const { status, body } = await apiRequest({
                method: 'POST',
                url: `${ApiEndpoints.CARTS}/${cartId}`,
                baseUrl: requireEnv('API_URL'),
                body: { product_id: product.id, quantity },
            });

            expect(status).toBe(200);
            expect(CartItemAddedResponseSchema.parse(body)).toBeTruthy();
        });
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
 * @returns {Promise<InvoiceRef>} The created invoice's id, number and owner.
 */
export async function placeOrder(
    apiRequest: ApiRequestFn,
    token: string,
    cartId: string
): Promise<InvoiceRef> {
    const address =
        await test.step(`GET ${ApiEndpoints.POSTCODE_LOOKUP}`, async () => {
            const { status, body } = await apiRequest({
                method: 'GET',
                url: `${ApiEndpoints.POSTCODE_LOOKUP}?country=${encodeURIComponent(BILLING_LOOKUP.country)}&postcode=${BILLING_LOOKUP.postcode}`,
                baseUrl: requireEnv('API_URL'),
            });

            expect(status).toBe(200);
            expect(PostcodeLookupResponseSchema.parse(body)).toBeTruthy();

            return PostcodeLookupResponseSchema.parse(body);
        });

    return test.step(`POST ${ApiEndpoints.INVOICES}`, async () => {
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
        // Projection, not InvoiceResponseSchema -- see the live-drift note
        // in invoiceSchema.ts.
        expect(InvoiceRefProjection.parse(body)).toBeTruthy();

        return InvoiceRefProjection.parse(body);
    });
}

/**
 * Cleanup for a test-created invoice. The Invoice API has no DELETE, so the
 * closest available revert is to close the order: set it to the terminal
 * COMPLETED status (as admin), then read it back to confirm the change was
 * persisted rather than trusting the PUT's own response.
 *
 * The token's identity is confirmed first: a customer token would make the
 * read-back fail with a misleading 404 rather than a clear identity error.
 *
 * @param {ApiRequestFn} apiRequest - The apiRequest fixture.
 * @param {string} adminToken - An admin bearer token.
 * @param {string} invoiceId - The invoice to close.
 * @returns {Promise<void>} Resolves once the closed status is confirmed.
 */
export async function closeInvoice(
    apiRequest: ApiRequestFn,
    adminToken: string,
    invoiceId: string
): Promise<void> {
    const statusUrl = `${ApiEndpoints.INVOICES}/${invoiceId}${ApiEndpointSuffixes.STATUS}`;

    await test.step(`GET ${ApiEndpoints.CURRENT_USER} -- confirm admin token`, async () => {
        const { status, body } = await apiRequest({
            method: 'GET',
            url: ApiEndpoints.CURRENT_USER,
            baseUrl: requireEnv('API_URL'),
            headers: adminToken,
        });

        expect(status).toBe(200);
        expect(CurrentUserResponseSchema.parse(body)).toBeTruthy();
        expect(
            CurrentUserResponseSchema.parse(body).role,
            'Cleanup token is not an admin session -- see README, Known limitations'
        ).toBe(Roles.ADMIN);
    });

    await test.step(`PUT ${ApiEndpoints.INVOICES}/{id}${ApiEndpointSuffixes.STATUS} -- close test order`, async () => {
        const { status } = await apiRequest({
            method: 'PUT',
            url: statusUrl,
            baseUrl: requireEnv('API_URL'),
            headers: adminToken,
            body: {
                status: InvoiceStatus.COMPLETED,
                status_message: generateStatusMessage(),
            },
        });

        expect(status).toBe(200);
    });

    await test.step(`GET ${ApiEndpoints.INVOICES}/{id} -- confirm closed`, async () => {
        const { status, body } = await apiRequest({
            method: 'GET',
            url: `${ApiEndpoints.INVOICES}/${invoiceId}`,
            baseUrl: requireEnv('API_URL'),
            headers: adminToken,
        });

        expect(status).toBe(200);
        expect(InvoiceStatusProjection.parse(body)).toBeTruthy();
        expect(InvoiceStatusProjection.parse(body).status).toBe(
            InvoiceStatus.COMPLETED
        );
    });
}

/**
 * Computes what a cart should cost, from product prices alone.
 *
 * The pricing rules are undocumented; these were established by checking
 * out probe carts and confirmed against the cart page, which shows the
 * same discount line before checkout:
 * - a rental mixed with a purchased item earns the combination discount;
 * - otherwise, any eco-friendly item earns the eco discount off the *whole*
 *   subtotal;
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
        hasRental && hasPurchase ? DiscountPercentages.COMBINATION : 0;
    const ecoDiscountPercentage =
        combinationDiscountPercentage === 0 && hasEco
            ? DiscountPercentages.ECO
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

/**
 * Whether a cart total leaves fractional cents once a percentage discount is
 * applied -- the precondition for observing an unrounded discount amount.
 *
 * @param {number} amount - The cart subtotal.
 * @param {number} percentage - The discount percentage.
 * @returns {boolean} True when the discount is not a whole number of cents.
 */
export function discountHasFractionalCents(
    amount: number,
    percentage: number
): boolean {
    return (Math.round(amount * 100) * percentage) % 100 !== 0;
}
