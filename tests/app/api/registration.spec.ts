import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/app/app';
import {
    UnprocessableEntityResponse,
    UnprocessableEntityResponseSchema,
} from '../../../fixtures/api/schemas/util/errorResponseSchema';
import {
    RegisterRequest,
    RegisterResponseSchema,
} from '../../../fixtures/api/schemas/app/userSchema';
import type { ApiRequestFn } from '../../../fixtures/api/api-types';
import { generateRegistration } from '../../../test-data/factories/app/user.factory';
import {
    INVALID_DOBS,
    MALFORMED_EMAILS,
    UNDERAGE_DOB,
    WEAK_PASSWORDS,
} from '../../../test-data/static/app/registration';
import {
    INVALID_OBJECT_VALUES,
    INVALID_STRING_VALUES,
} from '../../../test-data/static/util/invalid-values';
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
 * Status-code coverage: the OpenAPI spec documents 201/400/401/403/409 for
 * this endpoint. Validation failures actually return 422 with a field ->
 * messages map (asserted throughout, per `api-testing` Phase 7 -- assert the
 * real status code, note the divergence), and a duplicate email is a 422
 * too. Each documented code also has its own spec-shaped test at the end of
 * this file, skipped with a FIXME explaining why -- no silent coverage drops.
 */

const DOB_GUARD = { dob: UNDERAGE_DOB } as const;
/** One over the documented 40-character `first_name` limit. */
const FIRST_NAME_GUARD = { first_name: 'x'.repeat(41) } as const;

/**
 * Optional string fields per the contract, each with the guard that does not
 * collide with it. Leaving one out must be accepted; a wrong type must not.
 */
