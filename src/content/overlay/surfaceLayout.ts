// Read-only measurements. No source styles or nodes are changed to make text fit.
export interface TextBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export type SurfaceMeasurement = { box: TextBox; background: string } | { reason: string };

export function containsBox(outer: Pick<TextBox, "left" | "top" | "right" | "bottom">, inner: Pick<TextBox, "left" | "top" | "right" | "bottom">): boolean {
  const tolerance = 0.1; // Subpixel layout arithmetic, never rounded outward.
  return inner.left >= outer.left - tolerance && inner.top >= outer.top - tolerance &&
    inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance;
}

export function measureSurface(source: HTMLElement): SurfaceMeasurement {
  const range = document.createRange();
  if (typeof range.getClientRects !== "function") return { reason: "unmeasurable" };
  // Measure text nodes, not element boxes (which include padding, icons and controls).
  const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue;
    range.selectNodeContents(walker.currentNode);
    rects.push(...[...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0));
  }
  if (!rects.length) return { reason: "unmeasurable" };
  const left = Math.min(...rects.map(rect => rect.left));
  const top = Math.min(...rects.map(rect => rect.top));
  const right = Math.max(...rects.map(rect => rect.right));
  const bottom = Math.max(...rects.map(rect => rect.bottom));
  const box = { left, top, right, bottom, width: right - left, height: bottom - top };
  if (!containsBox(source.getBoundingClientRect(), box)) return { reason: "source-overflow" };
  if (!containsBox({ left: 0, top: 0, right: innerWidth, bottom: innerHeight }, box)) return { reason: "viewport-clip" };
  if (source.querySelector("img, svg, canvas, video, input, select, textarea, button, a, [contenteditable], [role='textbox']")) {
    return { reason: "mixed-geometry" };
  }
  let background: string | undefined;
  for (let ancestor: HTMLElement | null = source; ancestor; ancestor = ancestor.parentElement) {
    // Adjacent boxes must stay uncovered even when pointer-events:none makes them
    // invisible to hit testing. Check siblings along the source's ancestor path.
    if (ancestor.parentElement && ancestor.parentElement !== document.documentElement) {
      for (const sibling of ancestor.parentElement.children) {
        if (sibling === ancestor) continue;
        const rect = sibling.getBoundingClientRect();
        if (Math.min(box.right, rect.right) > Math.max(box.left, rect.left) &&
            Math.min(box.bottom, rect.bottom) > Math.max(box.top, rect.top)) return { reason: "overlapping-neighbour" };
      }
    }
    const style = getComputedStyle(ancestor);
    const nonDefault = (value: string | undefined) => Boolean(value && value !== "none");
    if (nonDefault(style.transform) || nonDefault(style.perspective) || nonDefault(style.clipPath) ||
        nonDefault(style.maskImage) || nonDefault(style.filter) || nonDefault(style.backdropFilter) ||
        (style.opacity && style.opacity !== "1") || (style.writingMode && style.writingMode !== "horizontal-tb") ||
        (style.mixBlendMode && style.mixBlendMode !== "normal")) return { reason: "complex-geometry" };
    if (!background) {
      if (nonDefault(style.backgroundImage)) return { reason: "uncertain-background" };
      const color = style.backgroundColor;
      if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") {
        if (!/^rgb\(/.test(color) && !/^rgba\([^,]+,[^,]+,[^,]+,\s*1\)$/.test(color)) return { reason: "uncertain-background" };
        background = color;
      }
    }
    const clipsX = /^(hidden|clip|auto|scroll)$/.test(style.overflowX);
    const clipsY = /^(hidden|clip|auto|scroll)$/.test(style.overflowY);
    if (clipsX || clipsY || /paint|strict|content/.test(style.contain)) {
      const rect = ancestor.getBoundingClientRect();
      // clientLeft/clientTop round fractional borders to integers. Computed border
      // widths retain the actual edge at non-integer device scales.
      const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
      const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
      const clip = {
        left: clipsX ? rect.left + borderLeft : -Infinity,
        right: clipsX ? rect.left + borderLeft + ancestor.clientWidth : Infinity,
        top: clipsY ? rect.top + borderTop : -Infinity,
        bottom: clipsY ? rect.top + borderTop + ancestor.clientHeight : Infinity,
      };
      if (!containsBox(clip, box) || parseFloat(style.borderRadius) > 0 || /paint|strict|content/.test(style.contain)) {
        return { reason: "ancestor-clip" };
      }
    }
  }
  // An opaque default canvas cannot be inferred from page styles (e.g. forced colors).
  background ??= "Canvas";
  // Conservative occlusion guard for floating/positioned neighbours and source holes.
  // Hit testing is read-only and passive surfaces never participate in it.
  if (typeof document.elementFromPoint === "function") {
    const columns = Math.ceil(box.width / 16), rows = Math.ceil(box.height / 16);
    if (columns * rows > 2048) return { reason: "complex-geometry" };
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
      const hit = document.elementFromPoint(left + 0.2 + (box.width - 0.4) * x / columns,
        top + 0.2 + (box.height - 0.4) * y / rows);
      if (!hit || (!source.contains(hit) && !hit.contains(source))) return { reason: "occluded" };
    }
  }
  return { box, background };
}
