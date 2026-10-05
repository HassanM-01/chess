// Games analyzed before "same pattern, new look" existed have no variants. Build them from the stored evals and mistakes
// (no engine needed) the first time the app loads.
import { opponentName } from '@/analysis/queue';
import type { Repo } from '@/db/repo';
import { generateVariantItems } from './variants';

/** Returns how many variant items were added. Never throws: this is a nice-to-have. */
export async function backfillVariants(repo: Repo): Promise<number> {
  try {
    const [games, analyses, mistakes, items] = await Promise.all([repo.listGames(), repo.listAnalyses(), repo.listMistakes(), repo.listTrainingItems()]);
    const evalsOf = new Map(analyses.map((a) => [a.gameId, a.evals]));
    const hasVariants = new Set(items.filter((i) => i.kind === 'variant' && i.gameId).map((i) => i.gameId as string));
    const drafts = [];
    for (const g of games) {
      if (!g.userColor || !evalsOf.has(g.id) || hasVariants.has(g.id)) continue;
      const ms = mistakes.filter((m) => m.gameId === g.id);
      if (!ms.length) continue;
      drafts.push(...generateVariantItems(g, evalsOf.get(g.id) ?? [], ms, { gameId: g.id, opponent: opponentName(g) }));
    }
    return drafts.length ? await repo.addTrainingItems(drafts) : 0;
  } catch (e) {
    console.warn('could not backfill practice variants', e);
    return 0;
  }
}
