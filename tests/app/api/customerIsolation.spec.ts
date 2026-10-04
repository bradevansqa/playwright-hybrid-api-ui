import { generateStatusMessage } from '../../../test-data/factories/app/invoice.factory';
import { expect, test } from '../../../fixtures/pom/test-options';
import {
    ApiEndpoints,
    ApiEndpointSuffixes,
    InvoiceNumberFormat,
    InvoiceStatus,
} from '../../../enums/app/app';
import { Roles } from '../../../enums/util/roles';
import { CurrentUserResponseSchema } from '../../../fixtures/api/schemas/app/userSchema';
import {
    InvoicePageProjection,
    InvoiceRef,
    InvoiceStatusProjection,
} from '../../../fixtures/api/schemas/app/invoiceSchema';
import {
    NotFoundResponseSchema,
    UserNotFoundResponseSchema,
} from '../../../fixtures/api/schemas/util/errorResponseSchema';
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
 *
 * Invoice responses are parsed with the projections from invoiceSchema.ts
 * (see its live-drift note): the full contract schema rejects every live
 * invoice, and that drift is asserted in invoice.spec.ts.
 */

/**
 * Path-parameter fuzz values (api-testing: fuzz every path parameter).
 * Field-specific to these id parameters, so inline.
 */
const INVALID_PATH_IDS = [
    { description: 'numeric string', value: '99999' },
    { description: 'boolean-like string', value: 'true' },
    { description: 'special characters', value: '<script>' },
    { description: 'SQL injection attempt', value: '1 OR 1=1' },
    {
        description: 'well-formed but unknown ULID',
        value: '01ZZZZZZZZZZZZZZZZZZZZZZZZ',
    },
] as const;

/**
 * Resolves the user behind a token, asserting it is the expected account.
 * Makes exactly one API call, so callers wrap it in one `test.step`.
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
    expect(CurrentUserResponseSchema.parse(body)).toBeTruthy();
    const me = CurrentUserResponseSchema.parse(body);
    expect(me.email).toBe(expectedEmail);

    return me.id;
}

/**
 * Returns one invoice owned by the caller, read from their own invoice list.
 * Makes exactly one API call, so callers wrap it in one `test.step`.
 *
 * @param {ApiRequestFn} apiRequest - The apiRequest fixture.
 * @param {string} token - The owner's bearer token.
 * @returns {Promise<InvoiceRef>} An invoice the owner can see.
 */
