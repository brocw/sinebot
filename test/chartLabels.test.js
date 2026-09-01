import test from "node:test";
import assert from "node:assert/strict";

import { chartLabel } from "../src/charts/labels.js";

// Cairo, which node-canvas draws through, has no colour-emoji support: an emoji
// in a display name comes out as an empty box or nothing at all. These pin down
// what gets removed and — just as importantly — what doesn't.

test("strips emoji from a display name", () => {
  assert.equal(chartLabel("Luc 🎮🔥", "fallback"), "Luc");
  assert.equal(chartLabel("🟩🟨⬛ Wordle", "fallback"), "Wordle");
});

test("strips emoji built from several codepoints", () => {
  assert.equal(chartLabel("Ann 🇬🇧", "fallback"), "Ann"); // regional indicators
  assert.equal(chartLabel("Wave 👋🏽", "fallback"), "Wave"); // skin-tone modifier
  assert.equal(chartLabel("Fam 👨‍👩‍👧", "fallback"), "Fam"); // zero-width joiners
  assert.equal(chartLabel("1️⃣ First", "fallback"), "1 First"); // keycap
});

test("leaves letterforms Cairo can actually draw", () => {
  assert.equal(chartLabel("ᶜᵒᵒˡ ✨ ʟᴜᴄ", "fallback"), "ᶜᵒᵒˡ ʟᴜᴄ");
  assert.equal(chartLabel("Zoë — ok", "fallback"), "Zoë — ok");
  assert.equal(chartLabel("plain name", "fallback"), "plain name");
});

test("collapses the whitespace an emoji leaves behind", () => {
  assert.equal(chartLabel("a 🎮 b", "fallback"), "a b");
  assert.equal(chartLabel("  🎮  spaced  ", "fallback"), "spaced");
});

test("falls back when nothing legible survives", () => {
  assert.equal(chartLabel("👑👑👑", "fallback"), "fallback");
  assert.equal(chartLabel("", "fallback"), "fallback");
  assert.equal(chartLabel(null, "fallback"), "fallback");
  assert.equal(chartLabel(undefined, "fallback"), "fallback");
});
