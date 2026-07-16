import assert from "node:assert/strict";
import test from "node:test";
import { lineChanges } from "./lineDiff.ts";

test("finds insertion, deletion, and replacement blocks", () => {
  assert.deepEqual(lineChanges(["a", "c"], ["a", "b", "c"]), [
    { removed: [], added: ["b"], newStart: 1 },
  ]);
  assert.deepEqual(lineChanges(["a", "b", "c"], ["a", "c"]), [
    { removed: ["b"], added: [], newStart: 1 },
  ]);
  assert.deepEqual(lineChanges(["a", "old", "c"], ["a", "new", "c"]), [
    { removed: ["old"], added: ["new"], newStart: 1 },
  ]);
});

test("handles changes at both file boundaries", () => {
  assert.deepEqual(lineChanges(["old", "middle", "tail"], ["middle"]), [
    { removed: ["old"], added: [], newStart: 0 },
    { removed: ["tail"], added: [], newStart: 1 },
  ]);
  assert.deepEqual(lineChanges(["middle"], ["head", "middle", "tail"]), [
    { removed: [], added: ["head"], newStart: 0 },
    { removed: [], added: ["tail"], newStart: 2 },
  ]);
});

test("returns no blocks for equal input", () => {
  assert.deepEqual(lineChanges(["a", "b"], ["a", "b"]), []);
});

test("change blocks reconstruct arbitrary target sequences", () => {
  let seed = 17;
  const random = (): number => {
    seed = (seed * 48271) % 0x7fffffff;
    return seed;
  };
  for (let iteration = 0; iteration < 500; iteration++) {
    const before = Array.from({ length: random() % 12 }, () =>
      String(random() % 5),
    );
    const after = Array.from({ length: random() % 12 }, () =>
      String(random() % 5),
    );
    const reconstructed = [...before];
    for (const change of lineChanges(before, after)) {
      reconstructed.splice(
        change.newStart,
        change.removed.length,
        ...change.added,
      );
    }
    assert.deepEqual(reconstructed, after);
  }
});
