import { test as base, expect } from '@playwright/test';
import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';
import { apiRequest } from '../api/plain-function';
import { ApiEndpoints } from '../../enums/app/app';

/**
 * Helper fixtures for important, recurring API-driven setup and teardown.
 *
 * IMPORTANT: Most API calls should be made directly with the `apiRequest` fixture
 * inside tests, `beforeEach`, or `afterEach`. Do NOT create a helper fixture for
 * every endpoint. Helper fixtures are reserved for critical, multi-step operations
 * that are reused across many test files and benefit from automatic lifecycle management.
 *
 * WORKFLOW:
 * Playwright's fixture lifecycle guarantees:
 *   1. Setup code (before `use()`) runs BEFORE the test
 *   2. Data passed to `use()` is available in the test via destructuring
 *   3. Teardown code (after `use()`) runs AFTER the test, even on failure
 *
 * WHEN TO CREATE A HELPER FIXTURE:
 * - The same multi-step setup/teardown is copy-pasted across 3+ test files
 * - Complex preconditions require multiple API calls in sequence
 * - Guaranteed teardown is critical (e.g., deleting test users, revoking tokens)
 *
 * WHEN TO USE `apiRequest` FIXTURE DIRECTLY INSTEAD:
 * - One-off API calls in a single test or test file
 * - API assertions (status codes, response validation)
 * - Simple setup in `beforeEach` / teardown in `afterEach`
 * - Calls specific to a single test describe block
 *
 * HOW TO ADD A NEW HELPER FIXTURE:
 * 1. Define the return type (or use a Zod schema's inferred type)
 * 2. Add the type to `HelperFixtures` below
 * 3. Implement the fixture with the setup → use() → teardown pattern
 * 4. It is automatically available in tests (already merged in test-options.ts)
 *
 * NOTE: Helper fixtures use `plain-function.ts` internally (not the `apiRequest`
 * fixture) because fixture-level code needs the raw `request` context. Tests
 * themselves should always use the `apiRequest` fixture from `test-options.ts`.
 *
 * @example
 * ```ts
 * import { expect, test } from '../../../fixtures/pom/test-options';
 *
 * test('should display seeded invoice', async ({ seededInvoice, appPage }) => {
 *     // seededInvoice was set up before this test runs
 *     await appPage.navigateToInvoice(seededInvoice.id);
 *     // seededInvoice's status is reverted automatically after this test
 * });
 * ```
 */

// ==================== Types ====================

/**
 * Minimal local schemas for the multi-step API plumbing `seededInvoice`
 * needs (cart creation, cart item add, postcode lookup, product listing,
 * invoice creation/read). These intentionally assert only the fields this
 * fixture consumes -- not the full documented contracts. Promote to
 * `fixtures/api/schemas/app/` only if reused by 3+ files (see Phase 8 of
 * the `api-testing` skill).
 *
 * Live product and invoice responses both include fields absent from (or
 * missing fields present on) their documented OpenAPI schemas -- see the
 * FIXME banners in `fixtures/api/schemas/app/invoiceSchema.ts`. Those full
 * schemas are intentionally strict and reject live responses by design, so
 * this fixture deliberately does not reuse them here.
 */
const CartCreatedResponseSchema = z.strictObject({
    id: z.string(),
});

const CartItemAddedResponseSchema = z.strictObject({
    result: z.string(),
});

/**
 * The invoice API rejects a billing address whose city/country don't agree
 * (an undocumented cross-field check, not listed on `InvoiceRequest`) --
 * looking up a real address via this endpoint guarantees a self-consistent
 * pair instead of guessing one.
 */
const PostcodeLookupResponseSchema = z.strictObject({
    street: z.string(),
    house_number: z.string(),
    city: z.string(),
    state: z.string(),
    country: z.string(),
    postcode: z.string(),
});

const ProductListResponseSchema = z.looseObject({
    data: z.array(z.looseObject({ id: z.string() })),
});

const InvoiceCreatedResponseSchema = z.looseObject({
    id: z.string(),
});

const SeededInvoiceSchema = z.looseObject({
    id: z.string(),
    invoice_number: z.string(),
    status: z.string(),
});

/** Invoice fields yielded to a test by the `seededInvoice` fixture. */
type SeededInvoice = zOutput<typeof SeededInvoiceSchema>;

/**
 * Helper fixture type definitions.
 * Add new setup/teardown fixtures here as you create them.
 */
export type HelperFixtures = {
    /**
     * Seeds a real invoice via the API (as admin) before the test and
     * reverts its status after. See the fixture implementation below for
     * why teardown reverts rather than deletes.
     */
    seededInvoice: SeededInvoice;
};

// ==================== Fixtures ====================

