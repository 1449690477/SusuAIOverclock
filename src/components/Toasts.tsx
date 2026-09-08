import React from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';

export interface ToastItem {
  id: string;
  kind: 'ok' | 'err' | 'info';
  text: string;
}

export default function Toasts({ items }: { items: ToastItem[] }) {
  if (!items.length) return null;
  return (
    <div className="toast-wrap">
      {items.map((t) => (
        <div className={`toast ${t.kind}`} key={t.id} data-testid="toast">
          {t.kind === 'ok' ? (
            <CheckCircle2 size={15} color="#3fae72" />
          ) : t.kind === 'err' ? (
            <XCircle size={15} color="#e06c75" />
          ) : (
            <Info size={15} color="#2f9fd0" />
          )}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
