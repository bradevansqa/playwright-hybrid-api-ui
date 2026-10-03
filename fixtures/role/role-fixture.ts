import * as fs from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { apiRequest } from '../api/plain-function';
import { ApiEndpoints } from '../../enums/app/app';
import { Roles } from '../../enums/util/roles';
import { UserResponseSchema } from '../api/schemas/app/userSchema';
import {
    ApiRole,
    AuthenticatedRole,
    credentialsFor,
    storageStatePathFor,
} from '../../helpers/app/roleAuth';
import { requireEnv } from '../../helpers/util/requireEnv';

/**
 * Role selection for a spec file.
 *
 * `role` is a Playwright *option*, so a whole file (or describe block)
 * switches identity with one line:
 *
 * ```ts
 * test.use({ role: Roles.CUSTOMER });
 * ```
 *
 * Both the browser session (`storageState`) and the API token (`authToken`)
 * are derived from it, so UI and API calls in that file always act as the
 * same person. Default is `Roles.ADMIN`, which is what every pre-existing
 * spec already assumed.
 */
export type RoleOptions = {
    role: AuthenticatedRole;
};

export type RoleFixtures = {
    /**
     * Mints a fresh API token for any role on demand. Tests use this for the
     * *other* role -- e.g. proving an admin-only endpoint answers 200 for an
     * admin, so a customer's 403 means "forbidden", not "endpoint broken".
     */
    tokenFor: (role: ApiRole) => Promise<string>;
    /** API token for the role the current spec runs as. */
    authToken: string;
};

export const test = base.extend<RoleOptions & RoleFixtures>({
    role: [Roles.ADMIN, { option: true }],

    storageState: async ({ role }, use) => {
        /*
         * Only hand over a storage state that exists on disk. Playwright's
         * built-in `request` fixture consumes this option too, not just
         * browser contexts, so an unconditional path breaks two legitimate
         * cases: the `api` project (no browser, and no `dependencies:
         * ['setup']`, so role storage states were never written) and the
         * setup project itself on a clean checkout, where these files are
         * the output being created.
         *
         * A UI test that silently lost its session does not slip through:
         * the admin spec asserts admin content renders, and the customer
         * spec proves the session's identity from its own JWT before
         * asserting any denial, so both fail loudly instead of passing as an
         * anonymous visitor.
         */
        const storageStatePath = storageStatePathFor(role);

        await use(
            fs.existsSync(storageStatePath) ? storageStatePath : undefined
        );
    },

    tokenFor: async ({ request }, use) => {
        /*
         * Tokens are minted per test rather than read from an env var set by
         * `auth.setup.ts`. Two reasons, both verified: env vars set in a
         * setup project only reach projects that declare
         * `dependencies: ['setup']` (the `api` project does not, which is
         * what CI runs), and Toolshop tokens expire after 300s -- long
         * enough for a setup-time token to die mid-suite.
         */
        await use(async (role: ApiRole): Promise<string> => {
            const { status, body } = await apiRequest({
                request,
                method: 'POST',
                url: ApiEndpoints.LOGIN,
                baseUrl: requireEnv('API_URL'),
                body: credentialsFor(role),
            });

            expect(
                status,
                `Login failed for role "${role}" -- check its credentials in env/.env.*`
            ).toBe(200);

            return UserResponseSchema.parse(body).access_token;
        });
    },

    authToken: async ({ tokenFor, role }, use) => {
        await use(await tokenFor(role));
    },
});
