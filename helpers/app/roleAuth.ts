import { StorageStatePaths } from '../../enums/app/app';
import { Roles } from '../../enums/util/roles';
import { requireEnv } from '../util/requireEnv';

/**
 * Roles that have real credentials and a storage state behind them. The
 * other `Roles` members are app vocabulary, not test personas -- a test can
 * only run *as* one of these.
 */
export type AuthenticatedRole = Roles.ADMIN | Roles.CUSTOMER;

/** Login credentials for a role. */
export type RoleCredentials = {
    email: string;
    password: string;
};

/**
 * Single source of truth for which env vars and storage state file belong to
 * each role -- shared by `auth.setup.ts` (which writes the storage states)
 * and the `role` fixture (which reads them and mints API tokens).
 */
const ROLE_ENV: Record<
    AuthenticatedRole,
    { emailVar: string; passwordVar: string; storageState: StorageStatePaths }
> = {
    [Roles.ADMIN]: {
        emailVar: 'APP_EMAIL',
        passwordVar: 'APP_PASSWORD',
        storageState: StorageStatePaths.ADMIN,
    },
    [Roles.CUSTOMER]: {
        emailVar: 'CUSTOMER_EMAIL',
        passwordVar: 'CUSTOMER_PASSWORD',
        storageState: StorageStatePaths.CUSTOMER,
    },
};

/**
 * Resolves a role's login credentials from the environment.
 *
 * @param {AuthenticatedRole} role - The role to resolve credentials for.
 * @returns {RoleCredentials} The role's email and password.
 * @throws {Error} If either environment variable is unset.
 */
export function credentialsFor(role: AuthenticatedRole): RoleCredentials {
    const { emailVar, passwordVar } = ROLE_ENV[role];

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
    return ROLE_ENV[role].storageState;
}
