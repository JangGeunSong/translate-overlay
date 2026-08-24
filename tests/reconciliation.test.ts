// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { reconcileRegions } from "../src/content/analysis/reconciliation";
import type { TextRegion } from "../src/content/types";

function region(id: string, sourceKey: string): TextRegion {
  const element = document.createElement("p");
  document.body.append(element);
  return {
    id,
    sourceKey,
    element,
    text: sourceKey,
    language: "en",
    semanticClass: "READING",
    viewportBand: "VIEWPORT",
    translationPriority: 0,
    rect: element.getBoundingClientRect(),
  };
}

describe("region reconciliation", () => {
  it("classifies added, changed, removed, and unchanged regions", () => {
    const unchangedBefore = region("same", "content-a");
    const changedBefore = region("changed", "content-old");
    const removed = region("removed", "content-removed");
    const unchangedAfter = { ...unchangedBefore, element: document.createElement("p") };
    const changedAfter = { ...changedBefore, sourceKey: "content-new", text: "new" };
    const added = region("added", "content-added");

    const result = reconcileRegions(
      [unchangedBefore, changedBefore, removed],
      [unchangedAfter, changedAfter, added],
    );
    expect(result.added.map((item) => item.id)).toEqual(["added"]);
    expect(result.changed.map((item) => item.current.id)).toEqual(["changed"]);
    expect(result.removed.map((item) => item.id)).toEqual(["removed"]);
    expect(result.unchanged.map((item) => item.id)).toEqual(["same"]);
  });
});
