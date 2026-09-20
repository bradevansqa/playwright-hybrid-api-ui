/**
 * Reads a required environment variable, throwing if it is missing or empty.
 *
 * Use this instead of a `process.env.FOO!` non-null assertion wherever a
 * missing value would otherwise surface as a confusing downstream failure
 * (an empty password posted to a login endpoint, a `undefined` in a URL).
 *
 * @param {string} name - Environment variable name.
 * @returns {string} The variable's value.
 * @throws {Error} If the variable is unset or empty.
 *
 * @example
 * ```ts
 * const password = requireEnv('CUSTOMER_PASSWORD');
 * ```
 */
export function requireEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(
            `Missing required environment variable ${name}. Add it to env/.env.${process.env.ENVIRONMENT ?? 'dev'} (see env/.env.example).`
        );
    }

    return value;
}
