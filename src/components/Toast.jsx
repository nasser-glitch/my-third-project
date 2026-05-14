import { useEffect } from 'react';
import { getTeam } from '../utils.js';

function ToastItem({ toast, onDismiss }) {
  const isChamp = toast.type === 'champion';
  const t = getTeam(toast.teamId);

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 6000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`toast-item ${isChamp ? 'toast-champ' : 'toast-elim'}`}
      onClick={() => onDismiss(toast.id)}
      role="button"
      aria-label="Dismiss notification"
    >
      <div className="toast-icon">{isChamp ? '🏆' : '💀'}</div>
      <div className="toast-body">
        <div className="toast-title">
          {isChamp ? 'CHAMPION!' : 'ELIMINATED'}
        </div>
        <div className="toast-msg">
          <strong>{toast.participantName}</strong>
          {isChamp
            ? `'s ${t?.flag} ${t?.name} are World Champions!`
            : `'s ${t?.flag} ${t?.name} have been eliminated`}
        </div>
        {toast.lastTeam && !isChamp && (
          <div className="toast-sub">All teams out — commiserations! 🥺</div>
        )}
      </div>
      <div className="toast-close">×</div>
    </div>
  );
}

export default function ToastContainer({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
