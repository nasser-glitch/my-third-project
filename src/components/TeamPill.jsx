import { getTeam } from '../utils.js';

export default function TeamPill({ tid, status }) {
  const t = getTeam(tid);
  if (!t) return null;
  const cls =
    status === 'eliminated' ? 'pill elim' :
    status === 'champion'   ? 'pill champ' : 'pill';
  return (
    <span className={cls}>
      {t.flag}&nbsp;
      <span style={{ fontSize: '.82rem' }}>{t.name}</span>
      {status === 'champion' && ' 🏆'}
    </span>
  );
}