const OPTIONAL_STRING_FIELDS = [
    { field: 'phone', guard: DOB_GUARD },
    { field: 'dob', guard: FIRST_NAME_GUARD },
] as const;

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
    expect(UnprocessableEntityResponseSchema.parse(body)).toBeTruthy();

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

    for (const { field, guard } of OPTIONAL_STRING_FIELDS) {
        const guardField = Object.keys(guard)[0];

        test(
            `should accept a registration without the optional ${field}`,
            { tag: '@regression' },
            async ({ apiRequest }) => {
                const { [field]: _omitted, ...withoutField } =
                    generateRegistration();

                const errors = await registerExpectingRejection(apiRequest, {
                    ...withoutField,
                    ...guard,
                });

                expect(failedFields(errors)).toEqual([guardField]);
            }
        );

        // `undefined` is the omission case above, not an invalid type.
        for (const invalidValue of INVALID_STRING_VALUES.filter(
            (value) => value !== undefined
        )) {
            test(
                `should reject ${field} = ${JSON.stringify(invalidValue)}`,
                { tag: '@regression' },
                async ({ apiRequest }) => {
                    const errors = await registerExpectingRejection(
                        apiRequest,
                        {
                            ...generateRegistration(),
                            [field]: invalidValue,
                            ...guard,
                        }
                    );

                    expect(failedFields(errors)).toEqual(
                        [field, guardField].sort()
                    );
                }
            );
        }
    }

    test(
        'should accept a registration without the optional address',
        { tag: '@regression' },
        async ({ apiRequest }) => {
            const { address: _omitted, ...withoutAddress } =
                generateRegistration();

            const errors = await registerExpectingRejection(apiRequest, {
                ...withoutAddress,
                ...DOB_GUARD,
            });

            expect(failedFields(errors)).toEqual(['dob']);
        }
    );

    // `undefined` is the omission case above; `[]` is covered by the
    // test.fail below, since the API wrongly accepts it.
    for (const invalidValue of INVALID_OBJECT_VALUES.filter(
        (value) => value !== undefined && !Array.isArray(value)
    )) {
        test(
            `should reject address = ${JSON.stringify(invalidValue)}`,
            { tag: '@regression' },
            async ({ apiRequest }) => {
                const errors = await registerExpectingRejection(apiRequest, {
                    ...generateRegistration(),
                    address: invalidValue,
                    ...DOB_GUARD,
                });

                expect(failedFields(errors)).toEqual(['address', 'dob']);
            }
        );
    }

    /*
     * FIXME: no ticket yet -- `address` is documented as an object, but the
     * API (PHP, where a JSON `[]` and `{}` both become an empty array)
     * accepts an empty JSON array. Asserted as it should behave;
     * `test.fail()` per the repo convention (see roleAccess.spec.ts).
     */
    test.fail(
        'should reject address = []',
        { tag: '@regression' },
        async ({ apiRequest }) => {
            const errors = await registerExpectingRejection(apiRequest, {
                ...generateRegistration(),
                address: [],
                ...DOB_GUARD,
            });

            expect(failedFields(errors)).toEqual(['address', 'dob']);
        }
    );

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
     * FIXME: no ticket yet -- missing validation, to report upstream.
     * `email` is documented as `format: email`, but the
     * API accepts any string -- `plaintext` included -- and would create an
     * account with it (the guard prevents that here). Every other documented
     * rule on this endpoint is enforced.
     *
     * Asserted as it should behave and marked `test.fail()` rather than
     * `test.skip` (repo convention, see roleAccess.spec.ts): green while the
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

    /*
     * ==================== Documented status codes ====================
     * Written as the spec describes, each skipped with the reason it cannot
     * run as written (api-testing: no silent coverage drops).
     */

    // FIXME: no ticket yet -- deliberately not run against the shared public
    // instance: a 201 creates a real account, and accounts cannot be deleted.
    // Enable once the suite targets a self-hosted Toolshop (README: Planned).
    // eslint-disable-next-line playwright/no-skipped-test -- documented status code kept per Constitution 'No Silent Coverage Drops'; see FIXME
    test.skip(
        'should register a new customer (201)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest({
                method: 'POST',
                url: ApiEndpoints.REGISTER,
                baseUrl: requireEnv('API_URL'),
                body: generateRegistration(),
            });

            expect(status).toBe(201);
            expect(RegisterResponseSchema.parse(body)).toBeTruthy();
        }
    );

    // FIXME: no ticket yet -- documented as 400; the API returns 422 for
    // every validation failure, which the per-field tests above assert.
    // eslint-disable-next-line playwright/no-skipped-test -- documented status code kept per Constitution 'No Silent Coverage Drops'; see FIXME
    test.skip(
        'should answer a validation failure with 400 as documented',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status } = await apiRequest({
                method: 'POST',
                url: ApiEndpoints.REGISTER,
                baseUrl: requireEnv('API_URL'),
                body: { ...generateRegistration(), ...DOB_GUARD },
            });

            expect(status).toBe(400);
        }
    );

    // FIXME: no ticket yet -- documented as 409; the API returns 422 for a
    // duplicate email, which the "already has an account" test asserts.
    // eslint-disable-next-line playwright/no-skipped-test -- documented status code kept per Constitution 'No Silent Coverage Drops'; see FIXME
    test.skip(
        'should answer a duplicate email with 409 as documented',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status } = await apiRequest({
                method: 'POST',
                url: ApiEndpoints.REGISTER,
                baseUrl: requireEnv('API_URL'),
                body: {
                    ...generateRegistration(),
                    email: requireEnv('CUSTOMER_EMAIL'),
                    ...DOB_GUARD,
                },
            });

            expect(status).toBe(409);
        }
    );

    // FIXME: no ticket yet -- 401 and 403 are documented for this public
    // endpoint with no stated trigger, and none could be found: an invalid
    // bearer token is ignored (verified live, still 422). Kept until the
    // spec says what produces them.
    for (const documentedStatus of [401, 403]) {
        // eslint-disable-next-line playwright/no-skipped-test -- documented status code kept per Constitution 'No Silent Coverage Drops'; see FIXME
        test.skip(
            `should answer ${documentedStatus} as documented (trigger unknown)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method: 'POST',
                    url: ApiEndpoints.REGISTER,
                    baseUrl: requireEnv('API_URL'),
                    body: { ...generateRegistration(), ...DOB_GUARD },
                });

                expect(status).toBe(documentedStatus);
            }
        );
    }
});
