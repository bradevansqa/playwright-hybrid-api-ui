import type { Locator, Page } from '@playwright/test';
import { AppRoutes } from '../../enums/app/app';

/**
 * Page Object for the admin dashboard (`/admin/dashboard`).
 *
 * Scope note: only the two headings that prove admin content actually
 * rendered are modelled -- this page object exists for the role-access tests,
 * not to exercise the dashboard's charts.
 *
 * Route note: the bare `/admin` path is deliberately NOT used as an
 * admin-area marker. Verified live that `/admin` renders an empty site shell
 * for admins and customers alike (byte-identical), so asserting on it would
 * pass regardless of role. `/admin/dashboard` is a real guarded route: an
 * admin sees the headings below, a customer is redirected to the login page.
 */
export class AdminDashboardPage {
    constructor(private readonly page: Page) {}

    // ==================== Locators ====================

    get salesHeading(): Locator {
        return this.page.getByRole('heading', { name: 'Sales over the years' });
    }

    get latestOrdersHeading(): Locator {
        return this.page.getByRole('heading', { name: 'Latest orders' });
    }

    // ==================== Actions ====================

    /**
     * Navigates to the admin dashboard.
     *
     * Deliberately asserts nothing about the outcome: the SPA's route guard
     * redirects an unauthorised visitor client-side *after* load, so where
     * this ends up is exactly what the role-access tests are measuring. They
     * settle it with `expect(page).toHaveURL(...)`, which retries.
     *
     * @returns {Promise<void>} Resolves when navigation is complete.
     */
    async open(): Promise<void> {
        await this.page.goto(
            `${process.env.APP_URL!}${AppRoutes.ADMIN_DASHBOARD}`,
            { waitUntil: 'domcontentloaded' }
        );
    }
}
