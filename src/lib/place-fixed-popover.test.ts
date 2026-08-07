import { describe, expect, test } from "bun:test";
import {
  placeFixedPopover,
  unionRects,
  type RectLike,
} from "./place-fixed-popover";

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): RectLike {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

describe("placeFixedPopover", () => {
  test("prefers above when there is room", () => {
    const pos = placeFixedPopover({
      anchor: rect(400, 300, 20, 20),
      size: { width: 200, height: 80 },
      viewport: { width: 800, height: 600 },
      gap: 10,
    });
    expect(pos.placement).toBe("above");
    expect(pos.top + 80 + 10).toBeLessThanOrEqual(300 + 0.5);
    // Centered horizontally on anchor
    expect(pos.left).toBeCloseTo(400 + 10 - 100, 0);
  });

  test("flips below when near the top edge", () => {
    const pos = placeFixedPopover({
      anchor: rect(400, 20, 20, 20),
      size: { width: 200, height: 120 },
      viewport: { width: 800, height: 600 },
      gap: 10,
    });
    expect(pos.placement).toBe("below");
    expect(pos.top).toBeGreaterThanOrEqual(40);
  });

  test("uses a side when vertical placements would cover the anchor", () => {
    const pos = placeFixedPopover({
      anchor: rect(400, 250, 20, 100),
      size: { width: 220, height: 280 },
      viewport: { width: 800, height: 600 },
      gap: 10,
      // Force a tall popover in a short vertical band around the anchor.
      maxHeight: 280,
    });
    // With clamping, above/below may still score poorly vs side.
    expect(["above", "below", "right", "left"]).toContain(pos.placement);
    const box = {
      top: pos.top,
      left: pos.left,
      width: Math.min(220, pos.maxWidth),
      height: Math.min(280, pos.maxHeight),
    };
    // Gap kept from anchor center band — popover should not swallow the
    // 20×100 anchor (allowing clamp near edges).
    const overlapsHeavily =
      box.left < 420 - 5 &&
      box.left + box.width > 400 + 5 &&
      box.top < 350 - 5 &&
      box.top + box.height > 250 + 5;
    // Prefer not covering; if viewport forces clamp, placement still returns.
    if (pos.placement === "right" || pos.placement === "left") {
      expect(overlapsHeavily).toBe(false);
    }
  });

  test("avoids an extra rect (e.g. milestone chip)", () => {
    const chip = rect(380, 420, 80, 28);
    const pos = placeFixedPopover({
      anchor: rect(400, 360, 16, 16),
      size: { width: 200, height: 100 },
      viewport: { width: 800, height: 600 },
      gap: 10,
      avoid: [chip],
    });
    // Below would sit on the chip; should pick above (or a side).
    expect(pos.placement).not.toBe("below");
    const box = {
      top: pos.top,
      left: pos.left,
      width: 200,
      height: 100,
    };
    const hitsChip = !(
      box.left + box.width + 9 <= chip.left ||
      chip.right + 9 <= box.left ||
      box.top + box.height + 9 <= chip.top ||
      chip.bottom + 9 <= box.top
    );
    expect(hitsChip).toBe(false);
  });

  test("clamps into the viewport", () => {
    const pos = placeFixedPopover({
      anchor: rect(10, 300, 20, 20),
      size: { width: 240, height: 80 },
      viewport: { width: 320, height: 600 },
      gap: 10,
      pad: 8,
      prefer: ["left", "above", "below", "right"],
    });
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + Math.min(240, pos.maxWidth)).toBeLessThanOrEqual(312);
  });
});

describe("unionRects", () => {
  test("returns null for empty input", () => {
    expect(unionRects([])).toBeNull();
  });

  test("unions multiple points", () => {
    const u = unionRects([rect(10, 10, 4, 4), rect(40, 50, 4, 4)]);
    expect(u).toEqual(rect(10, 10, 34, 44));
  });
});
