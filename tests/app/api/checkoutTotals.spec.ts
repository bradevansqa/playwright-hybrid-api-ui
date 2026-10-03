import { z } from 'zod/v4';
import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/app/app';
import { Roles } from '../../../enums/util/roles';
import { requireEnv } from '../../../helpers/util/requireEnv';
import {
    CartLine,
    CatalogProduct,
    createCart,
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
 * Each scenario places one real order as the customer. The Invoice API has
 * no DELETE, so these invoices persist on the shared instance -- the same
 * trade-off the `seededInvoice` fixture already makes.
 *
 * Products are chosen by property at run time, never by id, because the
 * shared instance is periodically reset and every id changes.
 */

/**
 * Minimal local schema for the fields asserted here. The documented
 * `InvoiceResponseSchema` is a strict contract mirror that rejects live
 * responses (see the FIXME in invoiceSchema.ts), so it is not used.
 */
const InvoiceTotalsSchema = z.looseObject({
    subtotal: z.number(),
    additional_discount_percentage: z.number().nullable(),
    additional_discount_amount: z.number().nullable(),
    eco_discount_percentage: z.number().nullable(),
    eco_discount_amount: z.number().nullable(),
    total: z.number(),
    invoicelines: z.array(
        z.looseObject({
            product_id: z.string(),
            unit_price: z.number(),
            quantity: z.int(),
        })
    ),
});

type InvoiceTotals = z.output<typeof InvoiceTotalsSchema>;

const isPurchase = (product: CatalogProduct): boolean => !product.is_rental;
const isEcoPurchase = (product: CatalogProduct): boolean =>
    product.is_eco_friendly && !product.is_rental;
const isRegularPurchase = (product: CatalogProduct): boolean =>
    !product.is_eco_friendly && !product.is_rental;
const isRental = (product: CatalogProduct): boolean => product.is_rental;

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
        description: 'an eco-friendly item, earning 5% off the whole subtotal',
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
            'a rental with a purchase, earning the 15% combination discount',
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

    for (const scenario of SCENARIOS) {
        test(
            `should invoice a cart with ${scenario.description}`,
            { tag: '@api' },
            async ({ apiRequest, authToken }) => {
                let lines: CartLine[];
                let invoice: InvoiceTotals;

                await test.step('GIVEN a cart seeded via the API from the live catalog', async () => {
                    lines = scenario.lines(await fetchCatalog(apiRequest));
                });

                await test.step('WHEN the customer checks it out', async () => {
                    const cartId = await createCart(apiRequest, lines);
                    const invoiceId = await placeOrder(
                        apiRequest,
                        authToken,
                        cartId
                    );

                    const { status, body } = await apiRequest({
                        method: 'GET',
                        url: `${ApiEndpoints.INVOICES}/${invoiceId}`,
                        baseUrl: requireEnv('API_URL'),
                        headers: authToken,
                    });

                    expect(status).toBe(200);
                    invoice = InvoiceTotalsSchema.parse(body);
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
     * Money is reported inconsistently: `eco_discount_amount` is rounded to
     * cents (1.93), but `additional_discount_amount` is returned with raw
     * float precision (e.g. 22.302 for 15% of 148.68). A client displaying or
     * summing the raw field gets a figure that matches neither the cart page
     * ("- $22.30") nor the invoice total. Asserted as it should behave and
     * marked `test.fail()`: green while the flaw exists, failing loudly once
     * fixed.
     */
    test.fail(
        'should report the combination discount amount rounded to cents',
        { tag: '@api' },
        async ({ apiRequest, authToken }) => {
            let invoice: InvoiceTotals;

            await test.step('GIVEN an order whose 15% discount is not a whole number of cents', async () => {
                const catalog = await fetchCatalog(apiRequest);
                const rental = pickProduct(catalog, isRental, 'a rental');
                const purchase = pickProduct(
                    catalog,
                    (product) =>
                        isPurchase(product) &&
                        (Math.round((product.price + rental.price) * 100) *
                            15) %
                            100 !==
                            0,
                    'a purchase whose total with the rental leaves fractional cents at 15%'
                );

                const cartId = await createCart(apiRequest, [
                    { product: purchase, quantity: 1 },
                    { product: rental, quantity: 1 },
                ]);
                const invoiceId = await placeOrder(
                    apiRequest,
                    authToken,
                    cartId
                );

                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.INVOICES}/${invoiceId}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                });

                expect(status).toBe(200);
                invoice = InvoiceTotalsSchema.parse(body);
            });

            await test.step('THEN the discount amount is a whole number of cents (currently is not)', async () => {
                const amount = invoice.additional_discount_amount ?? 0;

                expect(amount).toBe(roundToCents(amount));
            });
        }
    );
});
