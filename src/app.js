import { generatePassword, GENERATOR_LIMITS } from "./generator.js";
import { createOutputSnapshot, isOutputCurrent } from "./output-model.js";

const elements = {
  output: document.querySelector("#passwordOutput"),
  visibilityButton: document.querySelector("#visibilityButton"),
  generateButton: document.querySelector("#generateButton"),
  copyButton: document.querySelector("#copyButton"),
  outputState: document.querySelector("#outputState"),
  outputStateLabel: document.querySelector("#outputStateLabel"),
  lengthRange: document.querySelector("#lengthRange"),
  lengthValue: document.querySelector("#lengthValue"),
  entropyValue: document.querySelector("#entropyValue"),
  entropyLabel: document.querySelector("#entropyLabel"),
  strengthNote: document.querySelector("#strengthNote"),
  outputMetadata: document.querySelector("#outputMetadata"),
  configurationNotice: document.querySelector("#configurationNotice"),
  configurationNoticeTitle: document.querySelector("#configurationNoticeTitle"),
  configurationNoticeBody: document.querySelector("#configurationNoticeBody"),
  statusMessage: document.querySelector("#statusMessage"),
  statusText: document.querySelector("#statusText"),
  settingsError: document.querySelector("#settingsError"),
  presets: [...document.querySelectorAll("[data-length]")],
  uppercase: document.querySelector("#uppercaseToggle"),
  lowercase: document.querySelector("#lowercaseToggle"),
  numbers: document.querySelector("#numbersToggle"),
  symbols: document.querySelector("#symbolsToggle"),
  excludeAmbiguous: document.querySelector("#ambiguousToggle"),
};

const characterControls = [elements.uppercase, elements.lowercase, elements.numbers, elements.symbols];
const allSettingsControls = [...characterControls, elements.lengthRange, elements.excludeAmbiguous];
const state = {
  outputSnapshot: null,
  visible: false,
  statusTimeout: null,
};

function getOptions() {
  return {
    length: Number(elements.lengthRange.value),
    uppercase: elements.uppercase.checked,
    lowercase: elements.lowercase.checked,
    numbers: elements.numbers.checked,
    symbols: elements.symbols.checked,
    excludeAmbiguous: elements.excludeAmbiguous.checked,
  };
}

function setClipboardStatus(message = "", type = "default") {
  if (state.statusTimeout !== null) {
    window.clearTimeout(state.statusTimeout);
    state.statusTimeout = null;
  }

  elements.statusText.textContent = message;
  elements.statusMessage.dataset.type = type;

  // Successful-copy feedback is helpful but transient; errors remain until the
  // next user action so they are not dismissed before the user can react.
  if (message && type === "success") {
    state.statusTimeout = window.setTimeout(() => {
      elements.statusText.textContent = "";
      elements.statusMessage.dataset.type = "default";
      state.statusTimeout = null;
    }, 4000);
  }
}

function setOutputState(label, stateName = "ready") {
  elements.outputStateLabel.textContent = label;
  elements.outputState.dataset.state = stateName;
}

function renderPassword() {
  const password = state.outputSnapshot?.password ?? "";
  elements.output.textContent = state.visible ? password : "•".repeat(password.length);
  const actionLabel = state.visible ? "Hide password" : "Show password";
  elements.visibilityButton.setAttribute("aria-label", actionLabel);
  elements.visibilityButton.setAttribute("title", actionLabel);
  elements.visibilityButton.setAttribute("aria-pressed", String(state.visible));
  elements.visibilityButton.disabled = !password;
}

