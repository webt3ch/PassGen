import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { estimateEntropy, generatePassword, getCharacterSets, secureRandomInt } from "../src/generator.js";

globalThis.crypto ??= webcrypto;

const standardOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
};

test("generates a password with the requested length", () => {
  assert.equal(generatePassword(standardOptions).length, 20);
  assert.equal(generatePassword({ ...standardOptions, length: 64 }).length, 64);
});

test("includes at least one character from every selected set", () => {
  const password = generatePassword(standardOptions);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /[0-9]/);
  assert.match(password, /[!@#$%^&*()\-_=+\[\]{};:,.?/]/);
});

test("supports a single selected character set", () => {
  const options = { ...standardOptions, uppercase: false, lowercase: true, numbers: false, symbols: false };
  assert.match(generatePassword(options), /^[a-z]{20}$/);
});

test("generates only characters from the effective pool", () => {
  const options = { ...standardOptions, uppercase: false, lowercase: false, numbers: true, symbols: true, excludeAmbiguous: true };
  const allowed = new Set(getCharacterSets(options).flatMap(({ characters }) => [...characters]));
  for (let iteration = 0; iteration < 40; iteration += 1) {
    assert.ok([...generatePassword(options)].every((character) => allowed.has(character)));
  }
});

test("excludes ambiguous characters when requested", () => {
  const password = generatePassword({ ...standardOptions, excludeAmbiguous: true });
  assert.doesNotMatch(password, /[Il1O0]/);
});

test("rejects invalid password lengths", () => {
  assert.throws(() => generatePassword({ ...standardOptions, length: 7 }), /between 8 and 64/);
  assert.throws(() => generatePassword({ ...standardOptions, length: 65 }), /between 8 and 64/);
  assert.throws(() => generatePassword({ ...standardOptions, length: 8.5 }), /between 8 and 64/);
  assert.throws(() => estimateEntropy(0, standardOptions), /between 8 and 64/);
});

test("requires at least one selected character set", () => {
  const options = { ...standardOptions, uppercase: false, lowercase: false, numbers: false, symbols: false };
  assert.throws(() => getCharacterSets(options), /at least one/);
  assert.throws(() => generatePassword(options), /at least one/);
  assert.throws(() => estimateEntropy(20, options), /at least one/);
});

test("estimates the exact valid-output space for a single set", () => {
  const options = { ...standardOptions, uppercase: false, lowercase: true, numbers: false, symbols: false };
  const estimate = estimateEntropy(20, options);
  assert.equal(estimate.poolSize, 26);
  assert.ok(Math.abs(estimate.bits - 20 * Math.log2(26)) < 1e-10);
});

test("entropy accounts for the requirement to include each selected set", () => {
  const options = { ...standardOptions, uppercase: true, lowercase: false, numbers: true, symbols: false };
  const length = 8;
  const estimate = estimateEntropy(length, options);
  const validCount = 36n ** 8n - 26n ** 8n - 10n ** 8n;
  assert.equal(estimate.poolSize, 36);
  assert.equal(estimate.validPasswordCount, validCount);
  assert.ok(Math.abs(estimate.bits - Math.log2(Number(validCount))) < 1e-10);
  assert.ok(estimate.bits < length * Math.log2(36));
});

test("entropy uses the filtered alphabet when ambiguous characters are excluded", () => {
  const options = { ...standardOptions, uppercase: false, lowercase: false, numbers: true, symbols: false, excludeAmbiguous: true };
  const estimate = estimateEntropy(20, options);
  assert.equal(estimate.poolSize, 8);
  assert.ok(Math.abs(estimate.bits - 20 * Math.log2(8)) < 1e-10);
});

test("returns secure random integers within the requested range", () => {
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const value = secureRandomInt(7);
    assert.ok(Number.isInteger(value));
    assert.ok(value >= 0 && value < 7);
  }
  assert.equal(secureRandomInt(1), 0);
  assert.throws(() => secureRandomInt(0), RangeError);
  assert.throws(() => secureRandomInt(1.5), RangeError);
});

test("keeps entropy tied to the effective alphabet for a 64-digit password", () => {
  const options = {
    ...standardOptions,
    length: 64,
    uppercase: false,
    lowercase: false,
    numbers: true,
    symbols: false,
  };
  const estimate = estimateEntropy(64, options);
  assert.equal(estimate.poolSize, 10);
  assert.ok(Math.abs(estimate.bits - 64 * Math.log2(10)) < 1e-10);
  assert.ok(Math.abs(estimate.bits - 212.6) < 0.1);
});

test("covers every non-empty character-set combination at minimum and maximum lengths", () => {
  for (let mask = 1; mask < 16; mask += 1) {
    for (const length of [8, 64]) {
      const options = {
        length,
        uppercase: Boolean(mask & 1),
        lowercase: Boolean(mask & 2),
        numbers: Boolean(mask & 4),
        symbols: Boolean(mask & 8),
        excludeAmbiguous: mask % 2 === 0,
      };
      const password = generatePassword(options);
      const sets = getCharacterSets(options);
      const allowed = new Set(sets.flatMap(({ characters }) => [...characters]));
      assert.equal(password.length, length);
      assert.ok([...password].every((character) => allowed.has(character)));
      for (const { characters } of sets) {
        assert.ok([...password].some((character) => characters.includes(character)));
      }
      assert.ok(Number.isFinite(estimateEntropy(length, options).bits));
    }
  }
});

import { createOutputSnapshot, isOutputCurrent } from "../src/output-model.js";

test("output snapshot keeps password, options, alphabet and entropy coherent", () => {
  const options = { ...standardOptions, length: 32 };
  const password = generatePassword(options);
  const snapshot = createOutputSnapshot(password, options);

  assert.equal(snapshot.password, password);
  assert.equal(snapshot.options.length, password.length);
  assert.equal(snapshot.entropy.poolSize, estimateEntropy(options.length, options).poolSize);
  assert.ok(Math.abs(snapshot.entropy.bits - estimateEntropy(options.length, options).bits) < 1e-12);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.options));
  assert.ok(Object.isFrozen(snapshot.entropy));
});

test("configuration changes do not mutate the generated output snapshot", () => {
  const options = { ...standardOptions, length: 32 };
  const snapshot = createOutputSnapshot(generatePassword(options), options);
  const changedOptions = { ...options, length: 48 };

  assert.equal(isOutputCurrent(snapshot, options), true);
  assert.equal(isOutputCurrent(snapshot, changedOptions), false);
  assert.equal(snapshot.options.length, 32);
  assert.equal(snapshot.password.length, 32);
  assert.equal(snapshot.entropy.poolSize, 86);
});

test("output model rejects mismatched password and generation length", () => {
  assert.throws(() => createOutputSnapshot("short", { ...standardOptions, length: 20 }), /same output/);
});
