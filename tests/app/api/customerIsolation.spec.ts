import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';
import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints, InvoiceStatus } from '../../../enums/app/app';
import { Roles } from '../../../enums/util/roles';
import { CurrentUserResponseSchema } from '../../../fixtures/api/schemas/app/userSchema';
import { NotFoundResponseSchema } from '../../../fixtures/api/schemas/util/errorResponseSchema';
import { requireEnv } from '../../../helpers/util/requireEnv';
import type { ApiRequestFn } from '../../../fixtures/api/api-types';

/**
 * Cross-customer isolation: one customer must not be able to read or change
 * another customer's data (broken object-level authorisation, OWASP API1).
 *
 * Observed behaviour (verified live with two customer accounts before these
 * assertions were written):
 *
 * | call by the *other* customer                    | status | correct? |
 * | ----------------------------------------------- | ------ | -------- |
 * | GET /invoices/{id}                              | 404    | yes      |
 * | GET /invoices/search                            | own    | yes      |
 * | GET /users/{id}                                 | 404    | yes      |
 * | PATCH /users/{id}                               | 403    | yes      |
 * | GET /invoices/{invoice_number}/download-pdf     | 200    | **no**   |
 * | PUT /invoices/{id}/status                       | 200    | **no**   |
 *
 * Expected status for the two flaws is 404, matching how the API already
 * answers a foreign `GET /invoices/{id}` -- it hides the invoice's existence
 * rather than confirming it with a 403.
 *
 * Every denial is paired with the owner making the same call successfully,
 * so a denial proves isolation rather than a broken endpoint.
 *
 * Nothing here changes data: the profile PATCH re-sends the owner's current
 * first name, and the invoice status change targets the `seededInvoice`
 * fixture, whose teardown restores the original status.
 */

/** Minimal local schemas: only the fields these tests consume. */
const InvoiceSummarySchema = z.looseObject({
    id: z.string(),
    invoice_number: z.string(),
    user_id: z.string(),
});

const InvoicePageSchema = z.looseObject({
    data: z.array(InvoiceSummarySchema),
    total: z.int(),
});

const InvoiceStatusSchema = z.looseObject({
    id: z.string(),
    status: z.string(),
});

type InvoiceSummary = zOutput<typeof InvoiceSummarySchema>;

/**
 * Resolves the user behind a token, asserting it is the expected account.
 *
 * @param {ApiRequestFn} apiRequest - The apiRequest fixture.
 * @param {string} token - Bearer token to identify.
 * @param {string} expectedEmail - Email the token must belong to.
 * @returns {Promise<string>} The user's id.
 */
async function userIdFor(
    apiRequest: ApiRequestFn,
    token: string,
    expectedEmail: string
): Promise<string> {
    const { status, body } = await apiRequest({
        method: 'GET',
        url: ApiEndpoints.CURRENT_USER,
        baseUrl: requireEnv('API_URL'),
        headers: token,
    });

    expect(status).toBe(200);
    const me = CurrentUserResponseSchema.parse(body);
    expect(me.email).toBe(expectedEmail);

    return me.id;
}

/**
 * Returns one invoice owned by the caller, read from their own invoice list.
 *
 * @param {ApiRequestFn} apiRequest - The apiRequest fixture.
 * @param {string} token - The owner's bearer token.
 * @returns {Promise<InvoiceSummary>} An invoice the owner can see.
 */
async function anOwnInvoice(
    apiRequest: ApiRequestFn,
    token: string
): Promise<InvoiceSummary> {
    const { status, body } = await apiRequest({
        method: 'GET',
        url: ApiEndpoints.INVOICES,
        baseUrl: requireEnv('API_URL'),
        headers: token,
    });

    expect(status).toBe(200);
    const page = InvoicePageSchema.parse(body);
    expect(
        page.total,
        'The customer account needs at least one invoice'
    ).toBeGreaterThan(0);

    return page.data[0];
}

