import { test as base } from '@playwright/test';
import { AppPage } from '../../pages/app/app.page';
import { AdminOrderEditPage } from '../../pages/app/adminOrderEdit.page';
import { AdminProductAddPage } from '../../pages/app/adminProductAdd.page';
import { AdminDashboardPage } from '../../pages/app/adminDashboard.page';
import { ProductsPage } from '../../pages/app/products.page';

/**
 * Framework fixtures for page objects.
 * Add new page object types here as you create them.
 */
export type FrameworkFixtures = {
    /** Main application page object */
    appPage: AppPage;
    /** Admin "Edit Order" page object */
    adminOrderEditPage: AdminOrderEditPage;
    /** Admin "Add Product" page object */
    adminProductAddPage: AdminProductAddPage;
    /** Admin dashboard page object */
    adminDashboardPage: AdminDashboardPage;
    /** Home / product-listing page object */
    productsPage: ProductsPage;
    resetStorageState: () => Promise<void>;
};

/**
 * Extended test with page object fixtures.
 * Import this in your test files to access page objects.
 *
 * @example
 * ```ts
 * import { test, expect } from '../fixtures/pom/test-options';
 *
 * test('example test', async ({ appPage }) => {
 *   await appPage.openHomePage();
 *   await expect(appPage.appTitle).toBeVisible();
 * });
 * ```
 */
export const test = base.extend<FrameworkFixtures>({
    appPage: async ({ page }, use) => {
        await use(new AppPage(page));
    },

    adminOrderEditPage: async ({ page }, use) => {
        await use(new AdminOrderEditPage(page));
    },

    adminProductAddPage: async ({ page }, use) => {
        await use(new AdminProductAddPage(page));
    },

    adminDashboardPage: async ({ page }, use) => {
        await use(new AdminDashboardPage(page));
    },

    productsPage: async ({ page }, use) => {
        await use(new ProductsPage(page));
    },

    resetStorageState: async ({ context }, use) => {
        await use(async () => {
            await context.clearCookies();
            await context.clearPermissions();
        });
    },
});
