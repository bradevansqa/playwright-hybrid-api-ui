import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/app/app';
import { Roles } from '../../../enums/util/roles';
import { CurrentUserResponseSchema } from '../../../fixtures/api/schemas/app/userSchema';
import { requireEnv } from '../../../helpers/util/requireEnv';

/**
 * Role-based access control on the API.
 *
 * Observed status codes (verified live against both accounts before these
 * assertions were written):
 *
 * | call                            | no token | customer | admin |
 * | ------------------------------- | -------- | -------- | ----- |
 * | GET /users                      | 401      | 403      | 200   |
 * | GET /reports/total-sales-of-... | 401      | 403      | 200   |
 * | GET /reports/top10-purchased... | 401      | 403      | 200   |
 * | DELETE /products/{nonexistent}  | 401      | 403      | 404   |
 *
 * Toolshop distinguishes the two failure modes correctly -- 401 for a missing
 * token, 403 for a valid token without the role -- so every denial below
 * asserts 403 exactly. A 401 here would mean the customer session was never
 * authenticated at all, which is a different (and worse) test result than
 * "correctly forbidden".
 *
 * Spec discrepancy (per `api-testing` Phase 7, point 5 -- assert the real
 * status code, note the divergence): 403 is documented for none of these
 * endpoints in the OpenAPI spec at https://api.practicesoftwaretesting.com/docs.
 * It lists 200/400/401 for `GET /users`, 200/401/404 for the reports, and
 * 204/401/404/405/409/422 for `DELETE /products/{productId}`. The role-based
 * refusal the app actually implements is simply undocumented -- worth
 * reporting upstream, not worth asserting 401 we do not get.
 *
 * Each test is shaped as: prove the session is really the customer, then
 * assert the denial, then prove the same call succeeds as admin. Without that
 * last step a 403 could equally mean the endpoint is broken for everybody.
 *
 * Read-only by design: the two denial-only DELETE calls target an id that
 * does not exist, and Toolshop checks authorisation before existence (hence
 * 404 rather than 200 for the admin control), so nothing is ever deleted.
 */

/** Admin-only read endpoints: customer 403, admin 200. */
const ADMIN_ONLY_READS = [
    { description: 'the user list', url: ApiEndpoints.USERS },
    {
        description: 'the total-sales report',
        url: ApiEndpoints.REPORTS_TOTAL_SALES_OF_YEARS,
    },
    {
        description: 'the top-10-products report',
        url: ApiEndpoints.REPORTS_TOP10_PURCHASED_PRODUCTS,
    },
] as const;

/**
 * Admin-only writes, aimed at ids that do not exist so the call can never
 * destroy anything. Admin's control is 404 (past authorisation, nothing to
 * act on) rather than 200.
 */
const NONEXISTENT_ID = 'does-not-exist-12345';
const ADMIN_ONLY_DELETES = [
    {
        description: 'a product',
        url: `${ApiEndpoints.PRODUCTS}/${NONEXISTENT_ID}`,
    },
    { description: 'a brand', url: `${ApiEndpoints.BRANDS}/${NONEXISTENT_ID}` },
] as const;

test.describe('api role-based access', () => {
    test.use({ role: Roles.CUSTOMER });

    for (const endpoint of ADMIN_ONLY_READS) {
        test(
            `should forbid a customer from reading ${endpoint.description}`,
            { tag: '@api' },
            async ({ apiRequest, authToken, tokenFor }) => {
                await test.step('GIVEN the token really belongs to the customer', async () => {
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
                    // Customers get no `role` field at all; admins get "admin".
                    expect(me.role).toBeUndefined();
                });

                await test.step(`WHEN the customer reads ${endpoint.url} THEN it is forbidden`, async () => {
                    const { status } = await apiRequest({
                        method: 'GET',
                        url: endpoint.url,
                        baseUrl: requireEnv('API_URL'),
                        headers: authToken,
                    });

                    expect(status).toBe(403);
                });

                await test.step('AND an admin reading the same endpoint succeeds', async () => {
                    const { status } = await apiRequest({
                        method: 'GET',
                        url: endpoint.url,
                        baseUrl: requireEnv('API_URL'),
                        headers: await tokenFor(Roles.ADMIN),
                    });

                    expect(status).toBe(200);
                });
            }
        );
    }

    for (const endpoint of ADMIN_ONLY_DELETES) {
        test(
            `should forbid a customer from deleting ${endpoint.description}`,
            { tag: '@api' },
            async ({ apiRequest, authToken, tokenFor }) => {
                await test.step('GIVEN the token really belongs to the customer', async () => {
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
                    expect(me.role).toBeUndefined();
                });

                await test.step(`WHEN the customer deletes ${endpoint.url} THEN it is forbidden`, async () => {
                    const { status } = await apiRequest({
                        method: 'DELETE',
                        url: endpoint.url,
                        baseUrl: requireEnv('API_URL'),
                        headers: authToken,
                    });

                    expect(status).toBe(403);
                });

                await test.step('AND an admin reaches past authorisation to a 404', async () => {
                    const { status } = await apiRequest({
                        method: 'DELETE',
                        url: endpoint.url,
                        baseUrl: requireEnv('API_URL'),
                        headers: await tokenFor(Roles.ADMIN),
                    });

                    // 404, not 200: authorisation is checked before existence,
                    // which is exactly why a nonexistent id is a safe target.
                    expect(status).toBe(404);
                });
            }
        );
    }

    /*
     * Broken access control: `GET /users` correctly answers 403 to a customer,
     * but `GET /users/search` returns 200 with the same user records -- other
     * people's names, emails, dates of birth and addresses. Verified live: a
     * customer token on `?q=doe` returned 4 users, 3 of them strangers.
     *
     * Asserted as it *should* behave (403, consistent with GET /users) and
     * marked `test.fail()` so it documents the flaw without going red, and
     * starts failing loudly -- prompting removal of `test.fail()` -- if it is
     * ever fixed. Same convention as tests/app/api/invoice.spec.ts.
     */
    test.fail(
        'should forbid a customer from searching users',
        { tag: '@api' },
        async ({ apiRequest, authToken, tokenFor }) => {
            const searchUrl = `${ApiEndpoints.USERS_SEARCH}?q=doe`;

            await test.step('GIVEN the token really belongs to the customer', async () => {
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
                expect(me.role).toBeUndefined();
            });

            await test.step('AND the customer is forbidden from the plain user list', async () => {
                const { status } = await apiRequest({
                    method: 'GET',
                    url: ApiEndpoints.USERS,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                });

                expect(status).toBe(403);
            });

            await test.step('AND an admin can search users', async () => {
                const { status } = await apiRequest({
                    method: 'GET',
                    url: searchUrl,
                    baseUrl: requireEnv('API_URL'),
                    headers: await tokenFor(Roles.ADMIN),
                });

                expect(status).toBe(200);
            });

            await test.step('THEN the customer should be forbidden from searching users too (currently is not)', async () => {
                const { status } = await apiRequest({
                    method: 'GET',
                    url: searchUrl,
                    baseUrl: requireEnv('API_URL'),
                    headers: authToken,
                });

                expect(status).toBe(403);
            });
        }
    );
});
