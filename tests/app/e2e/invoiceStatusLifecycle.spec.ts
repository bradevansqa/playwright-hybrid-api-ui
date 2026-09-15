import { z } from 'zod/v4';
import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/app/app';

/**
 * Invoice status lifecycle: seeds an invoice via the API as admin, then
 * transitions its status through the admin UI and asserts the change.
 *
 * Setup and teardown both go through the `seededInvoice` helper fixture
 * (`fixtures/helper/helper-fixture.ts`): it creates the invoice via the API
 * before this test runs, and reverts its status via the API afterward --
 * even if an assertion below fails -- since the Invoice API has no DELETE
 * endpoint to remove it outright.
 */

/**
 * Minimal local schema for the GET /invoices/{id} verification call below --
 * asserts only the `id`/`status` fields this test consumes, not the full
 * documented contract. The full `InvoiceResponseSchema`
 * (fixtures/api/schemas/app/invoiceSchema.ts) is `z.strictObject()` and
 * intentionally rejects live responses (undocumented `payment` /
 * `eco_discount_*` fields -- see its FIXME banner), so it isn't used here.
 */
const InvoiceStatusResponseSchema = z.looseObject({
    id: z.string(),
    status: z.string(),
});

test.describe('admin invoice status lifecycle', () => {
    test(
        'should transition a freshly seeded invoice to a new status via the admin UI',
        { tag: '@e2e' },
        async ({ seededInvoice, adminOrderEditPage, apiRequest }) => {
            const NEW_STATUS = 'ON_HOLD';

            await test.step('GIVEN an invoice has been seeded via the API as admin', async () => {
                expect(seededInvoice.status).toBe('AWAITING_FULFILLMENT');
            });

            await test.step('WHEN the admin opens the invoice in the admin UI', async () => {
                await adminOrderEditPage.open(seededInvoice.id);
                await expect(adminOrderEditPage.invoiceNumberInput).toHaveValue(
                    seededInvoice.invoice_number
                );
            });

            await test.step('AND transitions the invoice status to ON_HOLD', async () => {
                await adminOrderEditPage.updateStatus(NEW_STATUS);
            });

            await test.step('AND the page is reloaded to read back persisted state', async () => {
                await adminOrderEditPage.reload();
            });

            await test.step('THEN the Status dropdown reflects the new status', async () => {
                await expect(adminOrderEditPage.statusSelect).toHaveValue(
                    NEW_STATUS
                );
            });

            await test.step('AND GET /invoices/{id} confirms the status was persisted', async () => {
                const { status, body } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.INVOICES}/${seededInvoice.id}`,
                    baseUrl: process.env.API_URL,
                    headers: process.env.ACCESS_TOKEN,
                });

                expect(status).toBe(200);
                const invoice = InvoiceStatusResponseSchema.parse(body);
                expect(invoice.status).toBe(NEW_STATUS);
            });
        }
    );
});
