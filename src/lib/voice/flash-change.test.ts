import { describe, expect, test } from "bun:test";
import { pickOutermostHosts } from "./flash-change";

type Node = {
  id: string;
  children: Node[];
  contains(other: Node): boolean;
};

function node(id: string, children: Node[] = []): Node {
  const self: Node = {
    id,
    children,
    contains(other) {
      for (const child of children) {
        if (child === other || child.contains(other)) return true;
      }
      return false;
    },
  };
  return self;
}

describe("pickOutermostHosts", () => {
  test("prefers field wrapper over nested control with the same path", () => {
    const input = node("balance-input");
    const wrapper = node("balance-wrapper", [input]);
    const row = node("row", [wrapper]);

    // Exact matches for accounts.{id}.balance — not the row.
    expect(pickOutermostHosts([wrapper, input]).map((n) => n.id)).toEqual([
      "balance-wrapper",
    ]);
    expect(pickOutermostHosts([row]).map((n) => n.id)).toEqual(["row"]);
  });

  test("row path keeps only the row when remove button shares it", () => {
    const remove = node("remove");
    const row = node("row", [remove]);
    expect(pickOutermostHosts([row, remove]).map((n) => n.id)).toEqual([
      "row",
    ]);
  });
});
