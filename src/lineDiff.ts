export type LineChange = {
  removed: string[];
  added: string[];
  newStart: number;
};

type DiffOperation = { kind: "equal" | "delete" | "insert"; line: string };

export function lineChanges(before: string[], after: string[]): LineChange[] {
  const operations = myersDiff(before, after);
  const changes: LineChange[] = [];
  let newLine = 0;
  for (let index = 0; index < operations.length; ) {
    if (operations[index].kind === "equal") {
      newLine++;
      index++;
      continue;
    }
    const change: LineChange = { removed: [], added: [], newStart: newLine };
    while (index < operations.length && operations[index].kind !== "equal") {
      const operation = operations[index++];
      if (operation.kind === "delete") change.removed.push(operation.line);
      else {
        change.added.push(operation.line);
        newLine++;
      }
    }
    changes.push(change);
  }
  return changes;
}

function myersDiff(before: string[], after: string[]): DiffOperation[] {
  const trace: Map<number, number>[] = [];
  let frontier = new Map<number, number>([[1, 0]]);
  const maximum = before.length + after.length;
  for (let distance = 0; distance <= maximum; distance++) {
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? -1;
      const right = frontier.get(diagonal - 1) ?? -1;
      let x =
        diagonal === -distance || (diagonal !== distance && right < down)
          ? Math.max(0, down)
          : right + 1;
      let y = x - diagonal;
      while (
        x < before.length &&
        y < after.length &&
        before[x] === after[y]
      ) {
        x++;
        y++;
      }
      frontier.set(diagonal, x);
      if (x >= before.length && y >= after.length)
        return backtrack(trace, before, after, distance);
    }
  }
  return [];
}

function backtrack(
  trace: Map<number, number>[],
  before: string[],
  after: string[],
  distance: number,
): DiffOperation[] {
  const result: DiffOperation[] = [];
  let x = before.length;
  let y = after.length;
  for (let depth = distance; depth >= 0; depth--) {
    const frontier = trace[depth];
    const diagonal = x - y;
    const down = frontier.get(diagonal + 1) ?? -1;
    const right = frontier.get(diagonal - 1) ?? -1;
    const previousDiagonal =
      diagonal === -depth || (diagonal !== depth && right < down)
        ? diagonal + 1
        : diagonal - 1;
    const previousX = Math.max(0, frontier.get(previousDiagonal) ?? 0);
    const previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) {
      result.push({ kind: "equal", line: before[x - 1] });
      x--;
      y--;
    }
    if (depth === 0) break;
    if (x === previousX) {
      result.push({ kind: "insert", line: after[y - 1] });
      y--;
    } else {
      result.push({ kind: "delete", line: before[x - 1] });
      x--;
    }
  }
  return result.reverse();
}
