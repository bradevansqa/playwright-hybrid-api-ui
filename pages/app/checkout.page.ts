import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
    AppRoutes,
    CartSessionKeys,
    InvoiceNumberFormat,
    Messages,
    PaymentMethods,
} from '../../enums/app/app';

/**
 * Page Object for the four-step checkout wizard at `/checkout`:
 * Cart -> Sign in -> Billing Address -> Payment, followed by an order
 * confirmation that names the new invoice number.
 *
 * Every step is rendered into the DOM at once and only the active one is
 * visible, so role-based locators (which ignore hidden elements) resolve to
 * the current step -- e.g. the four "Proceed to checkout" buttons never
 * collide.
 *
 * The cart's money cells have no accessible name (plain table cells, verified
 * via playwright-cli), so those fall back to the app's `data-test` ids per
 * selector priority.
 */
export class CheckoutPage {
    constructor(private readonly page: Page) {}

    // ==================== Locators: Cart step ====================

    get lineTitles(): Locator {
        return this.page.getByTestId('product-title');
    }

    // The cart row for one product, wherever it sits in the table.
    cartRow(productName: string): Locator {
        return this.page.getByRole('row').filter({
            has: this.lineTitles.filter({ hasText: productName }),
        });
    }

    linePriceIn(row: Locator): Locator {
        return row.getByTestId('line-price');
    }

    get subtotal(): Locator {
        return this.page.getByTestId('cart-subtotal');
    }

    // "Discount (15%)" row -- rental + purchase carts only.
    get combinationDiscount(): Locator {
        return this.page.getByTestId('cart-discount');
    }

    // "Eco-Friendly Discount (5%)" row -- eco carts only.
    get ecoDiscount(): Locator {
        return this.page.getByTestId('cart-eco-discount');
    }

    get total(): Locator {
        return this.page.getByTestId('cart-total');
    }

    get proceedButton(): Locator {
        return this.page.getByRole('button', { name: 'Proceed to checkout' });
    }

    // ==================== Locators: Billing step ====================

    get countrySelect(): Locator {
        return this.page.getByRole('combobox', { name: 'Country' });
    }

    get postalCodeInput(): Locator {
        return this.page.getByRole('textbox', { name: 'Postal code' });
    }

    get houseNumberInput(): Locator {
        return this.page.getByRole('textbox', { name: 'House number' });
    }

    get stateInput(): Locator {
        return this.page.getByRole('textbox', { name: 'State' });
    }

    // ==================== Locators: Payment step ====================

    get paymentMethodSelect(): Locator {
        return this.page.getByRole('combobox', { name: 'Payment Method' });
    }

    get checkPaymentButton(): Locator {
        return this.page.getByRole('button', { name: 'Check payment' });
    }

    get confirmButton(): Locator {
        return this.page.getByRole('button', { name: 'Confirm' });
    }

    // ==================== Feedback Locators ====================
    // Verified via playwright-cli: the Billing step shows no per-field
    // messages -- invalid fields only keep Proceed disabled -- apart from the
    // postcode-lookup alert. The credit-card form shows one message under
    // each malformed field; "Check payment" stays disabled until all pass.

    get postcodeLookupError(): Locator {
        return this.page.getByText(Messages.POSTCODE_FORMAT_INVALID);
    }

    get cardNumberError(): Locator {
        return this.page.getByText(Messages.CARD_NUMBER_INVALID);
    }

    get cardExpiryError(): Locator {
        return this.page.getByText(Messages.CARD_EXPIRY_INVALID);
    }

    get cardCvvError(): Locator {
        return this.page.getByText(Messages.CARD_CVV_INVALID);
    }

    get alreadyLoggedInMessage(): Locator {
        return this.page.getByText(Messages.ALREADY_LOGGED_IN);
    }

    get paymentSuccessMessage(): Locator {
        return this.page.getByText(Messages.PAYMENT_SUCCESS);
    }

    get orderConfirmation(): Locator {
        return this.page.getByText(Messages.ORDER_CONFIRMATION);
    }

