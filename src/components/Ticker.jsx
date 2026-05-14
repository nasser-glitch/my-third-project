import { useMemo } from 'react';
import { formatStatus, isLive } from '../utils.js';

function formatMatchItem(m) {
  const home = m.homeTeam?.shortName || m.homeTeam?.name || '?';
  const away = m.awayTeam?.shortName || m.awayTeam?.name || '?';
  const live = isLive(m);
  const st = formatStatus(m);

  if (m.status === 'FINISHED') {
    const h = m.score?.fullTime?.home ?? '?';
    const a = m.score?.fullTime?.away ?? '?';
    return `${home} ${h}–${a} ${away}  [FT]`;
  }
  if (live) {
    const h = m.score?.fullTime?.home ?? 0;
    const a = m.score?.fullTime?.away ?? 0;
    return `★ ${home} ${h}–${a} ${away}  [${st}]`;
  }
  // Scheduled — show kickoff time
  const d = new Date(m.utcDate);
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
  });
  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
  return `${home} vs ${away}  [${dateStr} ${time}]`;
}

export default function Ticker({ todaysMatches, nextMatch, loading, apiError }) {
  const content = useMemo(() => {
    if (!todaysMatches || todaysMatches.length === 0) {
      if (nextMatch) {
        const nm = nextMatch;
        const home = nm.homeTeam?.shortName || nm.homeTeam?.name || '?';
        const away = nm.awayTeam?.shortName || nm.awayTeam?.name || '?';
        const d = new Date(nm.utcDate);
        const dt = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
        const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
        return `No matches today  ◆  Next match: ${home} vs ${away}, ${dt} ${t}`;
      }
      return 'No matches today  ◆  FIFA World Cup 2026  ◆  USA · Canada · Mexico';
    }
    return todaysMatches.map(formatMatchItem).join('   ◆   ');
  }, [todaysMatches, nextMatch]);

  const hasLive = todaysMatches?.some(isLive);

  return (
    <div className="ticker" aria-label="Live scores ticker">
      {/* Left label */}
      <div className={`ticker-label ${hasLive ? 'ticker-label-live' : ''}`}>
        {hasLive ? '● LIVE' : '⚽ WC26'}
      </div>

      {/* Scrolling content */}
      <div className="ticker-track">
        {apiError ? (
          <span className="ticker-error">⚠ Live data unavailable</span>
        ) : (
          <div className="ticker-content" key={content}>
            {/* Duplicate for seamless loop */}
            {content}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;◆&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{content}
          </div>
        )}
      </div>

      {/* Loading spinner */}
      {loading && <div className="ticker-spin">○</div>}
    </div>
  );
}
