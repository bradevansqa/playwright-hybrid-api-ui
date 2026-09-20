/**
 * Application roles.
 *
 * `ADMIN`'s value doubles as the `role` value the API reports on
 * `GET /users/me` for an admin. Customers get no `role` field on that
 * response at all (verified live), so `CUSTOMER` is a test-side label only.
 *
 * Only `ADMIN` and `CUSTOMER` have credentials and a storage state behind
 * them -- see `AuthenticatedRole` in `helpers/app/roleAuth.ts`.
 */
export enum Roles {
    ADMIN = 'admin',
    CUSTOMER = 'customer',
    USER = 'user',
    GUEST = 'guest',
}
