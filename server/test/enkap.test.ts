import type { Payment } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.js", () => ({
  env: {
    API_URL: "https://api.example.test",
    APP_URL: "https://app.example.test",
    ENKAP_ACCESS_TOKEN: "test-access-token",
    ENKAP_API_BASE_URL: "https://enkap.example.test/context",
  },
}));

import { enkapGateway } from "../src/services/payments/gateways/enkap.js";

const payment = {
  id: "payment-1",
  userId: "user-1",
  plan: "PRO",
  amountXaf: 2_000,
  chargeAmount: "2000",
  chargeCurrency: "XAF",
  method: "ENKAP",
  provider: "ENKAP",
  reference: "OJ-TEST-123456",
  providerRef: "enkap-tx-1",
  status: "PENDING",
  failureReason: null,
  meta: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  completedAt: null,
} satisfies Payment;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ENKAP gateway", () => {
  it("creates an XAF hosted order with return and notification URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          orderTransactionId: "enkap-tx-1",
          merchantReferenceId: payment.reference,
          redirectUrl: "https://payment.enkap.example.test/checkout/enkap-tx-1",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const checkout = await enkapGateway.createCheckout({
      payment,
      method: "ENKAP",
      planName: "Pro",
      user: { id: payment.userId, name: "Test User", email: "test@example.test", phone: null },
    });

    expect(checkout).toEqual({
      redirectUrl: "https://payment.enkap.example.test/checkout/enkap-tx-1",
      providerRef: "enkap-tx-1",
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://enkap.example.test/context/api/order");
    expect(options.headers).toMatchObject({ Authorization: "Bearer test-access-token" });
    const request = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(request).toMatchObject({
      currency: "XAF",
      merchantReference: payment.reference,
      totalAmount: payment.amountXaf,
      returnUrl: "https://api.example.test/api/payments/enkap/return",
      notificationUrl: "https://api.example.test/api/payments/webhooks/enkap",
    });
  });

  it("confirms only provider-reported payments matching the merchant reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: { uuid: "enkap-tx-1" },
          paymentStatus: "CONFIRMED",
          order: { merchantReference: payment.reference, totalAmount: 2_000, currency: "XAF" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(enkapGateway.verify(payment)).resolves.toEqual({
      status: "SUCCEEDED",
      providerRef: "enkap-tx-1",
      paidAmount: 2_000,
      paidCurrency: "XAF",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://enkap.example.test/context/api/order?txid=enkap-tx-1");
  });

  it("rejects a confirmed order with a different merchant reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: { uuid: "enkap-tx-1" },
            paymentStatus: "CONFIRMED",
            order: { merchantReference: "another-order", totalAmount: 2_000, currency: "XAF" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(enkapGateway.verify(payment)).resolves.toMatchObject({
      status: "FAILED",
      reason: "Reference mismatch",
    });
  });
});