async function anOwnInvoice(
    apiRequest: ApiRequestFn,
    token: string
): Promise<InvoiceRef> {
    const { status, body } = await apiRequest({
        method: 'GET',
        url: ApiEndpoints.INVOICES,
        baseUrl: requireEnv('API_URL'),
        headers: token,
    });

    expect(status).toBe(200);
    expect(InvoicePageProjection.parse(body)).toBeTruthy();
    const page = InvoicePageProjection.parse(body);
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
            let otherToken: string;
            let ownerId: string;
            let invoice: InvoiceRef;

            await test.step('GIVEN a token for the second customer', async () => {
                otherToken = await tokenFor(Roles.SECOND_CUSTOMER);
            });

            await test.step('AND the first token belongs to the customer', async () => {
                ownerId = await userIdFor(
                    apiRequest,
                    authToken,
                    requireEnv('CUSTOMER_EMAIL')
                );
            });

            await test.step('AND the second token belongs to a different customer', async () => {
                const otherId = await userIdFor(
                    apiRequest,
                    otherToken,
                    requireEnv('CUSTOMER2_EMAIL')
                );
                expect(otherId).not.toBe(ownerId);
            });

            await test.step('AND the customer has an invoice', async () => {
                invoice = await anOwnInvoice(apiRequest, authToken);
            });

            await test.step('AND the owner can read it', async () => {
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
            let otherToken: string;
            let otherId: string;
            let results: InvoiceRef[];

            await test.step('GIVEN a token for the second customer', async () => {
                otherToken = await tokenFor(Roles.SECOND_CUSTOMER);
            });

            await test.step('AND it belongs to the second customer', async () => {
                otherId = await userIdFor(
                    apiRequest,
                    otherToken,
                    requireEnv('CUSTOMER2_EMAIL')
                );
            });

            await test.step('WHEN they search for every invoice number', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.INVOICES_SEARCH}?q=${InvoiceNumberFormat.PREFIX}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: otherToken,
                });

                expect(status).toBe(200);
                expect(InvoicePageProjection.parse(body)).toBeTruthy();
                results = InvoicePageProjection.parse(body).data;
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
            let otherToken: string;
            let ownerId: string;

            await test.step('GIVEN the token belongs to the customer', async () => {
                ownerId = await userIdFor(
                    apiRequest,
                    authToken,
                    requireEnv('CUSTOMER_EMAIL')
                );
            });

            await test.step('AND the owner can read their own profile', async () => {
                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.USERS}/${ownerId}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                });

                expect(status).toBe(200);
            });

            await test.step('AND a token for the second customer', async () => {
                otherToken = await tokenFor(Roles.SECOND_CUSTOMER);
            });

            await test.step('WHEN the other customer reads it THEN it is not found', async () => {
                // Same body as for an id that does not exist at all, so it
                // does not leak which ids are real -- see
                // UserNotFoundResponseSchema for the odd error shape.
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.USERS}/${ownerId}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: otherToken,
                });

                expect(status).toBe(404);
                expect(UserNotFoundResponseSchema.parse(body)).toBeTruthy();
            });
        }
    );

    test(
        "should not let one customer update another customer's profile",
        { tag: '@api' },
        async ({ apiRequest, authToken, tokenFor }) => {
            let otherToken: string;
            let ownerId: string;
            let unchangedName: { first_name: string };

            await test.step('GIVEN the customer reads their current first name', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: ApiEndpoints.CURRENT_USER,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                });

                expect(status).toBe(200);
                expect(CurrentUserResponseSchema.parse(body)).toBeTruthy();
                const me = CurrentUserResponseSchema.parse(body);
                expect(me.email).toBe(requireEnv('CUSTOMER_EMAIL'));
                ownerId = me.id;
                // Re-sending the current value: even if the denial below
                // ever regresses, no profile is actually modified.
                unchangedName = { first_name: me.first_name };
            });

            await test.step('AND the owner can PATCH their own profile with it', async () => {
                const { status } = await apiRequest({
                    method: 'PATCH',
                    url: `${ApiEndpoints.USERS}/${ownerId}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                    body: unchangedName,
                });

                expect(status).toBe(200);
            });

            await test.step('AND a token for the second customer', async () => {
                otherToken = await tokenFor(Roles.SECOND_CUSTOMER);
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

    for (const { description, value } of INVALID_PATH_IDS) {
        test(
            `should not find an invoice, its PDF or a user for an invalid id - ${description}`,
            { tag: '@api' },
            async ({ apiRequest, authToken }) => {
                const id = encodeURIComponent(value);

                await test.step('WHEN the customer reads an invoice by that id THEN it is not found', async () => {
                    const { status, body } = await apiRequest({
                        method: 'GET',
                        url: `${ApiEndpoints.INVOICES}/${id}`,
                        baseUrl: requireEnv('API_URL'),
                        headers: authToken,
                    });

                    expect(status).toBe(404);
                    expect(NotFoundResponseSchema.parse(body)).toBeTruthy();
                });

                await test.step('AND its PDF is not found', async () => {
                    const { status, body } = await apiRequest({
                        method: 'GET',
                        url: `${ApiEndpoints.INVOICES}/${id}${ApiEndpointSuffixes.DOWNLOAD_PDF}`,
                        baseUrl: requireEnv('API_URL'),
                        headers: authToken,
                    });

                    expect(status).toBe(404);
                    expect(NotFoundResponseSchema.parse(body)).toBeTruthy();
                });

                await test.step('AND a user with that id is not found', async () => {
                    const { status, body } = await apiRequest({
                        method: 'GET',
                        url: `${ApiEndpoints.USERS}/${id}`,
                        baseUrl: requireEnv('API_URL'),
                        headers: authToken,
                    });

                    expect(status).toBe(404);
                    expect(UserNotFoundResponseSchema.parse(body)).toBeTruthy();
                });
            }
        );
    }

    /*
     * FIXME: no ticket yet -- broken object-level authorisation, to report
     * upstream. `GET /invoices/{id}` correctly hides another customer's
     * invoice (404), but the PDF of that same invoice is served to any
     * logged-in customer who knows its invoice number -- the customer's
     * name, billing address and order lines. Invoice numbers are sequential,
     * so they are trivially guessable.
     *
     * Asserted as it should behave and marked `test.fail()` rather than
     * `test.skip` (repo convention, see roleAccess.spec.ts): it keeps running,
     * stays green while the flaw exists, and fails loudly -- prompting
     * removal of `test.fail()` -- once fixed. The PDF body itself is never
     * read, so no customer data lands in the report.
     */
    test.fail(
        "should not let one customer download another customer's invoice PDF",
        { tag: '@api' },
        async ({ apiRequest, authToken, tokenFor }) => {
            let otherToken: string;
            let invoice: InvoiceRef;

            await test.step('GIVEN the customer has an invoice', async () => {
                invoice = await anOwnInvoice(apiRequest, authToken);
            });

            await test.step('AND the owner can download its PDF', async () => {
                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.INVOICES}/${invoice.invoice_number}${ApiEndpointSuffixes.DOWNLOAD_PDF}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                });

                expect(status).toBe(200);
            });

            await test.step('AND a token for the second customer', async () => {
                otherToken = await tokenFor(Roles.SECOND_CUSTOMER);
            });

            await test.step('AND it belongs to a different customer', async () => {
                await userIdFor(
                    apiRequest,
                    otherToken,
                    requireEnv('CUSTOMER2_EMAIL')
                );
            });

            await test.step('WHEN the other customer requests the same PDF THEN it should not be found (currently is served)', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.INVOICES}/${invoice.invoice_number}${ApiEndpointSuffixes.DOWNLOAD_PDF}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: otherToken,
                });

                expect(status).toBe(404);
                expect(NotFoundResponseSchema.parse(body)).toBeTruthy();
            });
        }
    );

    /*
     * FIXME: no ticket yet -- broken authorisation on writes, to report
     * upstream. `PUT /invoices/{id}/status` is an admin operation (the admin
     * "Edit Order" screen), yet a customer token changes the status of an
     * invoice the customer does not own -- here, an admin-owned invoice from
     * `seededInvoice`, whose teardown reverts the status whether or not this
     * test changed it. `test.fail()` per the convention above.
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
                    url: `${ApiEndpoints.INVOICES}/${seededInvoice.id}${ApiEndpointSuffixes.STATUS}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                    body: {
                        status: InvoiceStatus.ON_HOLD,
                        status_message: generateStatusMessage(),
                    },
                });

                expect(status).toBe(404);
            });

            let adminToken: string;

            await test.step('AND an admin token', async () => {
                adminToken = await tokenFor(Roles.ADMIN);
            });

            await test.step('AND the admin sees the status unchanged', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.INVOICES}/${seededInvoice.id}`,
                    baseUrl: requireEnv('API_URL'),
                    headers: adminToken,
                });

                expect(status).toBe(200);
                expect(InvoiceStatusProjection.parse(body)).toBeTruthy();
                expect(InvoiceStatusProjection.parse(body).status).toBe(
                    seededInvoice.status
                );
            });
        }
    );
});
