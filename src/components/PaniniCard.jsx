import { getTeam, stripColor } from '../utils.js';

export default function PaniniCard({ tid, status, owner, idx, animated, onCycleStatus }) {
  const t = getTeam(tid);
  if (!t) return null;
  const isElim  = status === 'eliminated';
  const isChamp = status === 'champion';

  const cls = [
    'card',
    isElim  ? 'elim'  : '',
    isChamp ? 'champ' : '',
    animated ? 'reveal' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      style={animated ? { animationDelay: `${idx * 0.09}s` } : {}}
      onClick={onCycleStatus ? () => onCycleStatus(tid) : undefined}
      title={onCycleStatus ? 'Click to cycle status' : undefined}
      role={onCycleStatus ? 'button' : undefined}
    >
      {isChamp && <div className="champ-star">🏆</div>}

      <div className="card-strip" style={{ background: stripColor(t.group) }}>
        <span style={{ fontFamily: 'Oswald,sans-serif', fontSize: '.6rem', fontWeight: 700, color: '#fff', letterSpacing: '.1em' }}>
          GRP {t.group}
        </span>
        <span style={{ fontFamily: 'Oswald,sans-serif', fontSize: '.55rem', fontWeight: 600, color: 'rgba(255,255,255,.75)', letterSpacing: '.06em' }}>
          WC 2026
        </span>
      </div>

      <div className="card-flag">{t.flag}</div>
      <div className="card-name">{t.name}</div>

      {owner && <div className="card-owner">{owner}</div>}
      {isElim && <div className="stamp">ELIMINATED</div>}
    </div>
  );
}
