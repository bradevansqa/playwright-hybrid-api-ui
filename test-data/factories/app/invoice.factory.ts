import { faker } from '@faker-js/faker';
import { z } from 'zod/v4';

/**
 * `status_message` on `PUT /invoices/{id}/status` must be 5-50 characters
 * (server-side rule, verified live -- a longer message is rejected with 422).
 */
const StatusMessageSchema = z.string().min(5).max(50);

/**
 * Generates a valid invoice status message.
 *
 * Bounded deliberately: an unbounded `faker.lorem.sentence()` sometimes
 * exceeds the 50-character limit, which would turn a status change into a
 * validation error -- and let a `test.fail()` authorisation test "fail" for
 * the wrong reason.
 *
 * @returns {string} A 5-50 character status message.
 */
export const generateStatusMessage = (): string =>
    StatusMessageSchema.parse(
        faker.lorem.words({ min: 2, max: 4 }).padEnd(5, '.').slice(0, 50)
    );
