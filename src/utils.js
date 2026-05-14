import { TEAMS } from './data.js';

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function getTeam(id) {
  return TEAMS.find(t => t.id === id);
}

export function fmt(n) {
  return '£' + Number(n).toFixed(2);
}

export function playThwack(i) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const freq = 100 + (i % 5) * 12;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.22);
  } catch (e) {}
}

export function stripColor(group) {
  const hues = { A:0, B:25, C:200, D:120, E:280, F:45, G:160, H:330, I:60, J:190, K:310, L:85 };
  return `hsl(${hues[group] ?? 0},55%,32%)`;
}

// Match a football-data.org team object to our internal team ID.
// Tries TLA first (most reliable), then apiName, then fuzzy name.
export function findTeamId(apiTeam) {
  if (!apiTeam) return null;
  const tla = (apiTeam.tla || '').toUpperCase();
  const name = (apiTeam.name || '').toLowerCase();
  const shortName = (apiTeam.shortName || '').toLowerCase();

  // 1. TLA exact match
  if (tla) {
    const byTla = TEAMS.find(t => t.tla === tla);
    if (byTla) return byTla.id;
  }
  // 2. apiName exact match
  const byApiName = TEAMS.find(t => t.apiName.toLowerCase() === name);
  if (byApiName) return byApiName.id;
  // 3. Short name match
  if (shortName) {
    const byShort = TEAMS.find(t => t.name.toLowerCase() === shortName || t.apiName.toLowerCase() === shortName);
    if (byShort) return byShort.id;
  }
  // 4. Fuzzy — strip non-alpha and check containment
  const norm = name.replace(/[^a-z]/g, '');
  const byFuzzy = TEAMS.find(t => {
    const tn = t.name.toLowerCase().replace(/[^a-z]/g, '');
    const an = t.apiName.toLowerCase().replace(/[^a-z]/g, '');
    return tn === norm || an === norm || norm.includes(tn) || tn.includes(norm);
  });
  return byFuzzy ? byFuzzy.id : null;
}

// Determine the losing team ID from a finished knockout match
export function getLoserTeamId(match) {
  const winner = match.score?.winner;
  if (!winner || winner === 'DRAW') return null;
  const loserApiTeam = winner === 'HOME_TEAM' ? match.awayTeam : match.homeTeam;
  return findTeamId(loserApiTeam);
}

// Determine the winning team ID from a finished match
export function getWinnerTeamId(match) {
  const winner = match.score?.winner;
  if (!winner || winner === 'DRAW') return null;
  const winnerApiTeam = winner === 'HOME_TEAM' ? match.homeTeam : match.awayTeam;
  return findTeamId(winnerApiTeam);
}

// Format a match status for display
export function formatStatus(match) {
  const { status, utcDate, score } = match;
  switch (status) {
    case 'FINISHED': {
      const h = score?.fullTime?.home ?? '?';
      const a = score?.fullTime?.away ?? '?';
      return `FT ${h}-${a}`;
    }
    case 'IN_PLAY':
    case 'LIVE':
      return `LIVE ${score?.fullTime?.home ?? 0}-${score?.fullTime?.away ?? 0}`;
    case 'PAUSED':
    case 'HALFTIME':
      return `HT ${score?.halfTime?.home ?? 0}-${score?.halfTime?.away ?? 0}`;
    case 'TIMED':
    case 'SCHEDULED': {
      const d = new Date(utcDate);
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    }
    case 'POSTPONED': return 'POSTPONED';
    case 'SUSPENDED': return 'SUSPENDED';
    case 'CANCELLED': return 'CANCELLED';
    default: return status;
  }
}

export function isLive(match) {
  return ['IN_PLAY', 'LIVE', 'PAUSED', 'HALFTIME'].includes(match.status);
}

export function formatRoundLabel(stage, group) {
  if (stage === 'GROUP_STAGE') {
    const g = (group || '').replace('GROUP_', '');
    return g ? `Group ${g}` : 'Group Stage';
  }
  const labels = {
    LAST_32: 'Round of 32',
    LAST_16: 'Round of 16',
    QUARTER_FINALS: 'Quarter-Finals',
    SEMI_FINALS: 'Semi-Finals',
    THIRD_PLACE: 'Third-Place Play-off',
    FINAL: 'Final',
  };
  return labels[stage] || stage;
}

// Sort order for stages (ascending tournament order)
export function stageOrder(stage) {
  const order = {
    GROUP_STAGE: 0,
    LAST_32: 1,
    LAST_16: 2,
    QUARTER_FINALS: 3,
    SEMI_FINALS: 4,
    THIRD_PLACE: 5,
    FINAL: 6,
  };
  return order[stage] ?? 99;
}
