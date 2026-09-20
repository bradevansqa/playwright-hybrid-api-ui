import { chromium, expect } from '@playwright/test';
import { ApiEndpoints } from '../../enums/app/app';
import { Roles } from '../../enums/util/roles';
import { AppPage } from '../../pages/app/app.page';
import { ApiRequestFn } from '../../fixtures/api/api-types';
import { apiRequest } from '../../fixtures/api/plain-function';
import {
    CurrentUserResponseSchema,
    UserResponse,
    UserResponseSchema,
} from '../../fixtures/api/schemas/app/userSchema';
import { requireEnv } from '../util/requireEnv';
import { readSessionAuthToken } from './session';
import {
    AuthenticatedRole,
    credentialsFor,
    storageStatePathFor,
} from './roleAuth';

/**
 * Logs in through the UI as the given role and saves that session's browser
 * storage state, so tests can start already authenticated as that role.
 *
 * Each role gets its own file (see `storageStatePathFor`); the `role` fixture
 * picks the right one, so a spec switches role with a single `test.use()`.
 *
 * The session's identity is confirmed against the role's own email *before*
 * anything is written, because the shared demo instance has been observed
 * handing a browser the wrong user's session: roughly one full-suite run in
 * three, a login submitting the customer's credentials came back as the admin
 * (reproduced with a burst of concurrent admin logins alongside a single
 * customer UI login). Writing that file would quietly hand every
 * `role: CUSTOMER` spec an admin session, so the check fails setup instead --
 * loudly, and with nothing mislabelled left on disk for the next run to pick
 * up.
 *
 * @param {AuthenticatedRole} [role=Roles.ADMIN] - Role to log in as.
 * @returns {Promise<void>} Resolves when storage state is saved.
 * @throws {Error} If the resulting session belongs to a different user.
 *
 * @example
 * ```ts
 * // In auth.setup.ts
 * await createAppStorageState(Roles.CUSTOMER);
 * ```
 */
export async function createAppStorageState(
    role: AuthenticatedRole = Roles.ADMIN
): Promise<void> {
    const { email, password } = credentialsFor(role);
    const browser = await chromium.launch();

    // finally, not a trailing close(): the identity check below is meant to
    // throw, and a failed login can too -- neither should leak a browser.
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        const appPage = new AppPage(page);

        await appPage.openLoginPage();
        await appPage.loginAndVerify(email, password);

        const { status, body } = await apiRequest({
            request: page.request,
            method: 'GET',
            url: ApiEndpoints.CURRENT_USER,
            baseUrl: requireEnv('API_URL'),
            headers: await readSessionAuthToken(page),
        });

        expect(
            status,
            `Could not read back the session created for role "${role}".`
        ).toBe(200);

        const session = CurrentUserResponseSchema.parse(body);

        expect(
            session.email,
            `Logged in as "${email}" for role "${role}", but the resulting session belongs to "${session.email}". The shared Toolshop instance can hand back another user's session under concurrent logins -- no storage state was written. Re-run; if it persists, the instance is the suspect, not this suite.`
        ).toBe(email);

        await context.storageState({ path: storageStatePathFor(role) });
    } finally {
        await browser.close();
    }
}

/**
 * Authenticates via API and stores the access token in environment variables.
 * Use this for API tests that require authentication headers.
 *
 * The token is stored in `process.env.ACCESS_TOKEN` and can be used
 * with the `headers` parameter in API requests.
 *
 * @param {ApiRequestFn} apiRequest - The API request function from fixtures.
 * @returns {Promise<void>} Resolves when token is stored.
 *
 * @example
 * ```ts
 * // In auth.setup.ts
 * test('Setup API authentication', async ({ apiRequest }) => {
 *   await setUserAccessToken(apiRequest);
 * });
 *
 * // In API tests
 * const { status, body } = await apiRequest<UserData>({
 *   method: 'GET',
 *   url: '/users/me',
 *   baseUrl: process.env.API_URL,
 *   headers: process.env.ACCESS_TOKEN,
 * });
 * ```
 */
export async function setUserAccessToken(
    apiRequest: ApiRequestFn
): Promise<void> {
    const { status, body } = await apiRequest<UserResponse>({
        method: 'POST',
        url: ApiEndpoints.LOGIN,
        baseUrl: process.env.API_URL,
        body: {
            email: process.env.APP_EMAIL,
            password: process.env.APP_PASSWORD,
        },
    });

    expect(status).toBe(200);
    expect(UserResponseSchema.parse(body)).toBeTruthy();

    process.env['ACCESS_TOKEN'] = body.access_token;
}
