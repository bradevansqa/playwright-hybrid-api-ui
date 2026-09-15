/**
 * Application-specific constants.
 * Add your application's repeated string values here.
 *
 * @example
 * ```ts
 * import { Messages, ApiEndpoints } from '../../enums/app/app';
 *
 * await expect(page.getByText(Messages.LOGIN_ERROR)).toBeVisible();
 * ```
 */

/** Common UI messages — every value verified against the live demo app */
export enum Messages {
    LOGIN_ERROR = 'Invalid email or password',
    EMAIL_REQUIRED = 'Email is required',
    PASSWORD_REQUIRED = 'Password is required',
    EMAIL_FORMAT_INVALID = 'Email format is invalid',
}

/** UI route paths */
export enum AppRoutes {
    LOGIN = '/auth/login',
    /** Base path -- requires an invoice id appended, e.g. `${ADMIN_ORDER_EDIT}/${invoiceId}` */
    ADMIN_ORDER_EDIT = '/admin/orders/edit',
}

/** API endpoint paths */
export enum ApiEndpoints {
    LOGIN = '/users/login',
    LOGOUT = '/users/logout',
    CURRENT_USER = '/users/me',
    REGISTER = '/users/register',
    PRODUCTS = '/products',
    CARTS = '/carts',
    POSTCODE_LOOKUP = '/postcode-lookup',
    INVOICES = '/invoices',
}

/** Storage state file paths */
export enum StorageStatePaths {
    APP = '.auth/app/appStorageState.json',
}
