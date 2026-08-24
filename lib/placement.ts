import { LANES, laneOf } from "@/content/village";

/**
 * Seating a "place our lodges together" group down one lane. Shared so the
 * location step can offer the option only when it can actually be honoured
 * and checkout can seat it the same way, from one set of rules.
 *
 * Deliberately free of server imports: the checkout path and the client
 * step both run it, so it takes plain units rather than Apaleo types.
 */

/** The unit shape placement needs: an id to assign, a lane-named door. */
export type PlaceableUnit = { id: string; name: string };

/** The trailing door number of a lane-named unit ("Fig Lane 3" gives 3). */
export function trailingNumber(name: string): number | null {
  const match = /(\d+)$/.exec(name.trim());
  return match ? Number(match[1]) : null;
}

/** The distinct one-unit-per-slot pick with the smallest door-number spread.
 *  Groups are 2-3 slots and lanes hold 4-6 lodges, so the walk stays tiny. */
export function tightestDistinct(
  candidates: PlaceableUnit[][],
): { units: PlaceableUnit[]; spread: number } | null {
  let best: { units: PlaceableUnit[]; spread: number } | null = null;
  const chosen: PlaceableUnit[] = [];
  const used = new Set<string>();
  const walk = (position: number) => {
    if (position === candidates.length) {
      const numbers = chosen.map((u) => trailingNumber(u.name)!);
      const spread = Math.max(...numbers) - Math.min(...numbers);
      if (!best || spread < best.spread) best = { units: [...chosen], spread };
      return;
    }
    for (const unit of candidates[position]) {
      if (used.has(unit.id)) continue;
      used.add(unit.id);
      chosen.push(unit);
      walk(position + 1);
      chosen.pop();
      used.delete(unit.id);
    }
  };
  walk(0);
  return best;
}

/**
 * One lane must seat the whole group, each member with a distinct free unit
 * of its own tier from its own pool, and among the lanes that can, the
 * combination with the tightest run of door numbers wins. Null when no lane
 * can seat the group at all.
 *
 * `adjacent` is the honesty flag: doors 3 and 4 are neighbours, doors 3 and
 * 7 are merely the closest we could find, and only a consecutive run is what
 * the fee sells.
 */
export function planTogether(
  pools: PlaceableUnit[][],
): { units: PlaceableUnit[]; adjacent: boolean } | null {
  let best: { units: PlaceableUnit[]; spread: number } | null = null;
  for (const lane of LANES) {
    const candidates = pools.map((pool) =>
      pool.filter(
        (u) => laneOf(u.name)?.name === lane.name && trailingNumber(u.name) !== null,
      ),
    );
    if (candidates.some((c) => c.length === 0)) continue;
    const laneBest = tightestDistinct(candidates);
    if (laneBest && (!best || laneBest.spread < best.spread)) best = laneBest;
  }
  if (!best) return null;
  const winner: { units: PlaceableUnit[]; spread: number } = best;
  return { units: winner.units, adjacent: winner.spread === pools.length - 1 };
}
