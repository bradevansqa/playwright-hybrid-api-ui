import type { Page } from '@playwright/test';
import { BrowserStorageKeys } from '../../enums/app/app';

/**
 * Reads the JWT belonging to the *browser* session, straight out of the
 * app's own localStorage.
 *
 * Why this exists: a storage state and an API token are separate auth
 * artifacts. Calling `GET /users/me` with a token minted by the `role`
 * fixture proves nothing about who the browser is logged in as. Feeding this
 * token to `/users/me` instead ties the identity assertion to the session
 * actually under test.
 *
 * The page must already be on the app's origin -- localStorage is
 * origin-scoped, so a freshly created page (`about:blank`) has nothing to
 * read.
 *
 * @param {Page} page - Page already navigated to the application.
 * @returns {Promise<string>} The session's JWT.
 * @throws {Error} If no token is present for the current origin.
 */
export async function readSessionAuthToken(page: Page): Promise<string> {
    const token = await page.evaluate(
        (key) => localStorage.getItem(key),
        BrowserStorageKeys.AUTH_TOKEN
    );

    if (!token) {
        throw new Error(
            `No "${BrowserStorageKeys.AUTH_TOKEN}" in localStorage for ${page.url()}. Navigate to the app (and be logged in) before reading the session token.`
        );
    }

    return token;
}
