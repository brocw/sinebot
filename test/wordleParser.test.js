import test from "node:test";
import assert from "node:assert/strict";
import { parseWordleResult } from "../src/games/wordle/parser.js";
import { msg } from "./helpers.js";

const HEADER = "Your group is on a 42 day streak! 🔥";

test("parses a standard results post", () => {
  const r = parseWordleResult(
    msg(`${HEADER}\n👑 3/6: <@111> <@222>\n4/6: <@333>\nX/6: <@444>`),
  );
  assert.equal(r.streak, 42);
  assert.equal(r.scores.length, 3);

  assert.equal(r.scores[0].score, 3);
  assert.equal(r.scores[0].isCrown, true);
  assert.deepEqual(r.scores[0].users, [
    { type: "id", id: "111" },
    { type: "id", id: "222" },
  ]);

  assert.equal(r.scores[1].isCrown, false);
  assert.equal(r.scores[2].score, null, "X/6 records as a null score");
});

test("parses unresolved @Name users and keeps the role suffix raw", () => {
  const r = parseWordleResult(
    msg(`${HEADER}\n👑 2/6: @Chloe G || President`),
  );
  assert.deepEqual(r.scores[0].users, [
    { type: "name", raw: "Chloe G || President" },
  ]);
});

test("keeps mixed id/name users in document order", () => {
  const r = parseWordleResult(
    msg(`${HEADER}\n👑 3/6: <@111> @Chloe G <@222>`),
  );
  assert.deepEqual(r.scores[0].users.map((u) => u.type), [
    "id",
    "name",
    "id",
  ]);
});

test("rejects messages without a streak header", () => {
  assert.equal(parseWordleResult(msg("just chatting\n👑 3/6: <@111>")), null);
});

test("rejects messages too short to be a result", () => {
  assert.equal(parseWordleResult(msg(HEADER)), null);
});

test("skips lines that carry no score", () => {
  const r = parseWordleResult(
    msg(`${HEADER}\nsome preamble line\n👑 3/6: <@111>`),
  );
  assert.equal(r.scores.length, 1);
});
