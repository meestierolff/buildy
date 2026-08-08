export class FulfilmentError extends Error {
  constructor(
    public readonly code:
      | "WORKER_LEASE_LOST"
      | "INVALID_JOB"
      | "PII_INVALID"
      | "PDF_MISSING"
      | "PDF_MISMATCH"
      | "SIGNED_URL_INVALID"
      | "OFFERING_MISMATCH"
      | "PAYMENT_RETRY_REQUIRED"
      | "ORDER_REFERENCE_MISMATCH",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FulfilmentError";
  }
}
