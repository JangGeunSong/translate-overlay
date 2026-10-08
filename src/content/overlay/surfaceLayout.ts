// Read-only measurements. Source styles and nodes are never changed to make text fit.
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
  const tolerance = 0.1;
  return inner.left >= outer.left - tolerance && inner.top >= outer.top - tolerance &&
    inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance;
}

const overlaps = (a: TextBox, b: DOMRect): boolean =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.1 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.1;

function textRects(source: Element): DOMRect[] {
  const range = document.createRange();
  const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue;
    const parent = walker.currentNode.parentElement;
    if (!parent || getComputedStyle(parent).visibility === "hidden") continue;
    range.selectNodeContents(walker.currentNode);
    rects.push(...[...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0));
  }
  return rects;
}

function boxOf(rects: Pick<DOMRect, "left" | "top" | "right" | "bottom">[]): TextBox {
  const left = Math.min(...rects.map(rect => rect.left));
  const top = Math.min(...rects.map(rect => rect.top));
  const right = Math.max(...rects.map(rect => rect.right));
  const bottom = Math.max(...rects.map(rect => rect.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function measureSurface(source: HTMLElement): SurfaceMeasurement {
  const range = document.createRange();
  if (typeof range.getClientRects !== "function") return { reason: "unmeasurable" };
  const rects = textRects(source);
  if (!rects.length) return { reason: "unmeasurable" };
  const ink = boxOf(rects);
  const sourceRect = source.getBoundingClientRect();
  const sourceStyle = getComputedStyle(source);
  if (source.querySelector("img, svg, canvas, video, input, select, textarea, button, a, [contenteditable], [role='textbox']")) {
    return { reason: "mixed-geometry" };
  }
  // Visible font ink can extend outside a short line-height or inline box.
  // Horizontal overflow may use the containing block only when it contains
  // the ink; clipping and real neighbour content are still checked below.
  const parentRect = source.parentElement?.getBoundingClientRect();
  if ((ink.left < sourceRect.left - 0.1 || ink.right > sourceRect.right + 0.1) &&
      (!parentRect || ink.left < parentRect.left - 0.1 || ink.right > parentRect.right + 0.1)) return { reason: "source-overflow" };
  const inset = (side: string) => (Number.parseFloat(sourceStyle.getPropertyValue("border-" + side + "-width")) || 0) +
    (Number.parseFloat(sourceStyle.getPropertyValue("padding-" + side)) || 0);
  const content = {
    left: sourceRect.left + inset("left"), right: sourceRect.right - inset("right"),
    top: sourceRect.top + inset("top"), bottom: sourceRect.bottom - inset("bottom"),
  };
  // Use actual element content space for wrapping headings and padded controls,
  // while retaining the complete source ink for non-destructive masking.
  const expanded = boxOf([ink, content]);
  const isInteractive = source.matches("a, button, [role='button'], [role='tab'], [role='menuitem']");
  const isInline = sourceStyle.display === "inline";
  // Link padding belongs to the original hit target and can fit a longer label.
  // Rounded/padded buttons retain their content inset to preserve the corners.
  const linkSpace = boxOf([ink, {left:sourceRect.left, right:sourceRect.right, top:sourceRect.top, bottom:sourceRect.bottom}]);
  const available = source.matches("a") && !parseFloat(sourceStyle.borderRadius) ? linkSpace :
    isInline && !isInteractive ? ink : expanded;

  const check = (box: TextBox): SurfaceMeasurement => {
    if (!containsBox({ left: 0, top: 0, right: innerWidth, bottom: innerHeight }, box)) return { reason: "viewport-clip" };
    let background: string | undefined;
    for (let ancestor: HTMLElement | null = source; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.parentElement && ancestor.parentElement !== document.documentElement) {
        for (const sibling of ancestor.parentElement.children) {
          const siblingStyle = getComputedStyle(sibling);
          if (sibling === ancestor || siblingStyle.display === "none" || siblingStyle.visibility === "hidden" || siblingStyle.opacity === "0") continue;
          if (!overlaps(box, sibling.getBoundingClientRect())) continue;
          // Container boxes may overlap without any painted content colliding.
          // Text and replaced/control content still protect prices, icons and
          // neighbours with pointer-events:none (which hit testing misses).
          if (textRects(sibling).some(rect => overlaps(box, rect)) ||
              [sibling, ...sibling.querySelectorAll("img, svg, canvas, video, input, select, textarea, button")]
                .some(element => element.matches("img, svg, canvas, video, input, select, textarea, button") && overlaps(box, element.getBoundingClientRect()))) {
            return { reason: "overlapping-neighbour" };
          }
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
        const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
        const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
        const clip = {
          left: clipsX ? rect.left + borderLeft : -Infinity,
          right: clipsX ? rect.left + borderLeft + ancestor.clientWidth : Infinity,
          top: clipsY ? rect.top + borderTop : -Infinity,
          bottom: clipsY ? rect.top + borderTop + ancestor.clientHeight : Infinity,
        };
        if (!containsBox(clip, box) || parseFloat(style.borderRadius) > 0 || /paint|strict|content/.test(style.contain)) return { reason: "ancestor-clip" };
      }
    }
    if (typeof document.elementFromPoint === "function") {
      const columns = Math.max(1, Math.ceil(box.width / 16)), rows = Math.max(1, Math.ceil(box.height / 16));
      if (columns * rows > 2048) return { reason: "complex-geometry" };
      for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
        const hit = document.elementFromPoint(box.left + 0.2 + (box.width - 0.4) * x / columns,
          box.top + 0.2 + (box.height - 0.4) * y / rows);
        if (!hit || (!source.contains(hit) && !hit.contains(source))) return { reason: "occluded" };
      }
    }
    return { box, background: background ?? "Canvas" };
  };
  const measured = check(available);
  // Extra fitting space is optional. Never let its rejection suppress source
  // text that can still be displayed safely in its original ink bounds.
  return "reason" in measured && !containsBox(ink, available) ? check(ink) : measured;
}
