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
    PAYMENT_SUCCESS = 'Payment was successful',
    /** Prefix of the checkout confirmation; the invoice number follows it */
    ORDER_CONFIRMATION = 'Thanks for your order! Your invoice number is',
    ALREADY_LOGGED_IN = 'you are already logged in',
    POSTCODE_FORMAT_INVALID = 'The postal code format is not valid for the selected country.',
    CARD_NUMBER_INVALID = 'Invalid card number format.',
    CARD_EXPIRY_INVALID = 'Invalid date format. Use MM/YYYY.',
    CARD_CVV_INVALID = 'CVV must be 3 or 4 digits.',
}

/** UI route paths */
export enum AppRoutes {
    LOGIN = '/auth/login',
    ACCOUNT = '/account',
    /** Base path -- requires an invoice id appended, e.g. `${ADMIN_ORDER_EDIT}/${invoiceId}` */
    ADMIN_ORDER_EDIT = '/admin/orders/edit',
    ADMIN_PRODUCT_ADD = '/admin/products/add',
    ADMIN_DASHBOARD = '/admin/dashboard',
    CHECKOUT = '/checkout',
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
    /** Scoped to the caller's own invoices for customers */
    INVOICES_SEARCH = '/invoices/search',
}

/**
 * Path suffixes appended to a resource path plus id, e.g.
 * `${ApiEndpoints.INVOICES}/${id}${ApiEndpointSuffixes.STATUS}`.
 */
export enum ApiEndpointSuffixes {
    /** `PUT /invoices/{invoiceId}/status` */
    STATUS = '/status',
    /** `GET /invoices/{invoice_number}/download-pdf` */
    DOWNLOAD_PDF = '/download-pdf',
}

/** Invoice-number format, e.g. `INV-2026000014` (verified live) */
export enum InvoiceNumberFormat {
    /** Prefix shared by every invoice number -- searching it matches all */
    PREFIX = 'INV-',
}

/**
 * Checkout discount percentages, observed live (undocumented): rental +
 * purchase earns COMBINATION, otherwise any eco-friendly item earns ECO.
 */
export enum DiscountPercentages {
    COMBINATION = 15,
    ECO = 5,
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

/** sessionStorage keys the app uses to track the visitor's cart */
export enum CartSessionKeys {
    /** Id of the API cart the checkout page renders */
    CART_ID = 'cart_id',
    /** Item count shown on the nav-bar cart badge */
    CART_QUANTITY = 'cart_quantity',
}

/** Payment methods offered at checkout (`payment_method` values) */
export enum PaymentMethods {
    BANK_TRANSFER = 'bank-transfer',
    CASH_ON_DELIVERY = 'cash-on-delivery',
    CREDIT_CARD = 'credit-card',
    BUY_NOW_PAY_LATER = 'buy-now-pay-later',
    GIFT_CARD = 'gift-card',
}
