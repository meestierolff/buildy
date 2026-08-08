import { z } from "zod";

import { shippingAddressSchema } from "../../shared/contracts/orders.js";
import { DataProtectionError, type DataProtectionKeyring } from "../security/dataProtection.js";
import { FulfilmentError } from "./errors.js";
import type { FulfilmentPiiReader, PeechoFulfilmentJob, RevealedFulfilmentPii } from "./types.js";

const customerEmailSchema = z.string().trim().email().max(320);

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new FulfilmentError("PII_INVALID", "Versleutelde ordergegevens zijn ongeldig.", { cause: error });
  }
}

export class KeyringFulfilmentPiiReader implements FulfilmentPiiReader {
  constructor(private readonly keyring: DataProtectionKeyring) {}

  reveal(job: PeechoFulfilmentJob): RevealedFulfilmentPii {
    const expectedPrefix = `v1.${job.piiEncryptionKeyVersion}.`;
    if (
      !job.customerEmailCiphertext.startsWith(expectedPrefix)
      || !job.shippingDetailsCiphertext.startsWith(expectedPrefix)
    ) {
      throw new FulfilmentError("PII_INVALID", "Ordergegevens gebruiken een onverwachte sleutelversie.");
    }

    try {
      const customerEmail = customerEmailSchema.parse(this.keyring.decrypt(
        job.customerEmailCiphertext,
        `photobook-order:${job.orderId}:customer-email`,
      ));
      const shippingAddress = shippingAddressSchema.parse(parseJson(this.keyring.decrypt(
        job.shippingDetailsCiphertext,
        `photobook-order:${job.orderId}:shipping-address`,
      )));
      if (shippingAddress.countryCode !== job.shippingCountry) {
        throw new FulfilmentError("PII_INVALID", "Verzendland wijkt af van de immutable ordersnapshot.");
      }
      return { customerEmail, shippingAddress };
    } catch (error) {
      if (error instanceof FulfilmentError) throw error;
      if (error instanceof DataProtectionError || error instanceof z.ZodError) {
        throw new FulfilmentError("PII_INVALID", "Ordergegevens konden niet veilig worden ontsleuteld.", {
          cause: error,
        });
      }
      throw error;
    }
  }
}
