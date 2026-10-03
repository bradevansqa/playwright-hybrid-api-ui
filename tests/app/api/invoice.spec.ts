import { ApiEndpoints } from '../../../enums/app/app';
import { Roles } from '../../../enums/util/roles';
import {
    InvoiceResponse,
    InvoiceResponseSchema,
} from '../../../fixtures/api/schemas/app/invoiceSchema';
import { expect, test } from '../../../fixtures/pom/test-options';

test.describe('api/invoices', () => {
    // FIXME: expected to fail until the API matches its documented contract.
    // Live `GET /invoices/{id}` responses include an undocumented `payment`
    // object and `eco_discount_percentage` / `eco_discount_amount` fields
    // that `InvoiceResponseSchema` (a 1:1 mirror of the OpenAPI contract)
    // does not declare, so `.parse()` throws `unrecognized_keys`. It also
    // returns `null` for fields the contract types as non-nullable
    // (`additional_discount_percentage`, `status_message`, and per line
    // `discount_percentage`, `discounted_price`, `product.in_stock`) and
    // omits `product.is_location_offer` -- see the FIXME banner in
    // fixtures/api/schemas/app/invoiceSchema.ts. This test
    // documents that contract bug via `test.fail()`: Playwright asserts it
    // actually fails, so the suite stays green until the day the API (or
    // the documented contract) is fixed -- at which point this test starts
    // passing unexpectedly, Playwright reports *that* as a failure, and
    // `test.fail()` should be removed here.
    test.fail(
        'should return an invoice matching the documented InvoiceResponseSchema',
        { tag: '@api' },
        async ({ seededInvoice, apiRequest, tokenFor }) => {
            const { status, body } = await apiRequest<InvoiceResponse>({
                method: 'GET',
                url: `${ApiEndpoints.INVOICES}/${seededInvoice.id}`,
                baseUrl: process.env.API_URL,
                headers: await tokenFor(Roles.ADMIN),
            });

            expect(status).toBe(200);
            expect(InvoiceResponseSchema.parse(body)).toBeTruthy();
        }
    );
});
