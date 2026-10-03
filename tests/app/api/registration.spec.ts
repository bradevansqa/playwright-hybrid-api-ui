import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/app/app';
import {
    UnprocessableEntityResponse,
    UnprocessableEntityResponseSchema,
} from '../../../fixtures/api/schemas/util/errorResponseSchema';
import type { RegisterRequest } from '../../../fixtures/api/schemas/app/userSchema';
import type { ApiRequestFn } from '../../../fixtures/api/api-types';
import { generateRegistration } from '../../../test-data/factories/app/user.factory';
import {
    INVALID_DOBS,
    MALFORMED_EMAILS,
    UNDERAGE_DOB,
    WEAK_PASSWORDS,
} from '../../../test-data/static/app/registration';
import { INVALID_STRING_VALUES } from '../../../test-data/static/util/invalid-values';
import { requireEnv } from '../../../helpers/util/requireEnv';

/**
 * Per-field validation of `POST /users/register`.
 *
 * Guard field: every payload also carries a second, always-rejected value
 * (an under-18 `dob`, or an over-long `first_name` when `dob` itself is under
 * test). Laravel validates every field and reports all failures at once, so
 * the guard does not mask the field under test -- but it does guarantee that
 * no request in this file can ever create an account on the shared instance,
 * even when the field under test is not validated at all (see the email
 * format tests below). Each test asserts the error keys are exactly
 * `{field under test, guard}`, which also proves the rest of the factory
 * payload is valid.
 *
 * Spec discrepancy (per `api-testing` Phase 7 -- assert the real status
 * code, note the divergence): the OpenAPI spec documents 201/400/401/403/409
 * for this endpoint. Validation failures actually return 422 with a
 * field -> messages map, and a duplicate email is a 422 too, not the
 * documented 409.
 */

const DOB_GUARD = { dob: UNDERAGE_DOB } as const;
const FIRST_NAME_GUARD = { first_name: 'x'.repeat(41) } as const;

/** Required fields per the OpenAPI `UserRequest` contract. */
const REQUIRED_FIELDS = [
    'first_name',
    'last_name',
    'email',
    'password',
] as const;

/**
 * One character over each documented `maxLength`. Field-specific, so inline
 * (see `api-testing` Phase 6). Nested address fields report their error
 * under a dotted key, e.g. `address.street`.
 *
 * `address.postal_code` (max 10) is omitted: the API also checks the postcode
 * format against the country, so no 10-character value passes as a valid
 * boundary and an over-long one fails the format rule under the same key --
 * the length limit cannot be isolated.
 */
const OVERLONG_VALUES: ReadonlyArray<{
    errorKey: string;
    limit: number;
    build: (valid: RegisterRequest, value: string) => RegisterRequest;
    value: (length: number) => string;
}> = [
    ...(['first_name', 'last_name', 'phone'] as const).map((field) => ({
        errorKey: field,
        limit: { first_name: 40, last_name: 20, phone: 24 }[field],
        build: (valid: RegisterRequest, value: string): RegisterRequest => ({
            ...valid,
            [field]: value,
        }),
        value: (length: number): string =>
            (field === 'phone' ? '1' : 'x').repeat(length),
    })),
    {
        errorKey: 'email',
        limit: 256,
        build: (valid, value) => ({ ...valid, email: value }),
        value: (length) => `${'a'.repeat(length - 12)}@example.com`,
    },
    ...(
        [
            ['street', 70],
            ['house_number', 10],
            ['city', 40],
            ['state', 40],
            ['country', 40],
        ] as const
    ).map(([field, limit]) => ({
        errorKey: `address.${field}`,
        limit,
        build: (valid: RegisterRequest, value: string): RegisterRequest => ({
            ...valid,
            address: { ...valid.address, [field]: value },
        }),
        value: (length: number): string => 'x'.repeat(length),
    })),
];

/**
 * Sends a registration payload that must be rejected and returns its
 * validation errors.
 *
 * @param {ApiRequestFn} apiRequest - The apiRequest fixture.
 * @param {Record<string, unknown>} payload - The invalid registration payload.
 * @returns {Promise<UnprocessableEntityResponse>} Field -> messages map.
 */
async function registerExpectingRejection(
    apiRequest: ApiRequestFn,
    payload: Record<string, unknown>
): Promise<UnprocessableEntityResponse> {
    const { status, body } = await apiRequest({
        method: 'POST',
        url: ApiEndpoints.REGISTER,
        baseUrl: requireEnv('API_URL'),
        body: payload,
    });

    expect(status).toBe(422);

    return UnprocessableEntityResponseSchema.parse(body);
}

/**
 * Sorted error keys, for an order-independent exact comparison.
 *
 * @param {UnprocessableEntityResponse} errors - Validation error map.
 * @returns {string[]} The field names that failed validation.
 */
function failedFields(errors: UnprocessableEntityResponse): string[] {
    return Object.keys(errors).sort();
}

