import { useMemo, useState } from 'react';
import { findTeamId, formatRoundLabel, isLive, stageOrder } from '../utils.js';
import { TEAMS } from '../data.js';
import { todayISO } from '../api.js';

const FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'today',    label: 'Today' },
  { id: 'myteams',  label: 'My Teams' },
  { id: 'group',    label: 'Group Stage' },
  { id: 'knockout', label: 'Knockout' },
];

function MatchRow({ match, myTeamIds, participants, assignments }) {
  const live = isLive(match);
  const finished = match.status === 'FINISHED';
  const scheduled = ['TIMED','SCHEDULED'].includes(match.status);

  const homeId = findTeamId(match.homeTeam);
  const awayId = findTeamId(match.awayTeam);
  const homeFlag = homeId ? TEAMS.find(t => t.id === homeId)?.flag : '';
  const awayFlag = awayId ? TEAMS.find(t => t.id === awayId)?.flag : '';

  const homeOwner = homeId && assignments ? findOwner(homeId, assignments, participants) : null;
  const awayOwner = awayId && assignments ? findOwner(awayId, assignments, participants) : null;

  const d = new Date(match.utcDate);
  const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
  const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

  const homeHighlight = myTeamIds.has(homeId);
  const awayHighlight = myTeamIds.has(awayId);

  let scoreDisplay;
  if (finished) {
    scoreDisplay = (
      <span className="fix-score fix-ft">
        {match.score?.fullTime?.home ?? '?'} – {match.score?.fullTime?.away ?? '?'}
      </span>
    );
  } else if (live) {
    scoreDisplay = (
      <span className="fix-score fix-live-score">
        {match.score?.fullTime?.home ?? 0} – {match.score?.fullTime?.away ?? 0}
      </span>
    );
  } else {
    scoreDisplay = <span className="fix-score fix-vs">vs</span>;
  }

  return (
    <div className={`fix-row ${live ? 'fix-row-live' : ''} ${finished ? 'fix-row-ft' : ''}`}>
      {/* Date/time */}
      <div className="fix-date">
        {live ? (
          <span className="fix-live-badge">LIVE</span>
        ) : (
          <>
            <span className="fix-day">{dateStr}</span>
            <span className="fix-time">{timeStr}</span>
          </>
        )}
      </div>

      {/* Home team */}
      <div className={`fix-team fix-home ${homeHighlight ? 'fix-my-team' : ''}`}>
        <span className="fix-flag">{homeFlag}</span>
        <span className="fix-name">{match.homeTeam?.shortName || match.homeTeam?.name}</span>
        {homeOwner && <span className="fix-owner">{homeOwner}</span>}
      </div>

      {/* Score / vs */}
      {scoreDisplay}

      {/* Away team */}
      <div className={`fix-team fix-away ${awayHighlight ? 'fix-my-team' : ''}`}>
        {awayOwner && <span className="fix-owner">{awayOwner}</span>}
        <span className="fix-name">{match.awayTeam?.shortName || match.awayTeam?.name}</span>
        <span className="fix-flag">{awayFlag}</span>
      </div>

      {/* Venue */}
      {match.venue && (
        <div className="fix-venue">{match.venue}</div>
      )}
    </div>
  );
}

function findOwner(teamId, assignments, participants) {
  if (!assignments) return null;
  const entry = Object.entries(assignments).find(([, tids]) => tids.includes(teamId));
  if (!entry) return null;
  const name = participants[parseInt(entry[0], 10)];
  if (!name) return null;
  // Return shortened name
  const parts = name.split(' ');
  return parts[0] + (parts[1] ? ' ' + parts[1][0] + '.' : '');
}

export default function Fixtures({ allMatches, assignments, participants, lastUpdated }) {
  const [filter, setFilter] = useState('all');
  const today = todayISO();

  const myTeamIds = useMemo(() => {
    if (!assignments) return new Set();
    return new Set(Object.values(assignments).flat());
  }, [assignments]);

  const filtered = useMemo(() => {
    if (!allMatches?.length) return [];
    return allMatches.filter(m => {
      if (filter === 'today') return m.utcDate.startsWith(today);
      if (filter === 'myteams') {
        const hId = findTeamId(m.homeTeam);
        const aId = findTeamId(m.awayTeam);
        return myTeamIds.has(hId) || myTeamIds.has(aId);
      }
      if (filter === 'group')    return m.stage === 'GROUP_STAGE';
      if (filter === 'knockout') return m.stage !== 'GROUP_STAGE';
      return true;
    });
  }, [allMatches, filter, myTeamIds, today]);

  // Group by stage then by group/matchday, preserving chronological order
  const sections = useMemo(() => {
    const bySection = {};
    filtered.forEach(m => {
      const key = m.stage === 'GROUP_STAGE'
        ? `GROUP_STAGE__${m.group || ''}__${m.matchday || ''}`
        : m.stage;
      if (!bySection[key]) bySection[key] = { stage: m.stage, group: m.group, matchday: m.matchday, matches: [] };
      bySection[key].matches.push(m);
    });
    return Object.values(bySection).sort((a, b) => {
      const so = stageOrder(a.stage) - stageOrder(b.stage);
      if (so !== 0) return so;
      return (a.matchday || 0) - (b.matchday || 0);
    });
  }, [filtered]);

  function sectionLabel(sec) {
    if (sec.stage === 'GROUP_STAGE') {
      const g = (sec.group || '').replace('GROUP_', '');
      return `Group ${g}${sec.matchday ? ` · Matchday ${sec.matchday}` : ''}`;
    }
    return formatRoundLabel(sec.stage);
  }

  if (!allMatches?.length) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', fontFamily: 'Special Elite, cursive', color: '#888' }}>
        {!import.meta.env.VITE_FOOTBALL_API_KEY
          ? 'Add your API key in .env.local to load fixtures.'
          : 'Loading fixtures…'}
      </div>
    );
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="fix-filters">
        {FILTERS.map(f => (
          <button
            key={f.id}
            className={`fix-filter-btn ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {f.id === 'myteams' && !assignments && (
              <span style={{ fontSize: '.65rem', marginLeft: '4px', opacity: .6 }}>(draw first)</span>
            )}
          </button>
        ))}
      </div>

      {sections.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'Special Elite, cursive', color: '#888' }}>
          No matches found for this filter.
        </div>
      )}

      {sections.map((sec, si) => (
        <div key={si} className="fix-section">
          <div className="fix-section-hdr">{sectionLabel(sec)}</div>
          <div className="fix-list">
            {sec.matches.map(m => (
              <MatchRow
                key={m.id}
                match={m}
                myTeamIds={myTeamIds}
                participants={participants}
                assignments={assignments}
              />
            ))}
          </div>
        </div>
      ))}

      {lastUpdated && (
        <div className="last-updated">
          Last updated: {lastUpdated.toLocaleTimeString('en-GB')}
        </div>
      )}
    </div>
  );
}
