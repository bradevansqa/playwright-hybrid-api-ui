import { expect, test } from '../../../fixtures/pom/test-options';
import {
    ApiEndpoints,
    ProductCategories,
    ProductCategorySlugs,
} from '../../../enums/app/app';
import { ProductListResponseSchema } from '../../../fixtures/api/schemas/app/productSchema';
import { requireEnv } from '../../../helpers/util/requireEnv';

/** Sub-categories the sidebar nests under Hand Tools, in rendered order. */
const HAND_TOOLS_SUB_CATEGORIES = [
    ProductCategories.HAMMER,
    ProductCategories.HAND_SAW,
    ProductCategories.WRENCH,
    ProductCategories.SCREWDRIVER,
    ProductCategories.PLIERS,
    ProductCategories.CHISELS,
    ProductCategories.MEASURES,
] as const;

/**
 * Why this file filters by Chisels rather than Hand Tools:
 *
 * Filtering by Hand Tools leaves the first page of results byte-identical to
 * the unfiltered first page -- same nine products, same order -- because hand
 * tools already sort first. Only the pagination control changes (five pages
 * down to three). A test that filtered by Hand Tools and asserted on visible
 * product names would therefore pass whether or not filtering worked at all.
 *
 * Chisels is a leaf category with three products, so the filtered listing is
 * unambiguously distinct from the unfiltered one.
 *
 * These tests only read; nothing mutates persistent state, so no revert hooks
 * are required.
 */
test.describe('functional product listing', () => {
    test.beforeEach(async ({ productsPage }) => {
        await productsPage.open();
    });

    test(
        'should display a listing of multiple products',
        { tag: '@smoke' },
        async ({ productsPage }) => {
            await test.step('THEN more than one product card is rendered', async () => {
                const cardCount = await productsPage.productCards.count();

                expect(cardCount).toBeGreaterThan(1);
            });

            await test.step('AND the listing is paginated across several pages', async () => {
                await expect
                    .poll(() => productsPage.paginationPageButtons.count())
                    .toBeGreaterThan(1);
            });
        }
    );

    test(
        'should display a name, a price and an image on every product card',
        { tag: '@smoke' },
        async ({ productsPage }) => {
            const cardCount = await productsPage.productCards.count();

            await test.step('THEN every card carries exactly one name and one price', async () => {
                await expect(productsPage.productNames).toHaveCount(cardCount);
                await expect(productsPage.productPrices).toHaveCount(cardCount);
            });

            await test.step('AND each card renders non-empty content in all three', async () => {
                const cards = await productsPage.productCards.all();

                for (const card of cards) {
                    await expect(productsPage.cardName(card)).not.toBeEmpty();
                    await expect(productsPage.cardPrice(card)).toHaveText(
                        /^\$\d+\.\d{2}$/
                    );
                    await expect(productsPage.cardImage(card)).toBeVisible();
                }
            });
        }
    );

    test(
        'should select every sub-category when a top-level category is selected',
        { tag: '@regression' },
        async ({ productsPage }) => {
            await test.step('WHEN the Hand Tools category is selected', async () => {
                await productsPage.filterByCategory(
                    ProductCategories.HAND_TOOLS
                );
            });

            await test.step('THEN each of its sub-categories is selected too', async () => {
                for (const subCategory of HAND_TOOLS_SUB_CATEGORIES) {
                    await expect(
                        productsPage.categoryCheckbox(subCategory)
                    ).toBeChecked();
                }
            });
        }
    );

    test(
        'should narrow the listing to exactly the products of the selected category',
        { tag: '@regression' },
        async ({ productsPage, apiRequest }) => {
            let expectedNames: string[] = [];

            await test.step('GIVEN the API reports which products belong to the category', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.PRODUCTS}?by_category_slug=${ProductCategorySlugs.CHISELS}`,
                    baseUrl: requireEnv('API_URL'),
                });

                expect(status).toBe(200);
                expect(ProductListResponseSchema.parse(body)).toBeTruthy();

                const products = ProductListResponseSchema.parse(body);

                /*
                 * The UI comparison below only looks at the first page of
                 * results, so it is valid only while the category fits on one
                 * API page. Asserted rather than assumed, so this test fails
                 * loudly if the category ever outgrows a single page instead
                 * of quietly comparing against a truncated set.
                 */
                expect(products.last_page).toBe(1);

                expectedNames = products.data
                    .map((product) => product.name)
                    .sort();
            });

            await test.step('WHEN the user filters by that category in the UI', async () => {
                await productsPage.filterByCategory(ProductCategories.CHISELS);
            });

            await test.step('THEN the listing shows exactly those products and nothing else', async () => {
                await expect(productsPage.productCards).toHaveCount(
                    expectedNames.length
                );

                const visibleNames = await productsPage.visibleProductNames();

                expect(visibleNames.sort()).toEqual(expectedNames);
            });
        }
    );
});
