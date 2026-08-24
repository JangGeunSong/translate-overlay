import type { TextRegion } from "../types";

export interface ChangedRegion {
  previous: TextRegion;
  current: TextRegion;
}

export interface RegionReconciliation {
  added: TextRegion[];
  changed: ChangedRegion[];
  removed: TextRegion[];
  unchanged: TextRegion[];
}

export function reconcileRegions(
  previousRegions: readonly TextRegion[],
  currentRegions: readonly TextRegion[],
): RegionReconciliation {
  const previousById = new Map(previousRegions.map((region) => [region.id, region]));
  const currentById = new Map(currentRegions.map((region) => [region.id, region]));
  const result: RegionReconciliation = { added: [], changed: [], removed: [], unchanged: [] };

  for (const current of currentRegions) {
    const previous = previousById.get(current.id);
    if (!previous) result.added.push(current);
    else if (previous.sourceKey !== current.sourceKey) result.changed.push({ previous, current });
    else result.unchanged.push(current);
  }
  for (const previous of previousRegions) {
    if (!currentById.has(previous.id)) result.removed.push(previous);
  }
  return result;
}

export function isRegionAffected(region: TextRegion, roots: readonly ParentNode[]): boolean {
  return roots.some((root) => {
    if (!(root instanceof Node)) return false;
    return root === region.element || root.contains(region.element) || region.element.contains(root);
  });
}
