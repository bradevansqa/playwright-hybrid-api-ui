import { z } from 'zod/v4';
import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/app/app';
import { ProductDetailResponseSchema } from '../../../fixtures/api/schemas/app/productSchema';
import { generateProduct } from '../../../test-data/factories/app/product.factory';

/**
 * Minimal local schemas for the `GET /brands` / `/categories` / `/images`
 * lookups below -- these power the same dropdowns the admin form itself
 * populates from, so reading their first entry gives a stable, always-valid
 * option to select through the UI without hardcoding catalog data that
 * could change. Asserts only the fields this test consumes (see
 * `api-testing` skill Phase 8 on when to promote a local schema).
 */
const BrandListItemSchema = z.looseObject({ name: z.string() });
const CategoryListItemSchema = z.looseObject({ name: z.string() });
const ImageListItemSchema = z.looseObject({ title: z.string() });

test.describe('admin product CRUD', () => {
    let createdProductId: string | undefined;

    test.afterEach(async ({ apiRequest }) => {
        if (!createdProductId) return;

        const { status } = await apiRequest({
            method: 'DELETE',
            url: `${ApiEndpoints.PRODUCTS}/${createdProductId}`,
            baseUrl: process.env.API_URL,
            headers: process.env.ACCESS_TOKEN,
        });

        expect(status).toBe(204);
        createdProductId = undefined;
    });

    test(
        'should create a product via the admin UI and verify it via the API',
        { tag: '@e2e' },
        async ({ adminProductAddPage, apiRequest }) => {
            let brandName = '';
            let categoryName = '';
            let imageTitle = '';

            await test.step('GIVEN an existing brand is looked up via the API', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: ApiEndpoints.BRANDS,
                    baseUrl: process.env.API_URL,
                });

                expect(status).toBe(200);
                expect(z.array(BrandListItemSchema).parse(body)).toBeTruthy();
                const [brand] = z.array(BrandListItemSchema).parse(body);
                brandName = brand.name;
            });

            await test.step('AND an existing category is looked up via the API', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: ApiEndpoints.CATEGORIES,
                    baseUrl: process.env.API_URL,
                });

                expect(status).toBe(200);
                expect(
                    z.array(CategoryListItemSchema).parse(body)
                ).toBeTruthy();
                const [category] = z.array(CategoryListItemSchema).parse(body);
                categoryName = category.name;
            });

            await test.step('AND an existing image is looked up via the API', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: ApiEndpoints.IMAGES,
                    baseUrl: process.env.API_URL,
                });

                expect(status).toBe(200);
                expect(z.array(ImageListItemSchema).parse(body)).toBeTruthy();
                const [image] = z.array(ImageListItemSchema).parse(body);
                imageTitle = image.title;
            });

            const newProduct = {
                // NOT checking "Item for rent": verified live via
                // playwright-cli that checking it clears the Stock field
                // client-side, which would make in_stock false regardless
                // of what this test enters. That coupling is documented as
                // its own test below ("should not silently discard...").
                ...generateProduct({ isLocationOffer: true, isRental: false }),
                brandName,
                categoryName,
                imageTitle,
            };

            await test.step('WHEN the admin creates a new product via the admin UI', async () => {
                await adminProductAddPage.open();
                createdProductId =
                    await adminProductAddPage.createProduct(newProduct);

                expect(createdProductId).toBeTruthy();
            });

            await test.step('THEN GET /products/{id} confirms every entered field was persisted', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.PRODUCTS}/${createdProductId}`,
                    baseUrl: process.env.API_URL,
                });

                expect(status).toBe(200);
                expect(ProductDetailResponseSchema.parse(body)).toBeTruthy();
                const product = ProductDetailResponseSchema.parse(body);

                expect(product.name).toBe(newProduct.name);
                expect(product.description).toBe(newProduct.description);
                expect(product.price).toBe(Number(newProduct.price));
                expect(product.in_stock).toBe(true);
                expect(product.is_location_offer).toBe(true);
                expect(product.is_rental).toBe(false);
                expect(product.co2_rating).toBe(newProduct.co2Rating);
                expect(product.is_eco_friendly).toBe(true);
                expect(product.brand.name).toBe(brandName);
                expect(product.category.name).toBe(categoryName);
                expect(product.product_image.title).toBe(imageTitle);
            });
        }
    );

    // Discovered while building the test above: checking "Item for rent"
    // silently clears whatever the admin already typed into Stock. Verified
    // live via playwright-cli that the backend has no objection to a rental
    // product carrying a stock count (typing a new value into Stock *after*
    // checking the box persists fine, returning `is_rental: true` and a
    // truthy `in_stock`) -- so the clearing is a client-side side effect of
    // the checkbox's change handler, not a real is_rental/stock exclusion
    // rule. Documented as `test.fail()` (matching the convention in
    // `tests/app/api/invoice.spec.ts`) so it starts failing loudly -- meaning
    // this should be promoted to a real passing test -- the day someone
    // fixes it.
    test.fail(
        'should not silently discard an admin-entered Stock value when the product is marked for rent',
        { tag: '@e2e' },
        async ({ adminProductAddPage, apiRequest }) => {
            const uniqueSuffix = `${Date.now()}`;

            await test.step('GIVEN the admin has entered a Stock value on the Add Product form', async () => {
                await adminProductAddPage.open();
                await adminProductAddPage.nameInput.fill(
                    `Rental Stock Bug ${uniqueSuffix}`
                );
                await adminProductAddPage.descriptionInput.fill(
                    `Created by Playwright at ${uniqueSuffix}`
                );
                await adminProductAddPage.priceInput.fill('10');
                await adminProductAddPage.stockInput.fill('20');
            });

            await test.step('WHEN the admin marks the product as available for rent', async () => {
                await adminProductAddPage.itemForRentCheckbox.check();
            });

            await test.step('THEN the Stock field is silently cleared', async () => {
                await expect(adminProductAddPage.stockInput).toHaveValue('');
            });

            await test.step('AND the admin submits without noticing (Stock is left as-is)', async () => {
                await adminProductAddPage.brandSelect.selectOption({
                    index: 1,
                });
                await adminProductAddPage.categorySelect.selectOption({
                    index: 1,
                });
                await adminProductAddPage.imageSelect.selectOption({
                    index: 1,
                });

                createdProductId =
                    await adminProductAddPage.submitAndCaptureId();
            });

            await test.step('THEN the created product should still report the entered stock (currently reports none)', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.PRODUCTS}/${createdProductId}`,
                    baseUrl: process.env.API_URL,
                });

                expect(status).toBe(200);
                expect(ProductDetailResponseSchema.parse(body)).toBeTruthy();
                const product = ProductDetailResponseSchema.parse(body);

                expect(product.in_stock).toBe(true);
            });
        }
    );
});
