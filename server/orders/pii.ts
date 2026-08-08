import type { ShippingAddress } from "../../shared/contracts/orders.js";
import type { DataProtectionKeyring } from "../security/dataProtection.js";
import type { OrderPiiProtector, ProtectedOrderPii } from "./types.js";

export class KeyringOrderPiiProtector implements OrderPiiProtector {
  constructor(
    private readonly keyring: DataProtectionKeyring,
    private readonly currentVersion: number,
  ) {}

  protect(input: {
    orderId: string;
    customerEmail: string;
    shippingAddress: ShippingAddress;
  }): ProtectedOrderPii {
    return {
      customerEmailCiphertext: this.keyring.encrypt(
        input.customerEmail,
        `photobook-order:${input.orderId}:customer-email`,
      ),
      shippingDetailsCiphertext: this.keyring.encrypt(
        JSON.stringify(input.shippingAddress),
        `photobook-order:${input.orderId}:shipping-address`,
      ),
      encryptionKeyVersion: this.currentVersion,
    };
  }
}
