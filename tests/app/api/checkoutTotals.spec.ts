import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints, DiscountPercentages } from '../../../enums/app/app';
import { Roles } from '../../../enums/util/roles';
import { requireEnv } from '../../../helpers/util/requireEnv';
import {
    InvoiceRef,
    InvoiceTotals,
    InvoiceTotalsProjection,
} from '../../../fixtures/api/schemas/app/invoiceSchema';
import {
    CartLine,
    CatalogProduct,
    closeInvoice,
    createCart,
    discountHasFractionalCents,
    expectedTotals,
    fetchCatalog,
    pickProduct,
    placeOrder,
    roundToCents,
} from '../../../helpers/app/checkout';

/**
 * Checkout pricing: the invoice the API produces for a cart must match an
 * independent calculation from product prices alone (see `expectedTotals`
 * in helpers/app/checkout.ts for the pricing rules and how they were
 * established -- they are not documented anywhere).
 *
 * Each test places one real order as the customer. The Invoice API has no
 * DELETE, so `afterEach` closes every order a test created (COMPLETED, set
 * as admin and read back) -- the closest available revert, the same
 * trade-off the `seededInvoice` fixture makes.
 *
 * Invoices are parsed with `InvoiceTotalsProjection` rather than the full
 * contract schema -- see the live-drift note in invoiceSchema.ts.
 *
 * Products are chosen by property at run time, never by id, because the
 * shared instance is periodically reset and every id changes.
 */

const isPurchase = (product: CatalogProduct): boolean => !product.is_rental;
const isEcoPurchase = (product: CatalogProduct): boolean =>
    product.is_eco_friendly && !product.is_rental;
const isRegularPurchase = (product: CatalogProduct): boolean =>
    !product.is_eco_friendly && !product.is_rental;
const isRental = (product: CatalogProduct): boolean => product.is_rental;

/**
 * Orders placed at the same moment by the numbering test. Five makes a
 * collision near-certain: three concurrent orders already produced a
 * duplicate on the first live try.
 */
const CONCURRENT_ORDERS = 5;

/** Carts covering each pricing rule, built from the live catalog. */
const SCENARIOS: ReadonlyArray<{
    description: string;
    lines: (catalog: CatalogProduct[]) => CartLine[];
}> = [
    {
        description: 'regular products only, with no discount',
        lines: (catalog): CartLine[] => {
            const first = pickProduct(
                catalog,
                isRegularPurchase,
                'a regular purchase'
            );
            const second = pickProduct(
                catalog,
                isRegularPurchase,
                'a second regular purchase',
                [first]
            );

            return [
                { product: first, quantity: 2 },
                { product: second, quantity: 1 },
            ];
        },
    },
    {
        description:
            'an eco-friendly item, earning the eco discount on the whole subtotal',
        lines: (catalog): CartLine[] => [
            {
                product: pickProduct(
                    catalog,
                    isEcoPurchase,
                    'an eco-friendly purchase'
                ),
                quantity: 2,
            },
            {
                product: pickProduct(
                    catalog,
                    isRegularPurchase,
                    'a regular purchase'
                ),
                quantity: 1,
            },
        ],
    },
    {
        description:
            'a rental with a purchase, earning the combination discount',
        lines: (catalog): CartLine[] => [
            {
                product: pickProduct(
                    catalog,
                    isRegularPurchase,
                    'a regular purchase'
                ),
                quantity: 1,
            },
            {
                product: pickProduct(catalog, isRental, 'a rental'),
                quantity: 1,
            },
        ],
    },
    {
        description:
            'an eco-friendly item with a rental, where only the combination discount applies',
        lines: (catalog): CartLine[] => [
            {
                product: pickProduct(
                    catalog,
                    isEcoPurchase,
                    'an eco-friendly purchase'
                ),
                quantity: 1,
            },
            {
                product: pickProduct(catalog, isRental, 'a rental'),
                quantity: 1,
            },
        ],
    },
];

