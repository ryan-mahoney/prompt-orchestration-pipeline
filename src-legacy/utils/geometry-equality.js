/**
 * Compare two geometry snapshots for layout-relevant changes using tolerance.
 * @param {Object} prev - Previous geometry snapshot
 * @param {Object} next - New geometry snapshot
 * @param {number} epsilon - Tolerance in pixels for floating-point differences (default: 0.5)
 * @returns {boolean} true if geometries are effectively equal for rendering purposes
 */
export function areGeometriesEqual(prev, next, epsilon = 0.5) {
  // Strict equality shortcut
  if (prev === next) return true;
  if (!prev || !next) return false;

  // Compare top-level scalars
  if (prev.itemsLength !== next.itemsLength) return false;
  if (prev.effectiveCols !== next.effectiveCols) return false;

  // Compare overlay box numeric fields only (DOMRect may have non-numeric props)
  if (!areOverlayBoxesEqual(prev.overlayBox, next.overlayBox, epsilon)) {
    return false;
  }

  // Compare boxes array length and each box's layout-relevant fields
  const prevBoxes = prev.boxes;
  const nextBoxes = next.boxes;
  if (prevBoxes.length !== nextBoxes.length) return false;

  for (let i = 0; i < prevBoxes.length; i++) {
    if (!areBoxesEqual(prevBoxes[i], nextBoxes[i], epsilon)) {
      return false;
    }
  }

  return true;
}

/**
 * Compare overlay box numeric fields with tolerance.
 * @param {DOMRect|Object} a
 * @param {DOMRect|Object} b
 * @param {number} epsilon
 * @returns {boolean}
 */
function areOverlayBoxesEqual(a, b, epsilon) {
  return (
    areNumbersClose(a.left, b.left, epsilon) &&
    areNumbersClose(a.top, b.top, epsilon) &&
    areNumbersClose(a.width, b.width, epsilon) &&
    areNumbersClose(a.height, b.height, epsilon) &&
    areNumbersClose(a.right, b.right, epsilon) &&
    areNumbersClose(a.bottom, b.bottom, epsilon)
  );
}

/**
 * Compare individual card box layout fields with tolerance.
 * @param {Object} a - box object with left/top/width/height/right/bottom/headerMidY
 * @param {Object} b - box object with same shape
 * @param {number} epsilon
 * @returns {boolean}
 */
function areBoxesEqual(a, b, epsilon) {
  if (!a || !b) return a === b;
  return (
    areNumbersClose(a.left, b.left, epsilon) &&
    areNumbersClose(a.top, b.top, epsilon) &&
    areNumbersClose(a.width, b.width, epsilon) &&
    areNumbersClose(a.height, b.height, epsilon) &&
    areNumbersClose(a.right, b.right, epsilon) &&
    areNumbersClose(a.bottom, b.bottom, epsilon) &&
    areNumbersClose(a.headerMidY, b.headerMidY, epsilon)
  );
}

/**
 * Numeric comparison with tolerance.
 * @param {number} a
 * @param {number} b
 * @param {number} epsilon
 * @returns {boolean}
 */
function areNumbersClose(a, b, epsilon) {
  return Math.abs(a - b) <= epsilon;
}
