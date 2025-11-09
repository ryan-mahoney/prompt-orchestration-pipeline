import { describe, it, expect } from "vitest";
import { areGeometriesEqual } from "../src/utils/geometry-equality.js";

describe("areGeometriesEqual", () => {
  const epsilon = 0.5;

  const baseOverlay = {
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
  };
  const baseBox = {
    left: 10,
    top: 20,
    width: 100,
    height: 80,
    right: 110,
    bottom: 100,
    cx: 60,
    cy: 60,
    headerMidY: 40,
  };
  const baseGeom = {
    overlayBox: baseOverlay,
    boxes: [baseBox],
    effectiveCols: 3,
    itemsLength: 1,
  };

  it("returns true for identical geometries", () => {
    expect(areGeometriesEqual(baseGeom, { ...baseGeom }, epsilon)).toBe(true);
  });

  it("returns true when prev and next are the same reference", () => {
    expect(areGeometriesEqual(baseGeom, baseGeom, epsilon)).toBe(true);
  });

  it("returns false when only one is null/undefined", () => {
    expect(areGeometriesEqual(null, baseGeom, epsilon)).toBe(false);
    expect(areGeometriesEqual(baseGeom, undefined, epsilon)).toBe(false);
  });

  it("returns false when itemsLength differs", () => {
    const other = { ...baseGeom, itemsLength: 2 };
    expect(areGeometriesEqual(baseGeom, other, epsilon)).toBe(false);
  });

  it("returns false when effectiveCols differs", () => {
    const other = { ...baseGeom, effectiveCols: 2 };
    expect(areGeometriesEqual(baseGeom, other, epsilon)).toBe(false);
  });

  it("returns false when overlayBox fields differ beyond epsilon", () => {
    const otherWithin = {
      ...baseGeom,
      overlayBox: { ...baseOverlay, left: 0.4 },
    };
    expect(areGeometriesEqual(baseGeom, otherWithin, epsilon)).toBe(true); // within epsilon
    const otherBeyond = {
      ...baseGeom,
      overlayBox: { ...baseOverlay, left: epsilon + 0.1 },
    };
    expect(areGeometriesEqual(baseGeom, otherBeyond, epsilon)).toBe(false);
  });

  it("returns false when boxes array length differs", () => {
    const other = { ...baseGeom, boxes: [baseBox, baseBox] };
    expect(areGeometriesEqual(baseGeom, other, epsilon)).toBe(false);
  });

  it("returns false when a box field differs beyond epsilon", () => {
    const other = {
      ...baseGeom,
      boxes: [{ ...baseBox, left: baseBox.left + 0.4 }],
    };
    expect(areGeometriesEqual(baseGeom, other, epsilon)).toBe(true); // within epsilon
    const other2 = {
      ...baseGeom,
      boxes: [{ ...baseBox, left: baseBox.left + 0.6 }],
    };
    expect(areGeometriesEqual(baseGeom, other2, epsilon)).toBe(false);
  });

  it("returns true when non-compared fields (cx, cy) change", () => {
    const other = {
      ...baseGeom,
      boxes: [{ ...baseBox, cx: 999, cy: 999 }],
    };
    expect(areGeometriesEqual(baseGeom, other, epsilon)).toBe(true);
  });

  it("returns true when overlay changes are within epsilon", () => {
    const other = {
      ...baseGeom,
      overlayBox: {
        left: 0.3,
        top: -0.3,
        width: 800.4,
        height: 600.4,
        right: 800.3,
        bottom: 600.3,
      },
    };
    expect(areGeometriesEqual(baseGeom, other, epsilon)).toBe(true);
  });

  it("handles null boxes gracefully", () => {
    const withNullBoxes = {
      ...baseGeom,
      boxes: [null],
    };
    const withNullBoxes2 = {
      ...baseGeom,
      boxes: [null],
    };
    expect(areGeometriesEqual(withNullBoxes, withNullBoxes2, epsilon)).toBe(
      true
    );
    expect(areGeometriesEqual(baseGeom, withNullBoxes, epsilon)).toBe(false);
  });

  it("uses default epsilon when none provided", () => {
    const other = {
      ...baseGeom,
      boxes: [{ ...baseBox, left: baseBox.left + 0.6 }],
    };
    expect(areGeometriesEqual(baseGeom, other)).toBe(false); // default 0.5 epsilon
    expect(areGeometriesEqual(baseGeom, other, 1)).toBe(true); // larger epsilon allows it
  });
});
