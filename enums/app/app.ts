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

/**
 * Product category display names, exactly as rendered in the home-page
 * filter sidebar -- every value verified live via playwright-cli.
 *
 * The first three are top-level categories; the rest are the sub-categories
 * of Hand Tools, which the sidebar nests underneath it.
 */
export enum ProductCategories {
    HAND_TOOLS = 'Hand Tools',
    POWER_TOOLS = 'Power Tools',
    OTHER = 'Other',
    HAMMER = 'Hammer',
    HAND_SAW = 'Hand Saw',
    WRENCH = 'Wrench',
    SCREWDRIVER = 'Screwdriver',
    PLIERS = 'Pliers',
    CHISELS = 'Chisels',
    MEASURES = 'Measures',
}

/**
 * Category slugs accepted by `GET /products?by_category_slug=`.
 *
 * Only the slugs the suite actually queries are listed. Note that
 * `by_category=` and `categories=` are **silently ignored** by the API --
 * they return the full unfiltered set rather than an error, so a typo in the
 * parameter name yields a test that passes for the wrong reason.
 */
export enum ProductCategorySlugs {
    HAND_TOOLS = 'hand-tools',
    CHISELS = 'chisels',
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
