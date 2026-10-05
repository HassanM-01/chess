import type { ThemeKey } from '@/db/types';

export interface ThemeInfo {
  name: string;
  prompt: string;
}

export const THEMES: Record<ThemeKey, ThemeInfo> = {
  save: { name: 'Save your piece', prompt: 'One of your pieces is in danger. Find the move that saves it.' },
  free: { name: 'Free pieces', prompt: 'Something is free. Take it.' },
  fork: { name: 'Forks', prompt: 'Find the move that attacks two things at once.' },
  stopmate: { name: 'Stop the mate', prompt: 'They are threatening checkmate. Stop it.' },
  mate1: { name: 'Mate in 1', prompt: 'Checkmate in one move.' },
  mate2: { name: 'Mate in 2', prompt: 'Checkmate in two moves.' },
  winmat: { name: 'Win material', prompt: 'Find the move that wins material.' },
};

export const THEME_KEYS = Object.keys(THEMES) as ThemeKey[];