function renderLength() {
  const length = Number(elements.lengthRange.value);
  elements.lengthValue.textContent = String(length);
  const progress = ((length - GENERATOR_LIMITS.minLength) / (GENERATOR_LIMITS.maxLength - GENERATOR_LIMITS.minLength)) * 100;
  elements.lengthRange.style.setProperty("--range-progress", `${progress}%`);
  elements.presets.forEach((button) => {
    const selected = Number(button.dataset.length) === length;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function describeCharacterSets(options) {
  const names = [
    ["uppercase", "Uppercase"],
    ["lowercase", "Lowercase"],
    ["numbers", "Numbers"],
    ["symbols", "Symbols"],
  ].filter(([key]) => options[key]).map(([, label]) => label);
  if (options.excludeAmbiguous) names.push("ambiguous characters excluded");
  return names.join(" + ");
}

function renderOutputDetails(snapshot) {
  if (!snapshot) {
    elements.entropyLabel.textContent = "Estimated entropy";
    elements.entropyValue.textContent = "— bits";
    elements.strengthNote.textContent = "Theoretical estimate of valid outputs; not a security certification.";
    elements.outputMetadata.textContent = "No password has been generated yet.";
    return;
  }

  // All displayed details derive from the immutable snapshot, never live controls.
  elements.entropyLabel.textContent = "Estimated entropy";
  elements.entropyValue.textContent = `~${Math.round(snapshot.entropy.bits)} bits`;
  elements.strengthNote.textContent = "Theoretical estimate of valid outputs; not a security certification.";
  elements.outputMetadata.textContent = `Generated with ${snapshot.options.length} characters · ${snapshot.entropy.poolSize}-character alphabet · ${describeCharacterSets(snapshot.options)}.`;
}

function updateConfigurationUI() {
  renderLength();
  const options = getOptions();
  const hasCharacterSet = characterControls.some((input) => input.checked);
  const snapshot = state.outputSnapshot;
  const hasOutput = Boolean(snapshot);
  const isCurrent = isOutputCurrent(snapshot, options);

  elements.generateButton.disabled = !hasCharacterSet;
  elements.copyButton.disabled = !hasOutput || !isCurrent;
  elements.settingsError.hidden = hasCharacterSet;
  elements.settingsError.textContent = "Select at least one character set to generate a password.";
  elements.configurationNotice.hidden = !hasOutput || isCurrent;

  if (!hasCharacterSet) {
    elements.configurationNoticeTitle.textContent = "Configuration incomplete";
    elements.configurationNoticeBody.textContent = "Select at least one character set, then generate a new password.";
  } else {
    elements.configurationNoticeTitle.textContent = "Configuration changed";
    elements.configurationNoticeBody.textContent = "Generate a new password to apply your current settings.";
  }

  if (!hasCharacterSet) {
    setOutputState(hasOutput ? "Previous password" : "Configuration invalid", hasOutput ? "stale" : "invalid");
  } else if (!hasOutput) {
    setOutputState("Not generated", "idle");
  } else if (!isCurrent) {
    setOutputState("Settings changed", "stale");
  } else {
    setOutputState("Password ready", "ready");
  }

  renderOutputDetails(snapshot);
}

function generate() {
  const options = getOptions();
  setClipboardStatus();
  try {
    const password = generatePassword(options);
    // Build one coherent snapshot before publishing it to the UI.
    state.outputSnapshot = createOutputSnapshot(password, options);
    state.visible = false;
    renderPassword();
    updateConfigurationUI();
  } catch (error) {
    // Do not leave an older password looking like the result of a failed run.
    state.outputSnapshot = null;
    state.visible = false;
    renderPassword();
    renderOutputDetails(null);
    elements.configurationNotice.hidden = true;
    setOutputState("Generation failed", "invalid");
    elements.settingsError.textContent = error instanceof Error ? error.message : "Unable to generate a password.";
    elements.settingsError.hidden = false;
    elements.copyButton.disabled = true;
  }
}

async function copyPassword() {
  const snapshot = state.outputSnapshot;
  if (!snapshot || !isOutputCurrent(snapshot, getOptions())) {
    setClipboardStatus("Generate a password with the current settings before copying.", "error");
    return;
  }

  try {
    if (!window.isSecureContext || !navigator.clipboard?.writeText) {
      throw new Error("Secure clipboard access requires HTTPS or localhost.");
    }
    const passwordToCopy = snapshot.password;
    const settingsAtCopy = getOptions();
    await navigator.clipboard.writeText(passwordToCopy);
    if (isOutputCurrent(snapshot, getOptions()) && isOutputCurrent(snapshot, settingsAtCopy)) {
      setClipboardStatus("Password copied. Clear the clipboard on shared devices.", "success");
    } else {
      setClipboardStatus("Password copied, but settings changed during copying. The clipboard contains the previous result.", "success");
    }
  } catch {
    setClipboardStatus("Copy failed. Reveal the password to copy it manually, or open PassGen over HTTPS or localhost.", "error");
  }
}

function onSettingsChanged() {
  setClipboardStatus();
  updateConfigurationUI();
}

elements.lengthRange.addEventListener("input", onSettingsChanged);
elements.presets.forEach((button) => {
  button.addEventListener("click", () => {
    elements.lengthRange.value = button.dataset.length;
    onSettingsChanged();
  });
});
allSettingsControls.filter((control) => control !== elements.lengthRange)
  .forEach((control) => control.addEventListener("change", onSettingsChanged));

elements.visibilityButton.addEventListener("click", () => {
  state.visible = !state.visible;
  renderPassword();
});
elements.generateButton.addEventListener("click", generate);
elements.copyButton.addEventListener("click", copyPassword);

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !["INPUT", "BUTTON", "A"].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    generate();
  }
});

updateConfigurationUI();
generate();
