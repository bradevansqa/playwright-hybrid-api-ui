import { faker } from '@faker-js/faker';

/**
 * Scalar fields of the admin "Add Product" form. Brand, category and image
 * are deliberately absent: those are pick-from-existing dropdowns, so a test
 * looks up real values via the API rather than inventing them.
 */
export type NewProductData = {
    name: string;
    description: string;
    stock: string;
    price: string;
    co2Rating: string;
    isLocationOffer: boolean;
    isRental: boolean;
};

/**
 * Generates product form data with randomised, collision-safe values.
 *
 * The random suffix on `name` keeps parallel workers (and repeat runs against
 * the shared instance) from colliding on the same product.
 *
 * `co2Rating` defaults to `'A'` and `isRental` to `false` rather than being
 * randomised, because tests assert on what those two produce: rating A/B is
 * what makes the API report `is_eco_friendly`, and checking "Item for rent"
 * clears the Stock field client-side (see productCrud.spec.ts).
 *
 * @param {Partial<NewProductData>} [overrides] - Fields to pin to a specific value.
 * @returns {NewProductData} Product form data.
 *
 * @example
 * // A rental product, everything else randomised
 * const product = generateProduct({ isRental: true });
 */
export const generateProduct = (
    overrides?: Partial<NewProductData>
): NewProductData => {
    return {
        name: `${faker.commerce.productName()} ${faker.string.alphanumeric(8)}`,
        description: faker.commerce.productDescription(),
        stock: String(faker.number.int({ min: 1, max: 99 })),
        price: faker.commerce.price({ min: 1, max: 999, dec: 2 }),
        co2Rating: 'A',
        isLocationOffer: true,
        isRental: false,
        ...overrides,
    };
};
