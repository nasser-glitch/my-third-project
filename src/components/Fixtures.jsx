import { useMemo, useState } from 'react';
import { findTeamId, formatRoundLabel, isLive, stageOrder, getWcRank } from '../utils.js';
import { TEAMS } from '../data.js';
import { todayISO } from '../api.js';

function MatchRow({ match, myTeamIds, participants, assignments }) {
  const live = isLive(match);
  const finished = match.status === 'FINISHED';

  const homeId = findTeamId(match.homeTeam);
  const awayId = findTeamId(match.awayTeam);
  const homeFlag = homeId ? TEAMS.find(t => t.id === homeId)?.flag : '';
  const awayFlag = awayId ? TEAMS.find(t => t.id === awayId)?.flag : '';
  const homeWcRank = homeId ? getWcRank(homeId) : null;
  const awayWcRank = awayId ? getWcRank(awayId) : null;

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
      <div className="fix-date">
        {live ? (
          <span className="fix-live-badge">LIVE</span>
        ) : (
          <>
            <span className="fix-day">{dateStr}</span>
            <span className="fix-time">{timeStr} BST</span>
          </>
        )}
      </div>

      <div className={`fix-team fix-home ${homeHighlight ? 'fix-my-team' : ''}`}>
        <span className="fix-flag">{homeFlag}</span>
        <span className="fix-name">{match.homeTeam?.shortName || match.homeTeam?.name}</span>
        {homeWcRank && <span className="fix-wc-rank">#{homeWcRank}</span>}
        {homeOwner && <span className="fix-owner">{homeOwner}</span>}
      </div>

      {scoreDisplay}

      <div className={`fix-team fix-away ${awayHighlight ? 'fix-my-team' : ''}`}>
        {awayOwner && <span className="fix-owner">{awayOwner}</span>}
        {awayWcRank && <span className="fix-wc-rank">#{awayWcRank}</span>}
        <span className="fix-name">{match.awayTeam?.shortName || match.awayTeam?.name}</span>
        <span className="fix-flag">{awayFlag}</span>
      </div>

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
  const parts = name.split(' ');
  return parts[0] + (parts[1] ? ' ' + parts[1][0] + '.' : '');
}

export default function Fixtures({ allMatches, assignments, participants, lastUpdated, myTeamIds: myTeamIdsProp }) {
  const [stageFilter, setStageFilter] = useState('all');  // 'all'|'group'|'knockout'
  const [teamFilter,  setTeamFilter]  = useState('all');  // 'all'|'myteams'
  const [timeFilter,  setTimeFilter]  = useState('all');  // 'all'|'today'
  const today = todayISO();

  const myTeamIds = myTeamIdsProp ?? new Set();

  const filtered = useMemo(() => {
    if (!allMatches?.length) return [];
    return allMatches.filter(m => {
      const hId = findTeamId(m.homeTeam);
      const aId = findTeamId(m.awayTeam);
      if (stageFilter === 'group'    && m.stage !== 'GROUP_STAGE') return false;
      if (stageFilter === 'knockout' && m.stage === 'GROUP_STAGE') return false;
      if (teamFilter  === 'myteams'  && !myTeamIds.has(hId) && !myTeamIds.has(aId)) return false;
      if (timeFilter  === 'today'    && !m.utcDate.startsWith(today)) return false;
      return true;
    });
  }, [allMatches, stageFilter, teamFilter, timeFilter, myTeamIds, today]);

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
      <div className="fix-filters">
        <div className="fix-filter-group">
          <span className="fix-filter-label">Stage</span>
          {[{id:'all',label:'All'},{id:'group',label:'Group'},{id:'knockout',label:'Knockout'}].map(f => (
            <button key={f.id} className={`fix-filter-btn${stageFilter === f.id ? ' active' : ''}`} onClick={() => setStageFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        <div className="fix-filter-group">
          <span className="fix-filter-label">Teams</span>
          {[{id:'all',label:'All'},{id:'myteams',label:'My Teams'}].map(f => (
            <button key={f.id} className={`fix-filter-btn${teamFilter === f.id ? ' active' : ''}`} onClick={() => setTeamFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        <div className="fix-filter-group">
          <span className="fix-filter-label">When</span>
          {[{id:'all',label:'All'},{id:'today',label:'Today'}].map(f => (
            <button key={f.id} className={`fix-filter-btn${timeFilter === f.id ? ' active' : ''}`} onClick={() => setTimeFilter(f.id)}>{f.label}</button>
          ))}
        </div>
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
