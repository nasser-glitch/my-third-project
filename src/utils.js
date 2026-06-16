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

// How far a team progressed — returns a numeric score (higher = further).
// Used for the single-winner tiebreaker when two participants share the champion team.
const STAGE_SCORE = {
  GROUP_STAGE: 1, LAST_32: 2, LAST_16: 3,
  QUARTER_FINALS: 4, SEMI_FINALS: 5, THIRD_PLACE: 6, FINAL: 7,
};
export const PROGRESS_LABELS = [
  '—', 'Group Stage', 'Round of 32', 'Round of 16',
  'Quarter-Finals', 'Semi-Finals', 'Third Place', 'Final', '🏆 World Champions',
];

// Points by highest knockout round reached (indexed by computeTeamProgress 0–8).
// Group stage results are handled separately (win=3pts, draw=1pt) and are always additive.
const KNOCKOUT_PTS = [0, 0, 3, 5, 8, 12, 15, 17, 20];

// WC-relative rank: position among 48 WC teams sorted by FIFA rank (1=best, 48=worst).
const WC_RANKS = (() => {
  const sorted = [...TEAMS].sort((a, b) => a.fifaRank - b.fifaRank);
  const ranks = {};
  sorted.forEach((t, i) => { ranks[t.id] = i + 1; });
  return ranks;
})();

export function getWcRank(teamId) {
  return WC_RANKS[teamId] ?? null;
}

function getUnderdogMultiplier(teamId) {
  const wcRank = WC_RANKS[teamId] ?? 48;
  if (wcRank <= 10) return 1;
  if (wcRank <= 20) return 1.1;
  if (wcRank <= 32) return 1.25;
  return 1.4;
}

function computeGroupPts(teamId, allMatches) {
  return allMatches
    .filter(m => m.status === 'FINISHED' && m.stage === 'GROUP_STAGE')
    .reduce((pts, m) => {
      const hId = findTeamId(m.homeTeam);
      const aId = findTeamId(m.awayTeam);
      if (hId !== teamId && aId !== teamId) return pts;
      const winner = m.score?.winner;
      if (!winner || winner === 'DRAW') return pts + 1;
      return pts + (getWinnerTeamId(m) === teamId ? 3 : 0);
    }, 0);
}

export function computeParticipantPoints(tids, allMatches) {
  return tids.reduce((sum, teamId) => {
    const multiplier  = getUnderdogMultiplier(teamId);
    const groupPts    = computeGroupPts(teamId, allMatches);
    const knockoutPts = KNOCKOUT_PTS[computeTeamProgress(teamId, allMatches)] ?? 0;
    return sum + (groupPts + knockoutPts) * multiplier;
  }, 0);
}

export function computeTeamProgress(teamId, allMatches) {
  let best = 0;
  allMatches.filter(m => m.status === 'FINISHED').forEach(m => {
    const hId = findTeamId(m.homeTeam);
    const aId = findTeamId(m.awayTeam);
    if (hId !== teamId && aId !== teamId) return;
    if (m.stage === 'FINAL' && getWinnerTeamId(m) === teamId) {
      best = Math.max(best, 8);
    } else if (m.stage === 'THIRD_PLACE') {
      // winner gets 15pts (index 6); loser gets SF-level 12pts (index 5)
      best = Math.max(best, getWinnerTeamId(m) === teamId ? 6 : 5);
    } else {
      best = Math.max(best, STAGE_SCORE[m.stage] ?? 0);
    }
  });
  return best;
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
