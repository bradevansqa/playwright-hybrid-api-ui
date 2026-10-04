import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints, PaymentMethods } from '../../../enums/app/app';
import { Roles } from '../../../enums/util/roles';
import { requireEnv } from '../../../helpers/util/requireEnv';
import {
    InvoicePageProjection,
    InvoiceRef,
    InvoiceTotalsProjection,
} from '../../../fixtures/api/schemas/app/invoiceSchema';
import {
    BILLING_LOOKUP,
    CartLine,
    CatalogProduct,
    closeInvoice,
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
 * Each test places one real order. The Invoice API has no DELETE, so
 * `afterEach` closes it (COMPLETED, set as admin and read back) -- see
 * checkoutTotals.spec.ts. Invoices are parsed with the projections from
 * invoiceSchema.ts (see its live-drift note).
 *
 * The scenarios run serially: the API can hand two orders placed at the same
 * moment the same invoice number (see the numbering test in
 * checkoutTotals.spec.ts), and this test finds its order by that number.
 */

/** Which cart discount row a scenario shows, and which it must not. */
type DiscountRow = 'combinationDiscount' | 'ecoDiscount';

const SCENARIOS: ReadonlyArray<{
    description: string;
    shownDiscount: DiscountRow;
    absentDiscount: DiscountRow;
    lines: (catalog: CatalogProduct[]) => CartLine[];
}> = [
    {
        description: 'an eco-friendly item, showing the eco discount',
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
            'a rental and a purchase, showing the combination discount',
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
    test.describe.configure({ mode: 'serial' });
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
            `should invoice exactly what the cart showed for ${scenario.description}`,
            { tag: '@e2e' },
            async ({ checkoutPage, apiRequest, authToken }) => {
                let lines: CartLine[];
                let expected: ExpectedTotals;
                let cartId: string;
                let invoiceNumber: string;
                let invoice: InvoiceRef;

                await test.step('GIVEN products picked from the live catalog', async () => {
                    lines = scenario.lines(await fetchCatalog(apiRequest));
                    expected = expectedTotals(lines);
                });

                await test.step('AND a cart seeded with them via the API', async () => {
                    cartId = await createCart(apiRequest, lines);
                });

                await test.step('AND the cart handed to the browser', async () => {
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
                    await expect(checkoutPage.lineTitles).toHaveCount(
                        lines.length
                    );

                    for (const { product, quantity } of lines) {
                        await expect(
                            checkoutPage.linePriceIn(
                                checkoutPage.cartRow(product.name)
                            )
                        ).toHaveText(
                            `$${roundToCents(product.price * quantity).toFixed(2)}`
                        );
                    }
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
                        BILLING_LOOKUP.countryCode,
                        BILLING_LOOKUP.postcode,
                        BILLING_LOOKUP.houseNumber
                    );
                    await checkoutPage.payAndConfirm(
                        PaymentMethods.CASH_ON_DELIVERY
                    );
                    invoiceNumber = await checkoutPage.confirmedInvoiceNumber();
                });

                await test.step('THEN the confirmed invoice number belongs to the customer', async () => {
                    const { status, body } = await apiRequest({
                        method: 'GET',
                        url: `${ApiEndpoints.INVOICES_SEARCH}?q=${invoiceNumber}`,
                        baseUrl: requireEnv('API_URL'),
                        headers: authToken,
                    });

                    expect(status).toBe(200);
                    expect(InvoicePageProjection.parse(body)).toBeTruthy();
                    const matches = InvoicePageProjection.parse(
                        body
                    ).data.filter(
                        (candidate) =>
                            candidate.invoice_number === invoiceNumber
                    );
                    expect(
                        matches,
                        `Expected exactly one invoice ${invoiceNumber} for the customer -- more than one means another order got the same number (see the numbering test in checkoutTotals.spec.ts)`
                    ).toHaveLength(1);
                    invoice = matches[0];
                    createdInvoiceIds.push(invoice.id);
                });

                await test.step('AND it charges exactly the total the cart showed', async () => {
                    const { status, body } = await apiRequest({
                        method: 'GET',
                        url: `${ApiEndpoints.INVOICES}/${invoice.id}`,
                        baseUrl: requireEnv('API_URL'),
                        headers: authToken,
                    });

                    expect(status).toBe(200);
                    expect(InvoiceTotalsProjection.parse(body)).toBeTruthy();
                    const totals = InvoiceTotalsProjection.parse(body);
                    expect(totals.subtotal).toBe(expected.subtotal);
                    expect(totals.total).toBe(expected.total);
                });
            }
        );
    }
});
