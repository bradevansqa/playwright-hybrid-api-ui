import { expect, Locator, Page } from '@playwright/test';
import { ApiEndpoints, ProductCategories } from '../../enums/app/app';

/**
 * Page Object for the home / product-listing page (`/`).
 *
 * Selector notes, all established by live exploration via playwright-cli:
 *
 * - The card element is `a.card[data-test="product-<ULID>"]`. The test id
 *   embeds the product id, so it is useless as a stable selector -- cards are
 *   instead located by role and narrowed to those containing a product name.
 * - The grid container carries an **empty** `data-test=""` attribute, so it
 *   offers no handle either.
 * - Category checkboxes are `data-test="category-<ULID>"` -- dynamic for the
 *   same reason, so they are located by accessible name, which is also the
 *   Constitution's preferred strategy.
 * - Only `product-name` and `product-price` expose stable test ids, and those
 *   are the documented fallback when no better semantic handle exists.
 *
 * Behaviour note: applying a category filter causes the app to issue a
 * `QUERY /products` request (the filter travels in the request body, not the
 * query string), so `filterByCategory` waits on the response rather than on
 * a DOM guess.
 */
export class ProductsPage {
    constructor(private readonly page: Page) {}

    // ==================== Locators ====================

    get productCards(): Locator {
        return this.page
            .getByRole('link')
            .filter({ has: this.page.getByTestId('product-name') });
    }

    get productNames(): Locator {
        return this.page.getByTestId('product-name');
    }

    get productPrices(): Locator {
        return this.page.getByTestId('product-price');
    }

    get sortSelect(): Locator {
        return this.page.getByRole('combobox', { name: 'sort' });
    }

    get searchInput(): Locator {
        return this.page.getByRole('textbox', { name: 'Search' });
    }

    get searchButton(): Locator {
        return this.page.getByRole('button', { name: 'Search' });
    }

    get paginationPageButtons(): Locator {
        return this.page.getByRole('button', { name: /^Page-\d+$/ });
    }

    categoryCheckbox(categoryName: ProductCategories): Locator {
        return this.page.getByRole('checkbox', {
            name: categoryName,
            exact: true,
        });
    }

    cardName(card: Locator): Locator {
        return card.getByTestId('product-name');
    }

    cardPrice(card: Locator): Locator {
        return card.getByTestId('product-price');
    }

    cardImage(card: Locator): Locator {
        return card.getByRole('img');
    }

    // ==================== Actions ====================

    /**
     * Opens the home / product-listing page using the configured APP_URL and
     * waits until the listing has actually rendered, so callers never race
     * the Angular bootstrap.
     *
     * @returns {Promise<void>} Resolves once the first product card is visible.
     */
    async open(): Promise<void> {
        await this.page.goto(process.env.APP_URL!, {
            waitUntil: 'domcontentloaded',
        });

        await expect(this.productCards).not.toHaveCount(0);
    }

    /**
     * Ticks a category checkbox in the filter sidebar and waits for the
     * listing request the app fires in response.
     *
     * Ticking a top-level category (e.g. Hand Tools) also ticks all of its
     * sub-categories -- that is the application's own behaviour, not
     * something this method does.
     *
     * @param {ProductCategories} categoryName - Category label as rendered in the sidebar.
     * @returns {Promise<void>} Resolves once the filtered listing response has arrived.
     *
     * @example
     * ```ts
     * await productsPage.filterByCategory(ProductCategories.CHISELS);
     * await expect(productsPage.productCards).toHaveCount(3);
     * ```
     */
    async filterByCategory(categoryName: ProductCategories): Promise<void> {
        const listingResponse = this.page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === ApiEndpoints.PRODUCTS &&
                response.ok()
        );

        await this.categoryCheckbox(categoryName).check();

        await listingResponse;
    }

    /**
     * Reads the product names currently rendered in the listing, trimmed.
     *
     * @returns {Promise<string[]>} Visible product names, in display order.
     */
    async visibleProductNames(): Promise<string[]> {
        const names = await this.productNames.allTextContents();

        return names.map((name) => name.trim());
    }
}
