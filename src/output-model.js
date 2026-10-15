import { estimateEntropy } from "./generator.js";

/**
 * Build an immutable snapshot of one generated result.
 * Password, effective character pool, options and entropy travel together so
 * the UI cannot accidentally describe an old password with live settings.
 */
export function createOutputSnapshot(password, options) {
  if (typeof password !== "string" || password.length !== Number(options?.length)) {
    throw new TypeError("Password and generation options must describe the same output.");
  }

  const settings = Object.freeze({
    length: Number(options.length),
    uppercase: options.uppercase === true,
    lowercase: options.lowercase === true,
    numbers: options.numbers === true,
    symbols: options.symbols === true,
    excludeAmbiguous: options.excludeAmbiguous === true,
  });
  const entropy = estimateEntropy(settings.length, settings);

  return Object.freeze({
    password,
    options: settings,
    entropy: Object.freeze({
      bits: entropy.bits,
      poolSize: entropy.poolSize,
      validPasswordCount: entropy.validPasswordCount,
    }),
  });
}

/** Compare live controls with the exact settings captured at generation time. */
export function isOutputCurrent(snapshot, currentOptions) {
  if (!snapshot || !currentOptions) return false;
  return Object.keys(snapshot.options).every((key) => snapshot.options[key] === currentOptions[key]);
}
