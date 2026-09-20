import type { Locator, Page } from '@playwright/test';
import { z } from 'zod/v4';
import { AppRoutes, Messages } from '../../enums/app/app';

/**
 * Minimal local schema for the one field this page object reads off the
 * create response. Kept local rather than promoted to
 * `fixtures/api/schemas/app/` because only this file consumes it (same rule
 * the helper fixtures follow), and it validates rather than casts the body.
 */
const ProductCreatedResponseSchema = z.looseObject({ id: z.string() });

/** Values needed to fill and submit the "Add Product" form. */
export interface NewProductInput {
    name: string;
    description: string;
    stock: string;
    price: string;
    co2Rating: string;
    isLocationOffer: boolean;
    isRental: boolean;
    brandName: string;
    categoryName: string;
    imageTitle: string;
}

/**
 * Page Object for the admin "Add Product" screen (`/admin/products/add`).
 *
 * Scope note: on successful submit the app resets every form field back to
 * empty and shows no success toast/alert (verified via playwright-cli --
 * checked for `[role="alert"]`/`[role="status"]` and a plain empty-form
 * reset is the only observable behavior). The only reliable signal of
 * success is the `POST /products` network response, which `createProduct`
 * captures and returns the created id from -- never read back from the DOM.
 */
export class AdminProductAddPage {
    constructor(private readonly page: Page) {}

    // ==================== Locators ====================

    get nameInput(): Locator {
        return this.page.getByRole('textbox', { name: 'Name' });
    }

    get descriptionInput(): Locator {
        return this.page.getByRole('textbox', { name: 'Description' });
    }

    get stockInput(): Locator {
        return this.page.getByRole('textbox', { name: 'Stock' });
    }

    get priceInput(): Locator {
        return this.page.getByRole('textbox', { name: 'Price' });
    }

    get locationOfferCheckbox(): Locator {
        return this.page.getByRole('checkbox', { name: 'Location offer' });
    }

    get itemForRentCheckbox(): Locator {
        return this.page.getByRole('checkbox', { name: 'Item for rent' });
    }

    get co2RatingSelect(): Locator {
        return this.page.getByRole('combobox', { name: 'CO₂ Rating' });
    }

    get brandSelect(): Locator {
        return this.page.getByRole('combobox', { name: 'Brand' });
    }

    get categorySelect(): Locator {
        return this.page.getByRole('combobox', { name: 'Category' });
    }

    get imageSelect(): Locator {
        return this.page.getByRole('combobox', { name: 'Image' });
    }

    get saveButton(): Locator {
        return this.page.getByRole('button', { name: 'Save' });
    }

    // ==================== Feedback Locators ====================

    get nameRequiredError(): Locator {
        return this.page.getByText(Messages.PRODUCT_NAME_REQUIRED);
    }

    get descriptionRequiredError(): Locator {
        return this.page.getByText(Messages.PRODUCT_DESCRIPTION_REQUIRED);
    }

    get priceRequiredError(): Locator {
        return this.page.getByText(Messages.PRODUCT_PRICE_REQUIRED);
    }

    // ==================== Actions ====================

    /**
     * Navigates directly to the admin "Add Product" page.
     *
     * @returns {Promise<void>} Resolves when navigation is complete.
     */
    async open(): Promise<void> {
        await this.page.goto(
            `${process.env.APP_URL!}${AppRoutes.ADMIN_PRODUCT_ADD}`,
            { waitUntil: 'domcontentloaded' }
        );
    }

    /**
     * Fills and submits the Add Product form, then captures the created
     * product's id from the `POST /products` response -- the form itself
     * resets to empty on success with no visible confirmation, so the id
     * cannot be read back from the DOM.
     *
     * @param {NewProductInput} product - Values to enter into the form.
     * @returns {Promise<string>} The created product's id.
     */
    async createProduct(product: NewProductInput): Promise<string> {
        await this.nameInput.fill(product.name);
        await this.descriptionInput.fill(product.description);
        await this.stockInput.fill(product.stock);
        await this.priceInput.fill(product.price);

        if (product.isLocationOffer) {
            await this.locationOfferCheckbox.check();
        }
        if (product.isRental) {
            await this.itemForRentCheckbox.check();
        }

        await this.co2RatingSelect.selectOption(product.co2Rating);
        await this.brandSelect.selectOption({ label: product.brandName });
        await this.categorySelect.selectOption({ label: product.categoryName });
        await this.imageSelect.selectOption({ label: product.imageTitle });

        return this.submitAndCaptureId();
    }

    /**
     * Clicks Save and captures the created product's id from the
     * `POST /products` response -- split out from `createProduct` so a test
     * that needs to fill/select fields itself (e.g. to exercise a specific
     * field-interaction order) can still submit and get the id back without
     * `createProduct` re-filling every field over top of it.
     *
     * @returns {Promise<string>} The created product's id.
     */
    async submitAndCaptureId(): Promise<string> {
        const [response] = await Promise.all([
            this.page.waitForResponse(
                (r) =>
                    r.request().method() === 'POST' &&
                    new URL(r.url()).pathname === '/products' &&
                    r.status() === 201
            ),
            this.saveButton.click(),
        ]);

        return ProductCreatedResponseSchema.parse(await response.json()).id;
    }
}
