// Loads everything computeSkillProfile needs from the repo, and stores snapshots for the improvement trend.
import type { Repo } from '@/db/repo';
import { computeSkillProfile, type SkillProfile } from './computeSkillProfile';

/** Games that feed the skill profile: analyzed, user color known, from chess.com or imported PGNs (not bot games). */
const counts = (source: string): boolean => source === 'chesscom' || source === 'pgn';

export async function loadSkillProfile(repo: Repo, now: Date = new Date()): Promise<SkillProfile> {
  const [games, mistakes, analyses, attempts] = await Promise.all([repo.listGames(), repo.listMistakes(), repo.listAnalyses(), repo.listAttempts({ limit: 400 })]);
  const eligible = games.filter((g) => g.analysisStatus === 'done' && g.userColor && counts(g.source));
  return computeSkillProfile({ games: eligible, mistakes, summaries: analyses, attempts, now });
}

/** Store a snapshot after a sync (spec 6.3): the Coach screen shows the trend. */
export async function snapshotSkillProfile(repo: Repo): Promise<SkillProfile> {
  const profile = await loadSkillProfile(repo);
  await repo.insertSnapshot(profile, profile.gamesAnalyzed);
  return profile;
}
