import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';

/**
 * Schema for user login response.
 * Customize this schema based on your API response structure.
 */
export const UserResponseSchema = z.strictObject({
    access_token: z.string(),
    token_type: z.string(),
    expires_in: z.int(),
});

/**
 * Schema for user login request payload.
 */
export const LoginRequestSchema = z.strictObject({
    email: z.email(),
    password: z.string().min(1),
});

/**
 * Schema for `GET /users/me`.
 *
 * Deliberately loose and `role`-optional: the live response shape differs by
 * role (verified via curl against both accounts). An admin gets `role`,
 * `enabled` and `failed_login_attempts`; a customer's response omits all
 * three entirely. That asymmetry is itself a role signal the role-access
 * tests assert on, so `role` must be optional rather than required.
 */
export const CurrentUserResponseSchema = z.looseObject({
    id: z.string(),
    email: z.email(),
    first_name: z.string(),
    last_name: z.string(),
    role: z.string().optional(),
});

/**
 * Schema for the `POST /users/register` payload -- a 1:1 mirror of the
 * OpenAPI `UserRequest` contract, including its documented length limits
 * and required set (`first_name`, `last_name`, `email`, `password`; the
 * rest optional).
 * Used by the registration factory to guarantee the baseline payload is
 * valid before negative tests break one field at a time.
 *
 * `dob` must also be 18-75 years ago and `password` must mix upper/lower
 * case, a number and a symbol and not appear in a known data leak; those
 * rules are server-side and documented only as prose, so they are left to
 * the factory rather than encoded here.
 */
export const RegisterRequestSchema = z.strictObject({
    first_name: z.string().max(40),
    last_name: z.string().max(20),
    address: z
        .strictObject({
            street: z.string().max(70).optional(),
            house_number: z.string().max(10).optional(),
            city: z.string().max(40).optional(),
            state: z.string().max(40).optional(),
            country: z.string().max(40).optional(),
            postal_code: z.string().max(10).optional(),
        })
        .optional(),
    phone: z.string().max(24).optional(),
    dob: z.iso.date().optional(),
    password: z.string().min(8),
    email: z.email().max(256),
});

/**
 * Schema for the `POST /users/register` 201 response -- a 1:1 mirror of the
 * OpenAPI `UserResponse` contract (its address nullability included). Never
 * exercised against the shared instance, where a 201 would create a real,
 * undeletable account; see the skipped 201 test in registration.spec.ts.
 */
export const RegisterResponseSchema = z.strictObject({
    id: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    address: z.strictObject({
        street: z.string(),
        house_number: z.string().nullable(),
        city: z.string(),
        state: z.string().nullable(),
        country: z.string(),
        postal_code: z.string().nullable(),
    }),
    phone: z.string().nullable(),
    dob: z.string(),
    email: z.string(),
    provider: z.string().nullable(),
    totp_enabled: z.boolean(),
    enabled: z.boolean(),
    failed_login_attempts: z.int().nullable(),
    created_at: z.string(),
});

// Type exports
export type UserResponse = zOutput<typeof UserResponseSchema>;
export type LoginRequest = zOutput<typeof LoginRequestSchema>;
export type CurrentUserResponse = zOutput<typeof CurrentUserResponseSchema>;
export type RegisterRequest = zOutput<typeof RegisterRequestSchema>;
export type RegisterResponse = zOutput<typeof RegisterResponseSchema>;