test.describe('api checkout totals', () => {
    test.use({ role: Roles.CUSTOMER });

    /** Orders placed by the current test, closed again in afterEach. */
    let createdInvoiceIds: string[] = [];

    test.beforeEach(() => {
        createdInvoiceIds = [];
    });

    test.afterEach(async ({ apiRequest, tokenFor }) => {
        for (const invoiceId of createdInvoiceIds) {
            const adminToken =
                await test.step('GIVEN an admin token for cleanup', async () =>
                    tokenFor(Roles.ADMIN));

            await closeInvoice(apiRequest, adminToken, invoiceId);
        }
    });

    for (const scenario of SCENARIOS) {
        test(
            `should invoice a cart with ${scenario.description}`,
            { tag: '@api' },
            async ({ apiRequest, authToken }) => {
                let lines: CartLine[];
                let cartId: string;
                let invoiceId: string;
                let invoice: InvoiceTotals;

                await test.step('GIVEN products picked from the live catalog', async () => {
                    lines = scenario.lines(await fetchCatalog(apiRequest));
                });

                await test.step('AND a cart seeded with them via the API', async () => {
                    cartId = await createCart(apiRequest, lines);
                });

                await test.step('WHEN the customer checks it out', async () => {
                    invoiceId = (
                        await placeOrder(apiRequest, authToken, cartId)
                    ).id;
                    createdInvoiceIds.push(invoiceId);
                });

                await test.step('AND the invoice is read back', async () => {
                    const { status, body } = await apiRequest({
                        method: 'GET',
                        url: `${ApiEndpoints.INVOICES}/${invoiceId}`,
                        baseUrl: requireEnv('API_URL'),
                        headers: authToken,
                    });

                    expect(status).toBe(200);
                    expect(InvoiceTotalsProjection.parse(body)).toBeTruthy();
                    invoice = InvoiceTotalsProjection.parse(body);
                });

                await test.step('THEN every invoice line carries the catalog price and quantity', async () => {
                    expect(
                        invoice.invoicelines
                            .map(({ product_id, unit_price, quantity }) => ({
                                product_id,
                                unit_price,
                                quantity,
                            }))
                            .sort((a, b) =>
                                a.product_id.localeCompare(b.product_id)
                            )
                    ).toEqual(
                        lines
                            .map(({ product, quantity }) => ({
                                product_id: product.id,
                                unit_price: product.price,
                                quantity,
                            }))
                            .sort((a, b) =>
                                a.product_id.localeCompare(b.product_id)
                            )
                    );
                });

                await test.step('AND the subtotal, discounts and total match the independent calculation', async () => {
                    const expected = expectedTotals(lines);

                    expect(invoice.subtotal).toBe(expected.subtotal);
                    // The API reports "no discount" as null or 0 depending on
                    // the field, so both are normalised to 0.
                    expect(invoice.additional_discount_percentage ?? 0).toBe(
                        expected.combinationDiscountPercentage
                    );
                    expect(invoice.eco_discount_percentage ?? 0).toBe(
                        expected.ecoDiscountPercentage
                    );
                    // toBeCloseTo(…, 2): the combination amount comes back
                    // unrounded (see the rounding test below).
                    expect(
                        (invoice.additional_discount_amount ?? 0) +
                            (invoice.eco_discount_amount ?? 0)
                    ).toBeCloseTo(expected.discountAmount, 2);
                    expect(invoice.total).toBe(expected.total);
                });
            }
        );
    }

    /*
     * FIXME: no ticket yet -- money is reported inconsistently, to report
     * upstream. `eco_discount_amount` is rounded to cents (1.93), but
     * `additional_discount_amount` is returned with raw float precision (e.g.
     * 22.302 for 15% of 148.68). A client displaying or summing the raw field
     * gets a figure that matches neither the cart page ("- $22.30") nor the
     * invoice total. Asserted as it should behave and marked `test.fail()`
     * rather than `test.skip` (repo convention, see roleAccess.spec.ts).
     */
    test.fail(
        'should report the combination discount amount rounded to cents',
        { tag: '@api' },
        async ({ apiRequest, authToken }) => {
            let rental: CatalogProduct;
            let purchase: CatalogProduct;
            let cartId: string;
            let invoiceId: string;
            let invoice: InvoiceTotals;

            await test.step('GIVEN a rental and a purchase whose combination discount is not a whole number of cents', async () => {
                const catalog = await fetchCatalog(apiRequest);
                rental = pickProduct(catalog, isRental, 'a rental');
                purchase = pickProduct(
                    catalog,
                    (product) =>
                        isPurchase(product) &&
                        discountHasFractionalCents(
                            roundToCents(product.price + rental.price),
                            DiscountPercentages.COMBINATION
                        ),
                    'a purchase whose total with the rental leaves fractional cents'
                );
            });

            await test.step('AND a cart seeded with them via the API', async () => {
                cartId = await createCart(apiRequest, [
                    { product: purchase, quantity: 1 },
                    { product: rental, quantity: 1 },
                ]);
            });

            await test.step('WHEN the customer checks it out', async () => {
                invoiceId = (await placeOrder(apiRequest, authToken, cartId))
                    .id;
                createdInvoiceIds.push(invoiceId);
            });

            await test.step('AND the invoice is read back', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.INVOICES}/${invoiceId}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                });

                expect(status).toBe(200);
                expect(InvoiceTotalsProjection.parse(body)).toBeTruthy();
                invoice = InvoiceTotalsProjection.parse(body);
            });

            await test.step('THEN the discount amount is a whole number of cents (currently is not)', async () => {
                const amount = invoice.additional_discount_amount ?? 0;

                expect(amount).toBe(roundToCents(amount));
            });
        }
    );

    /*
     * FIXME: no ticket yet -- invoice numbers are not unique, to report
     * upstream. Orders placed at the same moment can be given the same
     * invoice number (verified live: three concurrent orders came back as
     * INV-…21, INV-…22, INV-…21; two parallel UI checkouts collided the same
     * way). The number is what the customer sees on the confirmation page
     * and the PDF, and what invoice search keys on, so a duplicate points a
     * customer -- and the checkout E2E test -- at someone else's order.
     * `test.fail()` per the repo convention (see roleAccess.spec.ts).
     */
    test.fail(
        'should give orders placed at the same moment distinct invoice numbers',
        { tag: '@api' },
        async ({ apiRequest, authToken }) => {
            let product: CatalogProduct;
            let cartIds: string[];
            let invoices: InvoiceRef[];

            await test.step('GIVEN a regular product from the live catalog', async () => {
                product = pickProduct(
                    await fetchCatalog(apiRequest),
                    isRegularPurchase,
                    'a regular purchase'
                );
            });

            await test.step(`AND ${CONCURRENT_ORDERS} carts seeded with it via the API`, async () => {
                cartIds = await Promise.all(
                    Array.from({ length: CONCURRENT_ORDERS }, () =>
                        createCart(apiRequest, [{ product, quantity: 1 }])
                    )
                );
            });

            await test.step('WHEN the customer checks them all out at the same moment', async () => {
                invoices = await Promise.all(
                    cartIds.map((cartId) =>
                        placeOrder(apiRequest, authToken, cartId)
                    )
                );
                createdInvoiceIds.push(...invoices.map(({ id }) => id));
            });

            await test.step('THEN every order has its own invoice number (currently can repeat)', async () => {
                const numbers = invoices.map(
                    ({ invoice_number }) => invoice_number
                );

                expect(new Set(numbers).size).toBe(numbers.length);
            });
        }
    );
});
