type GeometryPoint = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type GeometrySnapshot = {
  boxes: GeometryPoint[];
  effectiveCols: number;
  itemsLength: number;
};

export function areGeometriesEqual(a: GeometrySnapshot, b: GeometrySnapshot): boolean {
  if (a.effectiveCols !== b.effectiveCols || a.itemsLength !== b.itemsLength) return false;
  if (a.boxes.length !== b.boxes.length) return false;

  return a.boxes.every((box, index) => {
    const other = b.boxes[index];
    return (
      other !== undefined &&
      box.left === other.left &&
      box.top === other.top &&
      box.width === other.width &&
      box.height === other.height
    );
  });
}