test.describe('api registration validation', () => {
    test(
        'should reject only the guard when the rest of the payload is valid',
        { tag: '@api' },
        async ({ apiRequest }) => {
            let errors: UnprocessableEntityResponse;

            await test.step('WHEN a valid registration payload is sent with the under-18 guard', async () => {
                errors = await registerExpectingRejection(apiRequest, {
                    ...generateRegistration(),
                    ...DOB_GUARD,
                });
            });

            await test.step('THEN dob is the only field rejected', async () => {
                expect(failedFields(errors)).toEqual(['dob']);
            });
        }
    );

    for (const field of REQUIRED_FIELDS) {
        test(
            `should reject a registration without ${field}`,
            { tag: '@regression' },
            async ({ apiRequest }) => {
                const { [field]: _omitted, ...withoutField } =
                    generateRegistration();

                const errors = await registerExpectingRejection(apiRequest, {
                    ...withoutField,
                    ...DOB_GUARD,
                });

                expect(failedFields(errors)).toEqual([field, 'dob'].sort());
            }
        );
    }

    for (const field of REQUIRED_FIELDS) {
        for (const invalidValue of INVALID_STRING_VALUES) {
            test(
                `should reject ${field} = ${String(JSON.stringify(invalidValue))}`,
                { tag: '@regression' },
                async ({ apiRequest }) => {
                    const errors = await registerExpectingRejection(
                        apiRequest,
                        {
                            ...generateRegistration(),
                            [field]: invalidValue,
                            ...DOB_GUARD,
                        }
                    );

                    expect(failedFields(errors)).toEqual([field, 'dob'].sort());
                }
            );
        }
    }

    for (const { errorKey, limit, build, value } of OVERLONG_VALUES) {
        test(
            `should reject ${errorKey} longer than ${limit} characters`,
            { tag: '@regression' },
            async ({ apiRequest }) => {
                const valid = generateRegistration();

                await test.step(`GIVEN ${errorKey} at exactly ${limit} characters is accepted`, async () => {
                    const errors = await registerExpectingRejection(
                        apiRequest,
                        { ...build(valid, value(limit)), ...DOB_GUARD }
                    );

                    expect(failedFields(errors)).toEqual(['dob']);
                });

                await test.step(`WHEN it is ${limit + 1} characters THEN it is rejected`, async () => {
                    const errors = await registerExpectingRejection(
                        apiRequest,
                        { ...build(valid, value(limit + 1)), ...DOB_GUARD }
                    );

                    expect(failedFields(errors)).toEqual(
                        [errorKey, 'dob'].sort()
                    );
                });
            }
        );
    }

    for (const { description, password } of WEAK_PASSWORDS) {
        test(
            `should reject a password ${description}`,
            { tag: '@regression' },
            async ({ apiRequest }) => {
                const errors = await registerExpectingRejection(apiRequest, {
                    ...generateRegistration(),
                    password,
                    ...DOB_GUARD,
                });

                expect(failedFields(errors)).toEqual(['dob', 'password']);
            }
        );
    }

    for (const { description, dob } of INVALID_DOBS) {
        test(
            `should reject a date of birth ${description}`,
            { tag: '@regression' },
            async ({ apiRequest }) => {
                const errors = await registerExpectingRejection(apiRequest, {
                    ...generateRegistration(),
                    dob,
                    ...FIRST_NAME_GUARD,
                });

                expect(failedFields(errors)).toEqual(['dob', 'first_name']);
            }
        );
    }

    test(
        'should reject an email that already has an account',
        { tag: '@regression' },
        async ({ apiRequest }) => {
            // Documented as 409 Conflict; the API answers 422 (see header).
            const errors = await registerExpectingRejection(apiRequest, {
                ...generateRegistration(),
                email: requireEnv('CUSTOMER_EMAIL'),
                ...DOB_GUARD,
            });

            expect(failedFields(errors)).toEqual(['dob', 'email']);
        }
    );

    /*
     * Missing validation: `email` is documented as `format: email`, but the
     * API accepts any string -- `plaintext` included -- and would create an
     * account with it (the guard prevents that here). Every other documented
     * rule on this endpoint is enforced.
     *
     * Asserted as it should behave and marked `test.fail()`: green while the
     * flaw exists, failing loudly -- prompting removal of `test.fail()` --
     * once fixed.
     */
    for (const email of MALFORMED_EMAILS) {
        test.fail(
            `should reject the malformed email "${email}"`,
            { tag: '@regression' },
            async ({ apiRequest }) => {
                let errors: UnprocessableEntityResponse;

                await test.step(`WHEN registering with "${email}"`, async () => {
                    errors = await registerExpectingRejection(apiRequest, {
                        ...generateRegistration(),
                        email,
                        ...DOB_GUARD,
                    });
                });

                await test.step('THEN email should be rejected alongside the guard (currently is not)', async () => {
                    expect(failedFields(errors)).toEqual(['dob', 'email']);
                });
            }
        );
    }
});
