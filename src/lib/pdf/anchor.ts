/* Pinning a box to a spot on a page: shared by stamps and the signature box (no PDF library needed). */

export type Anchor = "top-left" | "top-center" | "top-right" | "middle-left" | "center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right";

/** Top-left corner (displayed) of a box of the given size pinned to `anchor`, `margin` points from the edges. */
export function anchorBox(anchor: Anchor, page: { width: number; height: number }, size: { width: number; height: number }, margin: number) {
  const [vertical, horizontal] = anchor === "center" ? ["middle", "center"] : anchor.split("-");
  const u = horizontal === "left" ? margin : horizontal === "right" ? page.width - margin - size.width : (page.width - size.width) / 2;
  const v = vertical === "top" ? margin : vertical === "bottom" ? page.height - margin - size.height : (page.height - size.height) / 2;
  return { u, v };
}
