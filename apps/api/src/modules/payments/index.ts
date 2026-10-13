import type { ModuleDefinition } from "../shared.js";
import { assertSameTenant, DomainValidationError, requireMinorMoney, type TenantContext } from "../catalog/tenant.js";
import type { OrderPaymentPort } from "../orders/index.js";

export const paymentsModule: ModuleDefinition = {
  name: "payments",
  routePrefix: "/v1/payments",
  description: "Manual payment registration, confirmation, partial collection, rejection, and refunds."
};

export type PaymentMethod = "bank_transfer" | "mercado_pago" | "cash_on_delivery" | "card" | "other";
export type PaymentStatus = "pending" | "confirmed" | "rejected" | "refunded";

export interface Payment {
  id: string;
  organizationId: string;
  orderId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  processingFeeMinor: number;
  paidAt?: string;
  confirmedAt?: string;
  confirmedByUserId?: string;
  externalReference?: string;
  proofUrl?: string;
  notes?: string;
}

export interface RegisterManualPaymentCommand {
  orderId: string;
  method: PaymentMethod;
  amountMinor: number;
  currency?: string;
  processingFeeMinor?: number;
  paidAt?: string;
  externalReference?: string;
  proofUrl?: string;
  notes?: string;
}

export interface PaymentRepository {
  create(context: TenantContext, payment: Omit<Payment, "id">): Promise<Payment>;
  find(context: TenantContext, paymentId: string): Promise<Payment | null>;
  save(context: TenantContext, payment: Payment): Promise<void>;
  listForOrder(context: TenantContext, orderId: string): Promise<Payment[]>;
}

export class PaymentsService {
  constructor(private readonly repository: PaymentRepository, private readonly orders: OrderPaymentPort) {}

  async registerManual(context: TenantContext, command: RegisterManualPaymentCommand): Promise<Payment> {
    requireMinorMoney(command.amountMinor, "amountMinor");
    requireMinorMoney(command.processingFeeMinor ?? 0, "processingFeeMinor");
    if (command.amountMinor === 0) throw new DomainValidationError("Payment amount must be greater than zero.");
    const order = await this.orders.getForPayment(context, command.orderId);
    assertSameTenant(context, order);
    if (order.currency !== (command.currency ?? "ARS")) throw new DomainValidationError("Payment currency must match the order currency.");
    if (command.amountMinor > order.outstandingAmountMinor) throw new DomainValidationError("Payment amount exceeds the outstanding order balance.");
    return this.repository.create(context, {
      organizationId: context.organizationId,
      orderId: command.orderId,
      method: command.method,
      status: "pending",
      amountMinor: command.amountMinor,
      currency: command.currency ?? "ARS",
      processingFeeMinor: command.processingFeeMinor ?? 0,
      paidAt: command.paidAt,
      externalReference: command.externalReference,
      proofUrl: command.proofUrl,
      notes: command.notes
    });
  }

  async confirm(context: TenantContext, paymentId: string, now = new Date()): Promise<Payment> {
    const payment = await this.getRequired(context, paymentId);
    if (payment.status !== "pending") throw new DomainValidationError("Only pending payments can be confirmed.");
    await this.orders.recordConfirmedPayment(context, payment.orderId, payment.amountMinor);
    payment.status = "confirmed";
    payment.confirmedAt = now.toISOString();
    payment.confirmedByUserId = context.actorUserId;
    await this.repository.save(context, payment);
    return payment;
  }

  async reject(context: TenantContext, paymentId: string): Promise<Payment> {
    const payment = await this.getRequired(context, paymentId);
    if (payment.status !== "pending") throw new DomainValidationError("Only pending payments can be rejected.");
    const payments = await this.repository.listForOrder(context, payment.orderId);
    const hasConfirmed = payments.some((item) => item.status === "confirmed");
    if (!hasConfirmed) await this.orders.recordRejectedPayment(context, payment.orderId);
    payment.status = "rejected";
    await this.repository.save(context, payment);
    return payment;
  }

  async markRefunded(context: TenantContext, paymentId: string): Promise<Payment> {
    const payment = await this.getRequired(context, paymentId);
    if (payment.status !== "confirmed") throw new DomainValidationError("Only confirmed payments can be refunded.");
    // A refund workflow must create its own settlement record before this flag is set.
    payment.status = "refunded";
    await this.repository.save(context, payment);
    return payment;
  }

  private async getRequired(context: TenantContext, paymentId: string): Promise<Payment> {
    const payment = await this.repository.find(context, paymentId);
    if (!payment) throw new DomainValidationError("Payment was not found.");
    assertSameTenant(context, payment);
    return payment;
  }
}
