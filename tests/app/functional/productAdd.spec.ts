import { expect, test } from '../../../fixtures/pom/test-options';

/**
 * Note: Stock has no client-side "required" validator of its own -- verified
 * live via playwright-cli that submitting a fully empty form never shows a
 * Stock/Quantity error, unlike Name/Description/Price. A "Quantity is
 * required" message does appear in the app under some conditions (observed
 * once after checking "Item for rent" while Stock had a value), but it did
 * not reproduce reliably in isolation, so no assertion is made on it here to
 * avoid a flaky test.
 */
test.describe('functional product add', () => {
    test.beforeEach(async ({ adminProductAddPage }) => {
        await adminProductAddPage.open();
    });

    test(
        'should show required-field errors and not submit when the form is empty',
        { tag: '@regression' },
        async ({ adminProductAddPage, page }) => {
            let productPosted = false;
            page.on('request', (request) => {
                if (
                    request.method() === 'POST' &&
                    new URL(request.url()).pathname === '/products'
                ) {
                    productPosted = true;
                }
            });

            await test.step('WHEN the admin submits the form without filling any fields', async () => {
                await adminProductAddPage.saveButton.click();
            });

            await test.step('THEN the required-field messages are shown', async () => {
                await expect(
                    adminProductAddPage.nameRequiredError
                ).toBeVisible();
                await expect(
                    adminProductAddPage.descriptionRequiredError
                ).toBeVisible();
                await expect(
                    adminProductAddPage.priceRequiredError
                ).toBeVisible();
            });

            await test.step('AND no product was created', async () => {
                expect(productPosted).toBe(false);
            });
        }
    );
});
