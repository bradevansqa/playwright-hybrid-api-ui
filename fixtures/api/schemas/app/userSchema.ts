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

// Type exports
export type UserResponse = zOutput<typeof UserResponseSchema>;
export type LoginRequest = zOutput<typeof LoginRequestSchema>;
export type CurrentUserResponse = zOutput<typeof CurrentUserResponseSchema>;