test.describe('api cross-customer isolation', () => {
    test.use({ role: Roles.CUSTOMER });

    test(
        "should not let one customer read another customer's invoice",
        { tag: '@api' },
        async ({ apiRequest, authToken, tokenFor }) => {
            const otherToken = await tokenFor(Roles.SECOND_CUSTOMER);
            let invoice: InvoiceSummary;

            await test.step('GIVEN two tokens that belong to two different customers', async () => {
                const ownerId = await userIdFor(
                    apiRequest,
                    authToken,
                    requireEnv('CUSTOMER_EMAIL')
                );
                const otherId = await userIdFor(
                    apiRequest,
                    otherToken,
                    requireEnv('CUSTOMER2_EMAIL')
                );
                expect(otherId).not.toBe(ownerId);
            });

            await test.step('AND the owner can read one of their invoices', async () => {
                invoice = await anOwnInvoice(apiRequest, authToken);

                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.INVOICES}/${invoice.id}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                });

                expect(status).toBe(200);
            });

            await test.step('WHEN the other customer reads it THEN it is not found', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.INVOICES}/${invoice.id}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: otherToken,
                });

                expect(status).toBe(404);
                expect(NotFoundResponseSchema.parse(body)).toBeTruthy();
            });
        }
    );

    test(
        "should only return a customer's own invoices from invoice search",
        { tag: '@api' },
        async ({ apiRequest, tokenFor }) => {
            const otherToken = await tokenFor(Roles.SECOND_CUSTOMER);
            let otherId: string;

            await test.step('GIVEN the token belongs to the second customer', async () => {
                otherId = await userIdFor(
                    apiRequest,
                    otherToken,
                    requireEnv('CUSTOMER2_EMAIL')
                );
            });

            let results: InvoiceSummary[];

            await test.step('WHEN they search across all invoice numbers', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.INVOICES_SEARCH}?q=INV`,
                    baseUrl: requireEnv('API_URL'),
                    headers: otherToken,
                });

                expect(status).toBe(200);
                results = InvoicePageSchema.parse(body).data;
            });

            await test.step('THEN results are returned', async () => {
                expect(results.length).toBeGreaterThan(0);
            });

            await test.step('AND every result belongs to them', async () => {
                for (const invoice of results) {
                    expect(invoice.user_id).toBe(otherId);
                }
            });
        }
    );

    test(
        "should not let one customer read another customer's profile",
        { tag: '@api' },
        async ({ apiRequest, authToken, tokenFor }) => {
            const otherToken = await tokenFor(Roles.SECOND_CUSTOMER);
            let ownerId: string;

            await test.step('GIVEN the owner can read their own profile', async () => {
                ownerId = await userIdFor(
                    apiRequest,
                    authToken,
                    requireEnv('CUSTOMER_EMAIL')
                );

                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.USERS}/${ownerId}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                });

                expect(status).toBe(200);
            });

            await test.step('WHEN the other customer reads it THEN it is not found', async () => {
                // The body is `{"error": "You are not authorized to view this
                // user."}` -- a 404 status worded like a 403, and a different
                // shape from the API's usual `{"message": ...}` 404. It is the
                // same body for a user id that does not exist at all, so it
                // does not leak which ids are real.
                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.USERS}/${ownerId}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: otherToken,
                });

                expect(status).toBe(404);
            });
        }
    );

    test(
        "should not let one customer update another customer's profile",
        { tag: '@api' },
        async ({ apiRequest, authToken, tokenFor }) => {
            const otherToken = await tokenFor(Roles.SECOND_CUSTOMER);
            let ownerId: string;
            let unchangedName: { first_name: string };

            await test.step('GIVEN the owner can PATCH their own profile with its current first name', async () => {
                const { status: meStatus, body: meBody } = await apiRequest({
                    method: 'GET',
                    url: ApiEndpoints.CURRENT_USER,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                });

                expect(meStatus).toBe(200);
                const me = CurrentUserResponseSchema.parse(meBody);
                expect(me.email).toBe(requireEnv('CUSTOMER_EMAIL'));
                ownerId = me.id;
                // Re-sending the current value: even if the denial below
                // ever regresses, no profile is actually modified.
                unchangedName = { first_name: me.first_name };

                const { status } = await apiRequest({
                    method: 'PATCH',
                    url: `${ApiEndpoints.USERS}/${ownerId}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                    body: unchangedName,
                });

                expect(status).toBe(200);
            });

            await test.step('WHEN the other customer sends the same PATCH THEN it is forbidden', async () => {
                const { status } = await apiRequest({
                    method: 'PATCH',
                    url: `${ApiEndpoints.USERS}/${ownerId}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: otherToken,
                    body: unchangedName,
                });

                expect(status).toBe(403);
            });
        }
    );

    /*
     * Broken object-level authorisation: `GET /invoices/{id}` correctly hides
     * another customer's invoice (404), but the PDF of that same invoice is
     * served to any logged-in customer who knows its invoice number -- the
     * customer's name, billing address and order lines. Invoice numbers are
     * sequential (`INV-2026000002x`), so they are trivially guessable.
     *
     * Asserted as it should behave and marked `test.fail()`, the same
     * convention as roleAccess.spec.ts: it stays green while the flaw exists
     * and fails loudly -- prompting removal of `test.fail()` -- once fixed.
     * The PDF body itself is never read, so no customer data lands in the
     * report.
     */
    test.fail(
        "should not let one customer download another customer's invoice PDF",
        { tag: '@api' },
        async ({ apiRequest, authToken, tokenFor }) => {
            const otherToken = await tokenFor(Roles.SECOND_CUSTOMER);
            let invoice: InvoiceSummary;

            await test.step('GIVEN the owner can download the PDF of one of their invoices', async () => {
                invoice = await anOwnInvoice(apiRequest, authToken);

                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.INVOICES}/${invoice.invoice_number}/download-pdf`,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                });

                expect(status).toBe(200);
            });

            await test.step('AND the second token belongs to a different customer', async () => {
                await userIdFor(
                    apiRequest,
                    otherToken,
                    requireEnv('CUSTOMER2_EMAIL')
                );
            });

            await test.step('WHEN the other customer requests the same PDF THEN it should not be found (currently is served)', async () => {
                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.INVOICES}/${invoice.invoice_number}/download-pdf`,
                    baseUrl: requireEnv('API_URL'),
                    headers: otherToken,
                });

                expect(status).toBe(404);
            });
        }
    );

    /*
     * Broken authorisation on writes: `PUT /invoices/{id}/status` is an
     * admin operation (the admin "Edit Order" screen), yet a customer token
     * changes the status of an invoice the customer does not own -- here,
     * an admin-owned invoice from `seededInvoice`, whose teardown reverts
     * the status whether or not this test changed it.
     */
    test.fail(
        'should not let a customer change the status of an invoice they do not own',
        { tag: '@api' },
        async ({ apiRequest, authToken, tokenFor, seededInvoice }) => {
            await test.step('GIVEN an invoice owned by someone else', async () => {
                expect(seededInvoice.status).toBe(
                    InvoiceStatus.AWAITING_FULFILLMENT
                );
            });

            await test.step('AND the token belongs to the customer', async () => {
                await userIdFor(
                    apiRequest,
                    authToken,
                    requireEnv('CUSTOMER_EMAIL')
                );
            });

            await test.step('WHEN the customer sets its status to ON_HOLD THEN it should not be found (currently succeeds)', async () => {
                const { status } = await apiRequest({
                    method: 'PUT',
                    url: `${ApiEndpoints.INVOICES}/${seededInvoice.id}/status`,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                    body: {
                        status: InvoiceStatus.ON_HOLD,
                        status_message: 'Cross-customer isolation check',
                    },
                });

                expect(status).toBe(404);
            });

            await test.step('AND an admin sees the status unchanged', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.INVOICES}/${seededInvoice.id}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: await tokenFor(Roles.ADMIN),
                });

                expect(status).toBe(200);
                expect(InvoiceStatusSchema.parse(body).status).toBe(
                    seededInvoice.status
                );
            });
        }
    );
});
