import { z } from 'zod/v4';
import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints, PaymentMethods } from '../../../enums/app/app';
import { Roles } from '../../../enums/util/roles';
import { requireEnv } from '../../../helpers/util/requireEnv';
import {
    CartLine,
    CatalogProduct,
    createCart,
    expectedTotals,
    ExpectedTotals,
    fetchCatalog,
    pickProduct,
    roundToCents,
} from '../../../helpers/app/checkout';

/**
 * Checkout journey, end to end: what the customer is shown before paying
 * must match what they are invoiced.
 *
 * The cart is seeded through the API and handed to the browser via
 * sessionStorage, so the UI is used only for the feature under test -- the
 * checkout wizard. Expected figures come from catalog prices via
 * `expectedTotals`, independently of both the cart page and the invoice.
 *
 * Each run places one real order per scenario; the Invoice API has no
 * DELETE, so these persist on the shared instance (see checkoutTotals.spec.ts).
 */

/** Billing lookup key; the app fills street, city and state from it. */
const BILLING = { countryCode: 'NL', postcode: '1234AB', houseNumber: '12' };

/** Minimal local schemas: only the fields this test consumes. */
const InvoiceSearchSchema = z.looseObject({
    data: z.array(
        z.looseObject({ id: z.string(), invoice_number: z.string() })
    ),
});

const InvoiceTotalSchema = z.looseObject({
    id: z.string(),
    subtotal: z.number(),
    total: z.number(),
});

/** Which cart discount row a scenario shows, and which it must not. */
type DiscountRow = 'combinationDiscount' | 'ecoDiscount';

const SCENARIOS: ReadonlyArray<{
    description: string;
    shownDiscount: DiscountRow;
    absentDiscount: DiscountRow;
    lines: (catalog: CatalogProduct[]) => CartLine[];
}> = [
    {
        description: 'an eco-friendly item, showing the 5% eco discount',
        shownDiscount: 'ecoDiscount',
        absentDiscount: 'combinationDiscount',
        lines: (catalog): CartLine[] => [
            {
                product: pickProduct(
                    catalog,
                    (product) => product.is_eco_friendly && !product.is_rental,
                    'an eco-friendly purchase'
                ),
                quantity: 2,
            },
            {
                product: pickProduct(
                    catalog,
                    (product) => !product.is_eco_friendly && !product.is_rental,
                    'a regular purchase'
                ),
                quantity: 1,
            },
        ],
    },
    {
        description:
            'a rental and a purchase, showing the 15% combination discount',
        shownDiscount: 'combinationDiscount',
        absentDiscount: 'ecoDiscount',
        lines: (catalog): CartLine[] => [
            {
                product: pickProduct(
                    catalog,
                    (product) => !product.is_eco_friendly && !product.is_rental,
                    'a regular purchase'
                ),
                quantity: 1,
            },
            {
                product: pickProduct(
                    catalog,
                    (product) => product.is_rental,
                    'a rental'
                ),
                quantity: 1,
            },
        ],
    },
];

test.describe('checkout journey', () => {
    test.use({ role: Roles.CUSTOMER });

    for (const scenario of SCENARIOS) {
        test(
            `should invoice exactly what the cart showed for ${scenario.description}`,
            { tag: '@e2e' },
            async ({ checkoutPage, apiRequest, authToken }) => {
                let lines: CartLine[];
                let expected: ExpectedTotals;
                let invoiceNumber: string;

                await test.step('GIVEN a cart seeded via the API and handed to the browser', async () => {
                    lines = scenario.lines(await fetchCatalog(apiRequest));
                    expected = expectedTotals(lines);

                    const cartId = await createCart(apiRequest, lines);
                    await checkoutPage.useCart(
                        cartId,
                        lines.reduce(
                            (count, { quantity }) => count + quantity,
                            0
                        )
                    );
                });

                await test.step('WHEN the customer opens the checkout', async () => {
                    await checkoutPage.open();
                });

                await test.step('THEN the cart lists each product at its catalog line price', async () => {
                    await expect(checkoutPage.lineTitles).toHaveText(
                        lines.map(({ product }) => product.name)
                    );
                    await expect(checkoutPage.linePrices).toHaveText(
                        lines.map(
                            ({ product, quantity }) =>
                                `$${roundToCents(product.price * quantity).toFixed(2)}`
                        )
                    );
                });

                await test.step('AND the subtotal, discount and total match the independent calculation', async () => {
                    await expect(checkoutPage.subtotal).toHaveText(
                        `$${expected.subtotal.toFixed(2)}`
                    );

                    // The two discounts never stack (see expectedTotals).
                    await expect(
                        checkoutPage[scenario.shownDiscount]
                    ).toHaveText(`- $${expected.discountAmount.toFixed(2)}`);
                    await expect(
                        checkoutPage[scenario.absentDiscount]
                    ).toBeHidden();
                    await expect(checkoutPage.total).toHaveText(
                        `$${expected.total.toFixed(2)}`
                    );
                });

                await test.step('WHEN the customer completes sign-in, billing and payment', async () => {
                    await checkoutPage.proceedPastCartAndSignIn();
                    await checkoutPage.fillBillingByPostcode(
                        BILLING.countryCode,
                        BILLING.postcode,
                        BILLING.houseNumber
                    );
                    await checkoutPage.payAndConfirm(
                        PaymentMethods.CASH_ON_DELIVERY
                    );
                    invoiceNumber = await checkoutPage.confirmedInvoiceNumber();
                });

                await test.step('THEN the invoice the API holds charges the total the cart showed', async () => {
                    const { status: searchStatus, body: searchBody } =
                        await apiRequest({
                            method: 'GET',
                            url: `${ApiEndpoints.INVOICES_SEARCH}?q=${invoiceNumber}`,
                            baseUrl: requireEnv('API_URL'),
                            headers: authToken,
                        });

                    expect(searchStatus).toBe(200);
                    const match = InvoiceSearchSchema.parse(
                        searchBody
                    ).data.find(
                        (invoice) => invoice.invoice_number === invoiceNumber
                    );
                    expect(
                        match,
                        `Invoice ${invoiceNumber} not found for the customer`
                    ).toBeDefined();

                    const { status, body } = await apiRequest({
                        method: 'GET',
                        url: `${ApiEndpoints.INVOICES}/${match!.id}`,
                        baseUrl: requireEnv('API_URL'),
                        headers: authToken,
                    });

                    expect(status).toBe(200);
                    const invoice = InvoiceTotalSchema.parse(body);
                    expect(invoice.subtotal).toBe(expected.subtotal);
                    expect(invoice.total).toBe(expected.total);
                });
            }
        );
    }
});
