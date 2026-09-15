import type { Locator, Page } from '@playwright/test';
import { AppRoutes, InvoiceStatus } from '../../enums/app/app';

/**
 * Page Object for the admin "Edit Order" screen
 * (`/admin/orders/edit/{invoiceId}`), where an admin transitions an
 * invoice through its status lifecycle.
 *
 * Scope note: this page object only models the "General Information" ->
 * Status section, since that is all the invoice-status-lifecycle flow
 * exercises. Billing address, payment information, and the products table
 * on this same screen are not modeled here.
 */
export class AdminOrderEditPage {
    constructor(private readonly page: Page) {}

    // ==================== Locators ====================

    get invoiceNumberInput(): Locator {
        // No accessible label is associated with this field in the live app
        // (verified via playwright-cli -- the rendered <input> has no name
        // from getByRole/getByLabel/getByPlaceholder/getByText), so this
        // falls back to the app's own `data-test` id per selector priority.
        return this.page.getByTestId('invoice-number');
    }

    get statusSelect(): Locator {
        return this.page.getByRole('combobox', { name: 'Status' });
    }

    get updateStatusButton(): Locator {
        return this.page.getByRole('button', { name: 'Update status' });
    }

    // ==================== Feedback Locators ====================
    // Verified via playwright-cli exploration: submitting a status change
    // shows no toast/success/error message anywhere on the page (checked
    // for [role="alert"], [role="status"], .toast, .alert, .notification,
    // .snackbar -- none appear, and no console output reflects it either).
    // The only observable feedback is the Status <select>'s own selected
    // value, and -- confirmed on reload -- that the app only allows forward
    // transitions: the current status and every earlier one become
    // disabled options, while later ones stay selectable.

    // ==================== Actions ====================

    /**
     * Navigates directly to the admin "Edit Order" page for a given invoice.
     *
     * @param {string} invoiceId - The invoice's id (not its invoice number).
     * @returns {Promise<void>} Resolves when navigation is complete.
     */
    async open(invoiceId: string): Promise<void> {
        await this.page.goto(
            `${process.env.APP_URL!}${AppRoutes.ADMIN_ORDER_EDIT}/${invoiceId}`,
            { waitUntil: 'domcontentloaded' }
        );
    }

    /**
     * Reloads the page so form fields reflect persisted server state rather
     * than whatever a prior in-page action (e.g. `selectOption`) last set
     * them to locally.
     *
     * @returns {Promise<void>} Resolves when the reload has completed.
     */
    async reload(): Promise<void> {
        await this.page.reload({ waitUntil: 'domcontentloaded' });
    }

    /**
     * Transitions the invoice to a new status via the Status dropdown and
     * the "Update status" button.
     *
     * Note: the dropdown only allows forward transitions -- the current
     * status and any earlier status in the lifecycle are disabled options.
     *
     * @param {InvoiceStatus} status - The invoice status to transition to;
     *   must be later than the invoice's current status.
     * @returns {Promise<void>} Resolves when the form has been submitted.
     */
    async updateStatus(status: InvoiceStatus): Promise<void> {
        await this.statusSelect.selectOption(status);
        await Promise.all([
            this.page.waitForResponse(
                (response) =>
                    response.request().method() === 'PUT' &&
                    /\/invoices\/[^/]+\/status$/.test(
                        new URL(response.url()).pathname
                    ) &&
                    response.status() === 200
            ),
            this.updateStatusButton.click(),
        ]);
    }
}
