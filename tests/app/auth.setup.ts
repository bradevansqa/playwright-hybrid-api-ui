/**
 * auth.setup.ts
 * Playwright setup script to generate storage states for authentication.
 *
 * This runs before the main test suite to:
 * 1. Authenticate via API and store access tokens
 * 2. Generate browser storage state with session cookies, one per role
 *
 * Note: API role tests mint their own tokens through the `role` fixture
 * rather than reading one from here -- env vars set in this project only
 * reach projects that declare `dependencies: ['setup']`, and the `api`
 * project (what CI runs) does not.
 */

import * as fs from 'node:fs';
import { expect, test } from '../../fixtures/pom/test-options';
import { StorageStatePaths } from '../../enums/app/app';
import { Roles } from '../../enums/util/roles';
import {
    createAppStorageState,
    setUserAccessToken,
} from '../../helpers/app/createStorageState';

test.describe('auth setup', () => {
    test('setup authentication - API token', async ({ apiRequest }) => {
        await setUserAccessToken(apiRequest);
        expect(process.env['ACCESS_TOKEN']).toBeDefined();
    });

    test('setup authentication - admin browser storage state', async () => {
        await createAppStorageState(Roles.ADMIN);
        expect(fs.existsSync(StorageStatePaths.ADMIN)).toBe(true);
    });

    test('setup authentication - customer browser storage state', async () => {
        await createAppStorageState(Roles.CUSTOMER);
        expect(fs.existsSync(StorageStatePaths.CUSTOMER)).toBe(true);
    });
});
