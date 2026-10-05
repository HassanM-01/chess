import type { MistakeCategory } from '@/analysis/types';
import type { ThemeKey } from '@/db/types';

export interface WeaknessInfo {
  label: string;
  short: string;
  theme: ThemeKey | null;
  lesson: string | null;
  advice: string;
}

/** Weakness categories found in a user's games (ported from prototype CATS). */
export const CATS: Record<MistakeCategory, WeaknessInfo> = {
  hung: {
    label: 'Leaving pieces undefended',
    short: 'Hung a piece',
    theme: 'save',
    lesson: 'check',
    advice:
      'Your move put a piece on an unsafe square or took away its defender. Before you let go of a piece, ask: is it safe there, and what did it stop protecting?',
  },
  ignored: {
    label: 'Missing their threats',
    short: 'Missed a threat',
    theme: 'save',
    lesson: 'check',
    advice: "Your opponent attacked something and your move didn't deal with it. Start every turn by asking what their last move threatens.",
  },
  missed_free: {
    label: 'Not taking free pieces',
    short: 'Missed a free piece',
    theme: 'free',
    lesson: 'free',
    advice: "Your opponent left a piece undefended and you didn't take it. Scan for loose enemy pieces every turn.",
  },
  fork: {
    label: 'Walking into forks',
    short: 'Allowed a fork',
    theme: 'fork',
    lesson: 'forks',
    advice: "Your opponent found a move that hit two of your pieces at once. Keep your valuable pieces out of a knight's reach of each other.",
  },
  missed_mate: {
    label: 'Missing checkmates',
    short: 'Missed a mate',
    theme: 'mate1',
    lesson: 'mate1',
    advice: "You had a checkmate and didn't play it. Look at every check you can give, every move.",
  },
  allowed_mate: {
    label: 'Getting checkmated',
    short: 'Allowed mate',
    theme: 'stopmate',
    lesson: 'scholar',
    advice: 'Your move let your opponent checkmate you or start a mating attack. Watch the squares around your king, especially f7/f2 and the back rank.',
  },
  other: {
    label: 'Slow or aimless moves',
    short: 'Weak move',
    theme: 'winmat',
    lesson: 'principles',
    advice: "These moves didn't lose a piece right away, but gave your opponent a big advantage. Follow the opening rules and look for active moves.",
  },
};

export type HabitKey = 'nocastle' | 'earlyqueen';

export const HABITS: Record<HabitKey, WeaknessInfo> = {
  nocastle: {
    label: 'Not castling',
    short: 'Not castling',
    theme: null,
    lesson: 'principles',
    advice: 'Your king stayed in the middle in most games. Castle within your first 10 moves so your king is safe and your rook joins in.',
  },
  earlyqueen: {
    label: 'Bringing the queen out early',
    short: 'Early queen',
    theme: null,
    lesson: 'principles',
    advice:
      'You moved your queen in the first 5 moves in a lot of games. It gets chased around while your opponent develops. Knights and bishops first.',
  },
};

export type WeaknessKey = MistakeCategory | HabitKey;

export function weakInfo(key: WeaknessKey): WeaknessInfo {
  return key in CATS ? CATS[key as MistakeCategory] : HABITS[key as HabitKey];
}
