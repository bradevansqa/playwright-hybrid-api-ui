/**
 * Domain-specific invalid data for `POST /users/register` negative tests.
 *
 * Format: `.ts` with `as const` exports -- literals only (no imports, no
 * computed values). See `.claude/skills/data-strategy/SKILL.md` (Tier 2).
 */

/**
 * A date of birth the API always rejects ("Customer must be 18 years old").
 * Sent alongside every negative payload as a guard so that no request can
 * ever create an account -- even if the field under test turns out not to
 * be validated. Fixed, not computed: it stays under 18 until 2038.
 */
export const UNDERAGE_DOB = '2020-01-01';

/** Passwords each breaking exactly one documented password rule. */
export const WEAK_PASSWORDS = [
    { description: 'shorter than 8 characters', password: 'Ab1!xyz' },
    { description: 'without an uppercase letter', password: 'abcdefg1!' },
    { description: 'without a lowercase letter', password: 'ABCDEFG1!' },
    { description: 'without a number', password: 'Abcdefgh!' },
    { description: 'without a symbol', password: 'Abcdefg12' },
    { description: 'found in a known data leak', password: 'Password1!' },
] as const;

/** Dates of birth outside the documented 18-75 window or format. */
export const INVALID_DOBS = [
    { description: 'under 18', dob: UNDERAGE_DOB },
    { description: 'over 75', dob: '1900-01-01' },
    { description: 'in the future', dob: '2999-01-01' },
    { description: 'not in Y-m-d format', dob: '01/01/1990' },
] as const;

/**
 * Emails invalid under any validator (RFC, strict or DNS-free). Deliberately
 * excludes borderline cases like `user@domain`, which RFC-mode validators
 * accept -- so these tests stay meaningful once format validation exists.
 */
export const MALFORMED_EMAILS = [
    'plaintext',
    '@missing-local.com',
    'double@@at.com',
] as const;