export const test = base.extend<HelperFixtures>({
    /**
     * Seeds a real invoice via the API (as admin) before the test, and
     * reverts its status after.
     *
     * Teardown reverts rather than deletes because the Invoice API has no
     * DELETE endpoint -- verified against the OpenAPI spec: the `Invoice`
     * tag only exposes GET/POST/PUT/PATCH across every documented path.
     * Reverting the status to whatever it was right after creation is the
     * closest available cleanup to "undo what this fixture/test did".
     *
     * Setup chain (multi-step, hence a helper fixture rather than inline
     * `apiRequest` calls): fetch a product -> create a cart -> add the
     * product to the cart -> look up a self-consistent billing address ->
     * create the invoice -> read it back to capture the canonical initial
     * status used later for the teardown revert.
     *
     * @param {APIRequestContext} request - Playwright request context (injected automatically).
     * @param {function} use - Playwright fixture lifecycle callback.
     */
    seededInvoice: async ({ request }, use) => {
        // ── SETUP: Runs before the test ──────────────────────────────
        const { status: productsStatus, body: productsBody } = await apiRequest(
            {
                request,
                method: 'GET',
                url: `${ApiEndpoints.PRODUCTS}?page=1`,
                baseUrl: process.env.API_URL,
            }
        );

        expect(productsStatus).toBe(200);
        const { data: products } =
            ProductListResponseSchema.parse(productsBody);
        const [product] = products;

        const { status: cartStatus, body: cartBody } = await apiRequest({
            request,
            method: 'POST',
            url: ApiEndpoints.CARTS,
            baseUrl: process.env.API_URL,
        });

        expect(cartStatus).toBe(201);
        expect(CartCreatedResponseSchema.parse(cartBody)).toBeTruthy();
        const { id: cartId } = CartCreatedResponseSchema.parse(cartBody);

        const { status: addItemStatus, body: addItemBody } = await apiRequest({
            request,
            method: 'POST',
            url: `${ApiEndpoints.CARTS}/${cartId}`,
            baseUrl: process.env.API_URL,
            body: { product_id: product.id, quantity: 1 },
        });

        expect(addItemStatus).toBe(200);
        expect(CartItemAddedResponseSchema.parse(addItemBody)).toBeTruthy();

        // Fixed lookup key (not user-facing content) -- see PostcodeLookupResponseSchema
        // above for why a real lookup is used instead of a guessed address.
        const BILLING_COUNTRY = 'The Netherlands';
        const BILLING_POSTCODE = '1234AB';
        const { status: addressStatus, body: addressBody } = await apiRequest({
            request,
            method: 'GET',
            url: `${ApiEndpoints.POSTCODE_LOOKUP}?country=${encodeURIComponent(BILLING_COUNTRY)}&postcode=${encodeURIComponent(BILLING_POSTCODE)}`,
            baseUrl: process.env.API_URL,
        });

        expect(addressStatus).toBe(200);
        const address = PostcodeLookupResponseSchema.parse(addressBody);

        const { status: invoiceStatus, body: invoiceBody } = await apiRequest({
            request,
            method: 'POST',
            url: ApiEndpoints.INVOICES,
            baseUrl: process.env.API_URL,
            headers: process.env.ACCESS_TOKEN,
            body: {
                billing_street: `${address.street} ${address.house_number}`,
                billing_city: address.city,
                billing_state: address.state,
                billing_country: address.country,
                billing_postal_code: address.postcode,
                payment_method: 'cash-on-delivery',
                payment_details: {},
                cart_id: cartId,
            },
        });

        // OpenAPI documents 200; the live API returns 201 for a created
        // invoice (arguably more correct for a create operation) -- a
        // known spec/reality discrepancy, not adjusted to hide it.
        expect(invoiceStatus).toBe(201);
        const { id: invoiceId } =
            InvoiceCreatedResponseSchema.parse(invoiceBody);

        const { status: getStatus, body: getBody } = await apiRequest({
            request,
            method: 'GET',
            url: `${ApiEndpoints.INVOICES}/${invoiceId}`,
            baseUrl: process.env.API_URL,
            headers: process.env.ACCESS_TOKEN,
        });

        expect(getStatus).toBe(200);
        const invoice = SeededInvoiceSchema.parse(getBody);

        // ── YIELD: Passes data to the test ───────────────────────────
        await use(invoice);

        // ── TEARDOWN: Runs after the test (even on failure) ──────────
        const { status: revertStatus, body: revertBody } = await apiRequest({
            request,
            method: 'PUT',
            url: `${ApiEndpoints.INVOICES}/${invoice.id}/status`,
            baseUrl: process.env.API_URL,
            headers: process.env.ACCESS_TOKEN,
            body: {
                status: invoice.status,
                status_message: 'Reverted by seededInvoice fixture teardown',
            },
        });

        // The Status <select> in AdminOrderEditPage only exposes forward
        // transitions (current/earlier statuses are disabled options), but
        // that is a UI-only restriction -- confirmed the backend PUT accepts
        // and persists a backward status transition without complaint.
        expect(revertStatus).toBe(200);
        expect(revertBody).toEqual({ success: true });

        // Confirm the revert was actually persisted rather than trusting the
        // PUT's own echoed response -- a silent no-op here would leave the
        // invoice in the wrong status for whichever test runs against it next.
        const { status: verifyStatus, body: verifyBody } = await apiRequest({
            request,
            method: 'GET',
            url: `${ApiEndpoints.INVOICES}/${invoice.id}`,
            baseUrl: process.env.API_URL,
            headers: process.env.ACCESS_TOKEN,
        });

        expect(verifyStatus).toBe(200);
        const revertedInvoice = SeededInvoiceSchema.parse(verifyBody);
        expect(revertedInvoice.status).toBe(invoice.status);
    },
});