    // ==================== Actions ====================

    /**
     * Hands an API-created cart to the browser before the app boots. The app
     * keeps the visitor's cart id in sessionStorage, so seeding it there lets
     * a test skip building the cart through product pages.
     *
     * @param {string} cartId - Id of a cart created via the API.
     * @param {number} itemCount - Total quantity, for the nav-bar badge.
     * @returns {Promise<void>} Resolves once the init script is registered.
     */
    async useCart(cartId: string, itemCount: number): Promise<void> {
        await this.page.addInitScript(
            ([keys, id, count]) => {
                window.sessionStorage.setItem(keys.CART_ID, id);
                window.sessionStorage.setItem(keys.CART_QUANTITY, count);
            },
            [
                {
                    CART_ID: CartSessionKeys.CART_ID,
                    CART_QUANTITY: CartSessionKeys.CART_QUANTITY,
                },
                cartId,
                String(itemCount),
            ] as const
        );
    }

    /**
     * Opens the checkout wizard on its first (Cart) step.
     *
     * @returns {Promise<void>} Resolves when navigation is complete.
     */
    async open(): Promise<void> {
        await this.page.goto(`${process.env.APP_URL!}${AppRoutes.CHECKOUT}`, {
            waitUntil: 'domcontentloaded',
        });
    }

    /**
     * Leaves the Cart step, then the Sign in step -- which, for a session
     * that is already authenticated, only confirms who is logged in.
     *
     * @returns {Promise<void>} Resolves on the Billing Address step.
     */
    async proceedPastCartAndSignIn(): Promise<void> {
        await this.proceedButton.click();
        await expect(this.alreadyLoggedInMessage).toBeVisible();
        await this.proceedButton.click();
    }

    /**
     * Fills the billing address through the app's postcode lookup, which
     * completes street, city and state from country + postcode + house
     * number, then leaves the step.
     *
     * Race handled here (seen live): the step also pre-fills street and city
     * from the customer's profile, asynchronously. If that lands after the
     * lookup fields were typed, it resets them and the lookup never runs. So
     * the fill is retried until State is populated -- State is filled only by
     * the lookup, never by the profile -- and Proceed is enabled.
     *
     * @param {string} countryCode - Country option value, e.g. "NL".
     * @param {string} postcode - Postcode valid for that country.
     * @param {string} houseNumber - House number.
     * @returns {Promise<void>} Resolves on the Payment step.
     */
    async fillBillingByPostcode(
        countryCode: string,
        postcode: string,
        houseNumber: string
    ): Promise<void> {
        await expect(async () => {
            await this.countrySelect.selectOption(countryCode);
            await this.postalCodeInput.fill(postcode);
            await this.houseNumberInput.fill(houseNumber);
            await this.houseNumberInput.blur();
            await expect(this.stateInput).not.toHaveValue('');
        }).toPass();
        await expect(this.proceedButton).toBeEnabled();
        await this.proceedButton.click();
    }

    /**
     * Pays with a method that needs no payment details and confirms the
     * order.
     *
     * @param {PaymentMethods} method - A detail-free payment method.
     * @returns {Promise<void>} Resolves once the confirmation is shown.
     */
    async payAndConfirm(method: PaymentMethods): Promise<void> {
        await this.paymentMethodSelect.selectOption(method);
        await this.checkPaymentButton.click();
        await expect(this.paymentSuccessMessage).toBeVisible();
        await this.confirmButton.click();
        await expect(this.orderConfirmation).toBeVisible();
    }

    /**
     * Reads the invoice number from the order confirmation.
     *
     * @returns {Promise<string>} The invoice number, e.g. "INV-2026000014".
     */
    async confirmedInvoiceNumber(): Promise<string> {
        const text = await this.orderConfirmation.innerText();
        const invoiceNumber = new RegExp(
            `${InvoiceNumberFormat.PREFIX}[0-9]+`
        ).exec(text)?.[0];

        expect(invoiceNumber, `No invoice number in "${text}"`).toBeDefined();

        return invoiceNumber!;
    }
}
