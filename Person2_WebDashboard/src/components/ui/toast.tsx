/**
 * Minimal toast system. Deliberately dependency-free: it announces the result
 * of an action in the same words as the control that triggered it ("Approve" ->
 * "Approved"), and it is polite to screen readers.
 */
import * as React from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (item: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  // A missing provider must never crash a page; degrade to console instead.
  if (!context) {
    return {
      toast: ({ title, description }) => console.info('[toast]', title, description ?? ''),
    };
  }
  return context;
}

const toneConfig: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: 'border-verified/30 bg-verified-soft text-verified' },
  error: { icon: AlertTriangle, className: 'border-rejected/30 bg-rejected-soft text-rejected' },
  info: { icon: Info, className: 'border-accent/30 bg-accent-soft text-accent-dark' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = React.useCallback(
    (item: Omit<ToastItem, 'id'>) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setItems((current) => [...current, { ...item, id }].slice(-4));
      setTimeout(() => dismiss(id), 5_000);
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
      >
        {items.map((item) => {
          const { icon: Icon, className } = toneConfig[item.tone];
          return (
            <div
              key={item.id}
              className={cn(
                'pointer-events-auto flex items-start gap-2.5 rounded-md border px-3 py-2.5 shadow-[0_8px_24px_rgba(15,27,45,0.14)]',
                className,
              )}
            >
              <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-[11.5px] opacity-85">{item.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss"
                className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
