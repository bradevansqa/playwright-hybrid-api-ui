import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints, AppRoutes } from '../../../enums/app/app';
import { Roles } from '../../../enums/util/roles';
import { CurrentUserResponseSchema } from '../../../fixtures/api/schemas/app/userSchema';
import { readSessionAuthToken } from '../../../helpers/app/session';
import { requireEnv } from '../../../helpers/util/requireEnv';

/**
 * Who may reach the admin area in the UI.
 *
 * The admin test is not decoration: it proves `/admin/dashboard` really does
 * serve admin content, so the customer's redirect below means "denied" rather
 * than "route broken for everyone". Verified live that the bare `/admin` path
 * renders an identical empty shell for both roles, which is why the guarded
 * `/admin/dashboard` is the target -- see `pages/app/adminDashboard.page.ts`.
 *
 * A customer is sent to `/auth/login` (no query string) and, notably, is *not*
 * logged out on the way: the app shows the login form to a session that is
 * still authenticated. That is the app's behaviour, asserted as found.
 */
test.describe('functional admin area access', () => {
    test(
        'should serve the admin dashboard to an admin',
        { tag: '@regression' },
        async ({ adminDashboardPage, page }) => {
            await test.step('WHEN an admin opens the admin dashboard', async () => {
                await adminDashboardPage.open();
            });

            await test.step('THEN the dashboard renders admin content', async () => {
                await expect(page).toHaveURL(
                    `${requireEnv('APP_URL')}${AppRoutes.ADMIN_DASHBOARD}`
                );
                await expect(adminDashboardPage.salesHeading).toBeVisible();
                await expect(
                    adminDashboardPage.latestOrdersHeading
                ).toBeVisible();
            });
        }
    );

    test.describe('as a customer', () => {
        test.use({ role: Roles.CUSTOMER });

        test(
            'should send a customer away from the admin dashboard to the login page',
            { tag: '@regression' },
            async ({ adminDashboardPage, appPage, apiRequest, page }) => {
                await test.step('GIVEN the browser session really belongs to the customer', async () => {
                    await page.goto(
                        `${requireEnv('APP_URL')}${AppRoutes.ACCOUNT}`,
                        { waitUntil: 'domcontentloaded' }
                    );

                    // Identity is proven with the session's own JWT, not with a
                    // token minted separately -- otherwise this would say
                    // nothing about who the browser is logged in as.
                    const { status, body } = await apiRequest({
                        method: 'GET',
                        url: ApiEndpoints.CURRENT_USER,
                        baseUrl: requireEnv('API_URL'),
                        headers: await readSessionAuthToken(page),
                    });

                    expect(status).toBe(200);
                    expect(CurrentUserResponseSchema.parse(body)).toBeTruthy();
                    const me = CurrentUserResponseSchema.parse(body);
                    expect(me.email).toBe(requireEnv('CUSTOMER_EMAIL'));
                    expect(me.role).toBeUndefined();
                });

                await test.step('WHEN the customer opens the admin dashboard', async () => {
                    await adminDashboardPage.open();
                });

                await test.step('THEN they land on the login page', async () => {
                    await expect(page).toHaveURL(
                        `${requireEnv('APP_URL')}${AppRoutes.LOGIN}`
                    );
                    await expect(appPage.loginButton).toBeVisible();
                });

                await test.step('AND no admin content is rendered', async () => {
                    await expect(adminDashboardPage.salesHeading).toHaveCount(
                        0
                    );
                    await expect(
                        adminDashboardPage.latestOrdersHeading
                    ).toHaveCount(0);
                });
            }
        );
    });
});
