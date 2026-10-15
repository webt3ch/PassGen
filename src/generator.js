/**
 * PassGen password-generation primitives.
 *
 * All character selections use Web Crypto plus rejection sampling, so the
 * integer selection is unbiased. Candidate passwords are sampled uniformly
 * from the selected pool and rejected unless every enabled character set is
 * represented. This makes every valid output string equiprobable.
 */

const CHARACTER_SETS = Object.freeze({
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/",
});

const AMBIGUOUS_CHARACTERS = new Set(["I", "l", "1", "O", "0"]);
const UINT32_RANGE = 0x1_0000_0000;
const MIN_LENGTH = 8;
const MAX_LENGTH = 64;

/** Return an unbiased integer in [0, maxExclusive) using Web Crypto. */
export function secureRandomInt(maxExclusive) {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new RangeError("maxExclusive must be an integer between 1 and 2^32.");
  }
  if (maxExclusive === 1) return 0;
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Web Crypto is unavailable. Open PassGen in a modern browser over HTTPS or localhost.");
  }

  // Discard the incomplete tail of the 32-bit range to avoid modulo bias.
  const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  let value;
  do {
    globalThis.crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % maxExclusive;
}

function validateLength(lengthValue) {
  const length = Number(lengthValue);
  if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
    throw new RangeError(`Password length must be an integer between ${MIN_LENGTH} and ${MAX_LENGTH}.`);
  }
  return length;
}

/** Resolve selected character sets after applying the ambiguous-character rule. */
export function getCharacterSets(options) {
  const selectedKeys = Object.keys(CHARACTER_SETS).filter((key) => options?.[key] === true);
  if (selectedKeys.length === 0) {
    throw new Error("Select at least one character set.");
  }

  return selectedKeys.map((key) => {
    let characters = CHARACTER_SETS[key];
    if (options.excludeAmbiguous) {
      characters = [...characters].filter((character) => !AMBIGUOUS_CHARACTERS.has(character)).join("");
    }
    if (characters.length === 0) {
      throw new Error(`The ${key} character set is empty with the current options.`);
    }
    return { key, characters };
  });
}

function containsEverySelectedSet(candidate, sets) {
  const candidateCharacters = new Set(candidate);
  return sets.every(({ characters }) => [...characters].some((character) => candidateCharacters.has(character)));
}

/**
 * Generate a password of the requested length.
 *
 * Each candidate is drawn uniformly from the union alphabet. Candidates that
 * omit an enabled set are rejected. Conditional rejection preserves a uniform
 * distribution over all strings that satisfy the selected-set requirement.
 */
export function generatePassword(options) {
  const length = validateLength(options?.length);
  const sets = getCharacterSets(options);
  const pool = [...new Set(sets.map((set) => set.characters).join(""))];

  while (true) {
    const candidate = Array.from({ length }, () => pool[secureRandomInt(pool.length)]);
    if (containsEverySelectedSet(candidate, sets)) return candidate.join("");
  }
}

/** Compute log2 of a positive BigInt without converting the full value to Number. */
function log2BigInt(value) {
  if (value <= 0n) throw new RangeError("value must be positive.");
  const bitLength = value.toString(2).length;
  const shift = Math.max(0, bitLength - 53);
  const leadingBits = Number(value >> BigInt(shift));
  return Math.log2(leadingBits) + shift;
}

/**
 * Count valid output strings with inclusion–exclusion.
 * Character categories are disjoint, and the generator samples uniformly from
 * all valid strings, so log2(validCount) is the theoretical output entropy.
 */
export function estimateEntropy(lengthValue, options) {
  const length = validateLength(lengthValue);
  const sets = getCharacterSets(options);
  const poolSize = new Set(sets.map((set) => set.characters).join("")).size;
  let validCount = 0n;
  const subsetCount = 1 << sets.length;

  for (let mask = 0; mask < subsetCount; mask += 1) {
    let excludedCharacters = 0;
    let subsetSize = 0;
    for (let index = 0; index < sets.length; index += 1) {
      if ((mask & (1 << index)) !== 0) {
        excludedCharacters += sets[index].characters.length;
        subsetSize += 1;
      }
    }

    const remainingPoolSize = poolSize - excludedCharacters;
    const count = BigInt(remainingPoolSize) ** BigInt(length);
    validCount += subsetSize % 2 === 0 ? count : -count;
  }

  if (validCount <= 0n) {
    throw new Error("No valid passwords are possible with the current configuration.");
  }

  return {
    bits: log2BigInt(validCount),
    poolSize,
    validPasswordCount: validCount,
  };
}

export const GENERATOR_LIMITS = Object.freeze({ minLength: MIN_LENGTH, maxLength: MAX_LENGTH });
