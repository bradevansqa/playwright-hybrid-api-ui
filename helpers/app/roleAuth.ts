import { StorageStatePaths } from '../../enums/app/app';
import { Roles } from '../../enums/util/roles';
import { requireEnv } from '../util/requireEnv';

/**
 * Roles that have real credentials and a storage state behind them. The
 * other `Roles` members are app vocabulary, not test personas -- a test can
 * only run *as* one of these.
 */
export type AuthenticatedRole = Roles.ADMIN | Roles.CUSTOMER;

/**
 * Roles an API test can mint a token for. A superset of `AuthenticatedRole`:
 * `SECOND_CUSTOMER` has credentials but no browser storage state, because it
 * is only ever used as "some other customer" in cross-customer API checks.
 */
export type ApiRole = AuthenticatedRole | Roles.SECOND_CUSTOMER;

/** Login credentials for a role. */
export type RoleCredentials = {
    email: string;
    password: string;
};

/**
 * Single source of truth for which env vars belong to each role -- shared by
 * `auth.setup.ts` (which logs in to write storage states) and the `role`
 * fixture (which mints API tokens).
 */
const ROLE_CREDENTIAL_ENV: Record<
    ApiRole,
    { emailVar: string; passwordVar: string }
> = {
    [Roles.ADMIN]: { emailVar: 'APP_EMAIL', passwordVar: 'APP_PASSWORD' },
    [Roles.CUSTOMER]: {
        emailVar: 'CUSTOMER_EMAIL',
        passwordVar: 'CUSTOMER_PASSWORD',
    },
    [Roles.SECOND_CUSTOMER]: {
        emailVar: 'CUSTOMER2_EMAIL',
        passwordVar: 'CUSTOMER2_PASSWORD',
    },
};

/** Storage state file written for each browser-capable role. */
const ROLE_STORAGE_STATE: Record<AuthenticatedRole, StorageStatePaths> = {
    [Roles.ADMIN]: StorageStatePaths.ADMIN,
    [Roles.CUSTOMER]: StorageStatePaths.CUSTOMER,
};

/**
 * Resolves a role's login credentials from the environment.
 *
 * @param {ApiRole} role - The role to resolve credentials for.
 * @returns {RoleCredentials} The role's email and password.
 * @throws {Error} If either environment variable is unset.
 */
export function credentialsFor(role: ApiRole): RoleCredentials {
    const { emailVar, passwordVar } = ROLE_CREDENTIAL_ENV[role];

    return {
        email: requireEnv(emailVar),
        password: requireEnv(passwordVar),
    };
}

/**
 * Resolves the storage state file path for a role.
 *
 * @param {AuthenticatedRole} role - The role to resolve the path for.
 * @returns {StorageStatePaths} Path to that role's storage state file.
 */
export function storageStatePathFor(
    role: AuthenticatedRole
): StorageStatePaths {
    return ROLE_STORAGE_STATE[role];
}
