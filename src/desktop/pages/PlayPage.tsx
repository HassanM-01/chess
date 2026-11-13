// Play: the menu until you start a game, then the game. The game stays alive while you look at other tabs.
import { useEffect } from 'react';
import { usePlay } from '../state/play';
import { PlayGame } from './PlayGame';
import { PlaySetup } from './PlaySetup';

export function PlayPage(): JSX.Element {
  const loaded = usePlay((s) => s.loaded);
  const session = usePlay((s) => s.session);
  useEffect(() => {
    void usePlay.getState().load();
  }, []);
  if (!loaded) return <div className="dk-splash"><div className="spinner" /></div>;
  return session ? <PlayGame key={session.id} /> : <PlaySetup />;
}
