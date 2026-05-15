import { TEAMS } from '../data.js';
import { findTeamId, getWcRank } from '../utils.js';

function ownersOf(teamId, assignments, participants) {
  if (!assignments || !teamId) return [];
  return Object.entries(assignments)
    .filter(([, tids]) => tids.includes(teamId))
    .map(([idx]) => participants[+idx])
    .filter(Boolean);
}

function GroupCard({ grp, assignments, participants }) {
  const label = (grp.group || '').replace('GROUP_', '');
  return (
    <div className="group-card">
      <div className="group-card-hdr">Group {label}</div>
      <table className="group-table">
        <thead>
          <tr>
            <th className="gt-pos">#</th>
            <th className="gt-team">Team</th>
            <th className="gt-num">P</th>
            <th className="gt-num">W</th>
            <th className="gt-num">D</th>
            <th className="gt-num">L</th>
            <th className="gt-num">GD</th>
            <th className="gt-num gt-pts">Pts</th>
          </tr>
        </thead>
        <tbody>
          {(grp.table || []).map(row => {
            const teamId = findTeamId(row.team);
            const internalTeam = TEAMS.find(t => t.id === teamId);
            const wcRank = teamId ? getWcRank(teamId) : null;
            const owners = ownersOf(teamId, assignments, participants);
            const owned = owners.length > 0;
            return (
              <tr key={row.position} className={owned ? 'gt-row-owned' : ''}>
                <td className="gt-pos">{row.position}</td>
                <td className="gt-team">
                  <span className="gt-flag">{internalTeam?.flag ?? '🏳'}</span>
                  {internalTeam?.name ?? row.team?.shortName ?? row.team?.name}
                  {wcRank && <span className="gt-wc-rank">#{wcRank}</span>}
                  {owned && owners.map(owner => (
                    <span key={owner} className="group-owner-badge">{owner}</span>
                  ))}
                </td>
                <td className="gt-num">{row.playedGames}</td>
                <td className="gt-num">{row.won}</td>
                <td className="gt-num">{row.draw}</td>
                <td className="gt-num">{row.lost}</td>
                <td className="gt-num">{row.goalDifference > 0 ? '+' : ''}{row.goalDifference}</td>
                <td className="gt-num gt-pts">{row.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function GroupTable({ standings, assignments, participants }) {
  const groups = (standings || [])
    .filter(s => s.type === 'TOTAL')
    .sort((a, b) => (a.group || '').localeCompare(b.group || ''));

  if (!groups.length) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem', fontFamily: 'Special Elite,cursive', color: '#888', fontSize: '1rem' }}>
        Group standings will appear once the tournament begins.
      </div>
    );
  }

  return (
    <div className="group-grid">
      {groups.map(grp => (
        <GroupCard
          key={grp.group}
          grp={grp}
          assignments={assignments}
          participants={participants}
        />
      ))}
    </div>
  );
}
