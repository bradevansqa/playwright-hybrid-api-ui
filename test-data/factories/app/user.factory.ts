import { faker } from '@faker-js/faker';
import {
    RegisterRequest,
    RegisterRequestSchema,
    UserResponse,
    UserResponseSchema,
} from '../../../fixtures/api/schemas/app/userSchema';

/**
 * Generates a valid user object with randomized data using Faker.
 * The generated data conforms to the UserResponseSchema structure.
 *
 * This factory ensures test isolation by creating unique data for each test run,
 * preventing data collision in parallel execution.
 *
 * @param {Partial<UserResponse>} overrides - Optional partial user object to override default values.
 * @returns {UserResponse} A valid user object matching the UserResponseSchema.
 *
 * @example
 * // Generate a random user
 * const user = generateUser();
 *
 * @example
 * // Generate a user with specific email
 * const adminUser = generateUser({ email: 'admin@test.com' });
 */
export const generateUser = (
    overrides?: Partial<UserResponse>
): UserResponse => {
    const defaultUser: UserResponse = {
        access_token: faker.string.alphanumeric(64),
        token_type: 'bearer',
        expires_in: faker.number.int({ min: 60, max: 3600 }),
    };

    const mergedUser = { ...defaultUser, ...overrides };

    // Validate against schema to ensure type safety
    return UserResponseSchema.parse(mergedUser);
};

/**
 * Generates login credentials for testing purposes.
 * Creates a unique email and password combination.
 *
 * @param {object} overrides - Optional overrides for email and/or password.
 * @param {string} overrides.email - Override the generated email.
 * @param {string} overrides.password - Override the generated password.
 * @returns {{ email: string; password: string }} Valid login credentials.
 *
 * @example
 * // Generate random credentials
 * const creds = generateLoginCredentials();
 *
 * @example
 * // Generate credentials with specific email
 * const creds = generateLoginCredentials({ email: 'specific@test.com' });
 */
export const generateLoginCredentials = (
    overrides?: Partial<{ email: string; password: string }>
): { email: string; password: string } => {
    return {
        email: overrides?.email ?? faker.internet.email(),
        password:
            overrides?.password ??
            faker.internet.password({
                length: 12,
                memorable: false,
                pattern: /[A-Za-z0-9!@#$%]/,
            }),
    };
};

/**
 * Generates a fully valid `POST /users/register` payload.
 *
 * Every value is chosen to satisfy the live server rules, not just the
 * schema, so that a negative test breaking one field gets an error for that
 * field alone:
 * - `password` is random with every required character class -- a fixed
 *   strong-looking password risks the API's data-leak check.
 * - `email` carries a random local part, so it never collides with an
 *   existing account ("A customer with this email address already exists").
 * - `address` is Dutch with an NL-format postcode, because the API checks the
 *   postcode format against the country.
 * - `dob` is 25-60 years ago, safely inside the 18-75 window.
 *
 * @param {Partial<RegisterRequest>} [overrides] - Fields to pin to a specific value.
 * @returns {RegisterRequest} A registration payload that passes validation.
 */
export const generateRegistration = (
    overrides?: Partial<RegisterRequest>
): RegisterRequest => {
    const registration: RegisterRequest = {
        first_name: faker.person.firstName().slice(0, 40),
        last_name: faker.person.lastName().slice(0, 20),
        address: {
            street: faker.location.street().slice(0, 70),
            house_number: faker.string.numeric({
                length: 2,
                allowLeadingZeros: false,
            }),
            city: faker.location.city().slice(0, 40),
            state: 'Utrecht',
            country: 'NL',
            postal_code: `${faker.number.int({ min: 1000, max: 9999 })}${faker.string.alpha({ length: 2, casing: 'upper' })}`,
        },
        phone: faker.string.numeric(10),
        dob: faker.date
            .birthdate({ mode: 'age', min: 25, max: 60 })
            .toISOString()
            .slice(0, 10),
        password: `${faker.string.alpha({ length: 4, casing: 'upper' })}${faker.string.alpha({ length: 4, casing: 'lower' })}${faker.string.numeric(3)}#!`,
        email: `qa.${faker.string.alphanumeric({ length: 12, casing: 'lower' })}@example.com`,
    };

    return RegisterRequestSchema.parse({ ...registration, ...overrides });
};
