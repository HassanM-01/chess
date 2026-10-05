import { useEffect } from 'react';
import { create } from 'zustand';

interface ToastState {
  message: string | null;
  id: number;
  show: (m: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  id: 0,
  show: (message) => set((s) => ({ message, id: s.id + 1 })),
  clear: () => set({ message: null }),
}));

/** Short, explaining toast ("No silent taps", spec 8.1). Callable from anywhere. */
export const toast = (m: string): void => useToastStore.getState().show(m);

export function ToastHost(): JSX.Element | null {
  const { message, id, clear } = useToastStore();
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(clear, 2600);
    return () => clearTimeout(t);
  }, [message, id, clear]);
  if (!message) return null;
  return (
    <div className="toast" role="status" aria-live="polite" key={id}>
      {message}
    </div>
  );
}
