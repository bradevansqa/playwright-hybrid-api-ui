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
    PRODUCT_NAME_REQUIRED = 'Name is required',
    PRODUCT_DESCRIPTION_REQUIRED = 'Description is required',
    PRODUCT_PRICE_REQUIRED = 'Price is required',
}

/** UI route paths */
export enum AppRoutes {
    LOGIN = '/auth/login',
    ACCOUNT = '/account',
    /** Base path -- requires an invoice id appended, e.g. `${ADMIN_ORDER_EDIT}/${invoiceId}` */
    ADMIN_ORDER_EDIT = '/admin/orders/edit',
    ADMIN_PRODUCT_ADD = '/admin/products/add',
    ADMIN_DASHBOARD = '/admin/dashboard',
}

/** API endpoint paths */
export enum ApiEndpoints {
    LOGIN = '/users/login',
    LOGOUT = '/users/logout',
    CURRENT_USER = '/users/me',
    REGISTER = '/users/register',
    /** Admin-only user list */
    USERS = '/users',
    /** Documented as admin-only, but reachable by customers -- see roleAccess.spec.ts */
    USERS_SEARCH = '/users/search',
    /** Admin-only dashboard reports */
    REPORTS_TOTAL_SALES_OF_YEARS = '/reports/total-sales-of-years',
    REPORTS_TOP10_PURCHASED_PRODUCTS = '/reports/top10-purchased-products',
    PRODUCTS = '/products',
    BRANDS = '/brands',
    CATEGORIES = '/categories',
    IMAGES = '/images',
    CARTS = '/carts',
    POSTCODE_LOOKUP = '/postcode-lookup',
    INVOICES = '/invoices',
}

/** Documented invoice lifecycle statuses (forward-only in the admin UI) */
export enum InvoiceStatus {
    AWAITING_FULFILLMENT = 'AWAITING_FULFILLMENT',
    ON_HOLD = 'ON_HOLD',
    AWAITING_SHIPMENT = 'AWAITING_SHIPMENT',
    SHIPPED = 'SHIPPED',
    COMPLETED = 'COMPLETED',
}

/** Storage state file paths, one per authenticated role */
export enum StorageStatePaths {
    ADMIN = '.auth/app/adminStorageState.json',
    CUSTOMER = '.auth/app/customerStorageState.json',
}

/** Browser storage keys the app itself writes */
export enum BrowserStorageKeys {
    /** localStorage key holding the logged-in session's JWT */
    AUTH_TOKEN = 'auth-token',
}
