import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TEAMS } from './data.js';
import { shuffle, getTeam, findTeamId, getLoserTeamId, getWinnerTeamId, isLive, computeTeamProgress, PROGRESS_LABELS, computeParticipantPoints, formatRoundLabel } from './utils.js';
import { fetchTodaysMatches, fetchAllMatches, fetchStandings, fetchNextMatch } from './api.js';
import { sendDrawEmail } from './email.js';
import supabase, { loadSweepstake, saveSweepstake } from './supabase.js';

import TeamPill       from './components/TeamPill.jsx';
import Ticker         from './components/Ticker.jsx';
import Fixtures       from './components/Fixtures.jsx';
import GroupTable     from './components/GroupTable.jsx';
import ToastContainer from './components/Toast.jsx';

// ── computeWinner ─────────────────────────────────────────────────
// Finds the sweepstake winner. If two participants share the WC-winning team,
// their second team's furthest stage reached acts as tiebreaker.
function computeWinner(assignments, participants, allMatches) {
  if (!assignments || !allMatches?.length) return null;
  const finalMatch = allMatches.find(m => m.stage === 'FINAL' && m.status === 'FINISHED');
  if (!finalMatch) return null;
  const champId = getWinnerTeamId(finalMatch);
  if (!champId) return null;

  const owners = Object.entries(assignments)
    .filter(([, tids]) => tids.includes(champId))
    .map(([idx, tids]) => {
      const secondTeam = tids.find(tid => tid !== champId) ?? null;
      const progress = secondTeam ? computeTeamProgress(secondTeam, allMatches) : 0;
      return { idx: +idx, name: participants[+idx], champTeamId: champId, secondTeam, progress };
    });

  if (!owners.length) return null;
  owners.sort((a, b) => b.progress - a.progress);
  return { winner: owners[0], isTiebreak: owners.length > 1, runnersUp: owners.slice(1) };
}

// ── WinnerBanner ──────────────────────────────────────────────────
function WinnerBanner({ result }) {
  const { winner, isTiebreak, runnersUp } = result;
  const champTeam  = getTeam(winner.champTeamId);
  const secondTeam = winner.secondTeam ? getTeam(winner.secondTeam) : null;
  const rival      = isTiebreak ? runnersUp[0] : null;
  const rivalTeam  = rival?.secondTeam ? getTeam(rival.secondTeam) : null;

  return (
    <div className="winner-banner">
      <div className="winner-crown">🏆</div>
      <div className="winner-name">{(winner.name || 'Winner').toUpperCase()} WINS!</div>
      <div className="winner-detail">
        {champTeam?.flag} {champTeam?.name} won the World Cup
      </div>
      {isTiebreak && rival && (
        <div className="winner-tiebreak">
          Tiebreaker — {winner.name}&apos;s {secondTeam?.flag} {secondTeam?.name} reached{' '}
          <strong>{PROGRESS_LABELS[winner.progress]}</strong> vs {rival.name}&apos;s{' '}
          {rivalTeam?.flag} {rivalTeam?.name} ({PROGRESS_LABELS[rival.progress]})
        </div>
      )}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────
const KNOCKOUT_STAGES = ['LAST_32','LAST_16','QUARTER_FINALS','SEMI_FINALS','THIRD_PLACE','FINAL'];

// ── Auto-elimination computation ──────────────────────────────────
function computeEliminations(allMatches, standings, assignments, participants, prevStatus) {
  if (!assignments) return { newStatus: prevStatus, toasts: [] };

  const newStatus = { ...prevStatus };
  const toasts = [];

  function markEliminated(teamId) {
    if (newStatus[teamId] === 'eliminated' || newStatus[teamId] === 'champion') return;
    newStatus[teamId] = 'eliminated';

    Object.entries(assignments).forEach(([pIdx, tids]) => {
      if (!tids.includes(teamId)) return;
      const name = participants[parseInt(pIdx, 10)];
      const allOut = tids.every(tid => newStatus[tid] === 'eliminated');
      toasts.push({
        id: Date.now() + Math.random(),
        type: 'elimination',
        teamId,
        participantName: name,
        lastTeam: allOut,
      });
    });
  }

  function markChampion(teamId) {
    if (newStatus[teamId] === 'champion') return;
    newStatus[teamId] = 'champion';
    Object.entries(assignments).forEach(([pIdx, tids]) => {
      if (!tids.includes(teamId)) return;
      toasts.push({
        id: Date.now() + Math.random(),
        type: 'champion',
        teamId,
        participantName: participants[parseInt(pIdx, 10)],
      });
    });
  }

  if (standings?.length) {
    standings.forEach(grp => {
      if (grp.type !== 'TOTAL') return;
      const table = grp.table || [];
      const allPlayed3 = table.length === 4 && table.every(r => r.playedGames >= 3);
      if (allPlayed3) {
        table.slice(2).forEach(row => {
          const tid = findTeamId(row.team);
          if (tid) markEliminated(tid);
        });
      }
    });
  }

  if (allMatches?.length) {
    allMatches.filter(m => m.status === 'FINISHED' && KNOCKOUT_STAGES.includes(m.stage))
      .forEach(m => {
        const loserId = getLoserTeamId(m);
        if (loserId) markEliminated(loserId);

        if (m.stage === 'FINAL') {
          const winnerId = getWinnerTeamId(m);
          if (winnerId) markChampion(winnerId);
        }
      });
  }

  return { newStatus, toasts };
}

// ── Self-service team assignment ──────────────────────────────────
function assignTeamsForNewSignup(currentAssignments, currentDupIds) {
  const allIds    = TEAMS.map(t => t.id);
  const taken     = new Set(Object.values(currentAssignments).flat());
  const free      = allIds.filter(id => !taken.has(id));
  const newDupIds = [...currentDupIds];
  let t1, t2;
  if (free.length >= 2) {
    const s = shuffle(free); [t1, t2] = [s[0], s[1]];
  } else if (free.length === 1) {
    t1 = free[0]; t2 = shuffle(allIds)[0];
    if (!newDupIds.includes(t2)) newDupIds.push(t2);
  } else {
    const s = shuffle(allIds); [t1, t2] = [s[0], s[1]];
    if (!newDupIds.includes(t1)) newDupIds.push(t1);
    if (!newDupIds.includes(t2)) newDupIds.push(t2);
  }
  return { t1, t2, newDupIds };
}

// ═════════════════════════════════════════════════════════════════
// APP
// ═════════════════════════════════════════════════════════════════
export default function App() {
  // ── Sweepstake state ──────────────────────────────────────────
  const [loading,            setLoading]            = useState(true);
  const [participants,       setParticipants]       = useState([]);
  const [assignments,        setAssignments]        = useState(null);
  const [teamStatus,         setTeamStatus]         = useState({});
  const [dupIds,             setDupIds]             = useState([]);
  const [participantEmails,  setParticipantEmails]  = useState([]);
  const [adminMode,          setAdminMode]          = useState(false);
  const [adminAuthed,        setAdminAuthed]        = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminError,         setAdminError]         = useState('');
  const [myEmail,            setMyEmail]            = useState(() => localStorage.getItem('wc2026_myemail') || '');
  const [signupMode,         setSignupMode]         = useState('signup');
  const [signupName,         setSignupName]         = useState('');
  const [signupEmail,        setSignupEmail]        = useState('');
  const [signupError,        setSignupError]        = useState('');
  const [participantTab,     setParticipantTab]     = useState('teams'); // 'teams'|'leaderboard'|'fixtures'|'groups'

  // ── API state ─────────────────────────────────────────────────
  const [todaysMatches, setTodaysMatches] = useState([]);
  const [allMatches,    setAllMatches]    = useState([]);
  const [standings,     setStandings]    = useState([]);
  const [nextMatch,     setNextMatch]    = useState(null);
  const [apiError,      setApiError]     = useState(null);
  const [tickerLoading, setTickerLoading]= useState(false);
  const [lastUpdated,   setLastUpdated]  = useState(null);
  const [toasts,        setToasts]       = useState([]);

  // ── Refs ──────────────────────────────────────────────────────
  const todayRef           = useRef(todaysMatches);
  const statusRef          = useRef(teamStatus);
  const assignRef          = useRef(assignments);
  const partRef            = useRef(participants);
  const pollRef            = useRef(null);
  const emailedMatchIdsRef = useRef(new Set());
  const saveTimerRef       = useRef(null);

  useEffect(() => { todayRef.current  = todaysMatches; }, [todaysMatches]);
  useEffect(() => { statusRef.current = teamStatus;    }, [teamStatus]);
  useEffect(() => { assignRef.current = assignments;   }, [assignments]);
  useEffect(() => { partRef.current   = participants;  }, [participants]);

  // ── Load from Supabase on first open ─────────────────────────
  useEffect(() => {
    loadSweepstake().then(data => {
      if (data) {
        const names = data.participants ?? [];
        setParticipants(names);
        setAssignments(data.assignments ?? null);
        setTeamStatus(data.team_status ?? {});
        setDupIds(data.dup_ids ?? []);
        setParticipantEmails(data.participant_emails ?? Array(names.length).fill(''));
        emailedMatchIdsRef.current = new Set(data.emailed_match_ids ?? []);
      }
      setLoading(false);
    });
  }, []);

  // ── Save to Supabase (debounced 1 second) ─────────────────────
  useEffect(() => {
    if (loading) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveSweepstake({
        participants,
        assignments,
        team_status: teamStatus,
        dup_ids: dupIds,
        participant_emails: participantEmails,
      });
    }, 1000);
  }, [participants, assignments, teamStatus, dupIds, participantEmails, loading]);

  // ── Real-time sync across all open tabs ──────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('sweepstake-live')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sweepstake' },
        payload => {
          const row = payload.new;
          setParticipants(row.participants ?? []);
          setAssignments(row.assignments ?? null);
          setTeamStatus(row.team_status ?? {});
          setDupIds(row.dup_ids ?? []);
          setParticipantEmails(row.participant_emails ?? []);
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // ── API refresh ───────────────────────────────────────────────
  const doRefresh = useCallback(async (force = false) => {
    setTickerLoading(true);
    let hasError = false;

    const [todayRes, allRes, standingsRes] = await Promise.allSettled([
      fetchTodaysMatches(force),
      fetchAllMatches(force),
      fetchStandings(force),
    ]);

    if (todayRes.status === 'fulfilled') {
      const matches = todayRes.value.data?.matches || [];
      setTodaysMatches(matches);
      todayRef.current = matches;
      if (todayRes.value.stale) hasError = true;
    } else {
      hasError = true;
    }

    if (allRes.status === 'fulfilled') {
      const matches = allRes.value.data?.matches || [];
      setAllMatches(matches);
      if (allRes.value.stale) hasError = true;
    } else {
      hasError = true;
    }

    if (standingsRes.status === 'fulfilled') {
      const s = standingsRes.value.data?.standings || [];
      setStandings(s);
      if (standingsRes.value.stale) hasError = true;
    } else {
      hasError = true;
    }

    const todayMatches = todayRes.status === 'fulfilled' ? (todayRes.value.data?.matches || []) : [];
    if (todayMatches.length === 0) {
      try {
        const nextRes = await fetchNextMatch();
        setNextMatch(nextRes.data?.matches?.[0] || null);
      } catch {}
    } else {
      setNextMatch(null);
    }

    setApiError(hasError ? 'Live data unavailable — showing last known results' : null);
    setLastUpdated(new Date());
    setTickerLoading(false);
  }, []);

  // ── Polling scheduler ─────────────────────────────────────────
  const schedulePoll = useCallback(() => {
    clearTimeout(pollRef.current);
    const hasLive = todayRef.current.some(isLive);
    const interval = hasLive ? 60_000 : 10 * 60_000;
    pollRef.current = setTimeout(async () => {
      await doRefresh(true);
      schedulePoll();
    }, interval);
  }, [doRefresh]);

  useEffect(() => {
    doRefresh(false).then(schedulePoll);
    return () => clearTimeout(pollRef.current);
  }, [doRefresh, schedulePoll]);

  // ── Auto-elimination when data arrives ────────────────────────
  useEffect(() => {
    if (!assignRef.current) return;
    const { newStatus, toasts: newToasts } = computeEliminations(
      allMatches, standings, assignRef.current, partRef.current, statusRef.current
    );
    const changed = Object.keys(newStatus).some(k => newStatus[k] !== statusRef.current[k]);
    if (changed) {
      setTeamStatus(newStatus);
      if (newToasts.length) setToasts(prev => [...prev, ...newToasts]);
    }
  }, [allMatches, standings]);


  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => () => clearTimeout(pollRef.current), []);

  // ── Sign-up ───────────────────────────────────────────────────
  const handleSignup = useCallback(() => {
    const name  = signupName.trim();
    const email = signupEmail.trim().toLowerCase();
    if (!name)                         { setSignupError('Please enter your name.'); return; }
    if (!email.endsWith('@autone.io')) { setSignupError('Please use your @autone.io email.'); return; }
    if (participantEmails.includes(email)) {
      localStorage.setItem('wc2026_myemail', email);
      setMyEmail(email);
      setSignupError('');
      return;
    }
    const newIdx = participants.length;
    const { t1, t2, newDupIds } = assignTeamsForNewSignup(assignments || {}, dupIds);
    const newParticipants = [...participants, name];
    const newEmails       = [...participantEmails, email];
    const newAssignments  = { ...(assignments || {}), [newIdx]: [t1, t2] };
    setParticipants(newParticipants);
    setParticipantEmails(newEmails);
    setAssignments(newAssignments);
    setDupIds(newDupIds);
    localStorage.setItem('wc2026_myemail', email);
    setMyEmail(email);
    setSignupError('');
    const t1obj = getTeam(t1);
    const t2obj = getTeam(t2);
    sendDrawEmail(
      email, name,
      t1obj ? `${t1obj.flag} ${t1obj.name}` : '?',
      t2obj ? `${t2obj.flag} ${t2obj.name}` : '?'
    );
  }, [signupName, signupEmail, participants, participantEmails, assignments, dupIds]);

  // ── Sign-in ───────────────────────────────────────────────────
  const handleSignIn = useCallback(() => {
    const email = signupEmail.trim().toLowerCase();
    if (!email.endsWith('@autone.io')) { setSignupError('Please use your @autone.io email.'); return; }
    if (!participantEmails.includes(email)) { setSignupError('No account found. Try signing up instead.'); return; }
    localStorage.setItem('wc2026_myemail', email);
    setMyEmail(email);
    setSignupError('');
  }, [signupEmail, participantEmails]);

  // ── Sign-out ──────────────────────────────────────────────────
  const handleSignOut = useCallback(() => {
    localStorage.removeItem('wc2026_myemail');
    setMyEmail('');
    setSignupName('');
    setSignupEmail('');
    setSignupError('');
  }, []);

  // ── Admin login ───────────────────────────────────────────────
  const handleAdminLogin = useCallback(() => {
    const correct = import.meta.env.VITE_ADMIN_PASSWORD;
    if (!correct) { setAdminError('Admin password not configured in .env.local'); return; }
    if (adminPasswordInput === correct) {
      setAdminAuthed(true);
      setAdminError('');
    } else {
      setAdminError('Incorrect password.');
    }
  }, [adminPasswordInput]);

  // ── Remove participant (frees their teams back to pool) ───────
  const handleRemove = useCallback((idx) => {
    if (!window.confirm(`Remove ${participants[idx]}? Their teams will be freed back to the pool.`)) return;
    const newParticipants = participants.filter((_, i) => i !== idx);
    const newEmails       = participantEmails.filter((_, i) => i !== idx);
    const newAssignments  = {};
    Object.entries(assignments || {}).forEach(([k, v]) => {
      const oldIdx = parseInt(k);
      if (oldIdx === idx) return;
      const newIdx = oldIdx > idx ? oldIdx - 1 : oldIdx;
      newAssignments[newIdx] = v;
    });
    const remaining = Object.values(newAssignments).flat();
    const counts = {};
    remaining.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    const newDupIds = dupIds.filter(id => (counts[id] || 0) >= 2);
    setParticipants(newParticipants);
    setParticipantEmails(newEmails);
    setAssignments(Object.keys(newAssignments).length ? newAssignments : null);
    setDupIds(newDupIds);
    if (participantEmails[idx] === myEmail) {
      localStorage.removeItem('wc2026_myemail');
      setMyEmail('');
    }
  }, [participants, participantEmails, assignments, dupIds, myEmail]);

  // ── Derived values ────────────────────────────────────────────
  const leaderboard = useMemo(() => {
    if (!assignments) return [];
    return participants
      .map((name, i) => ({
        name, i,
        tids: assignments[i] || [],
        pts: computeParticipantPoints(assignments[i] || [], allMatches),
      }))
      .sort((a, b) => b.pts - a.pts);
  }, [assignments, participants, allMatches]);

  const winnerResult = useMemo(() =>
    computeWinner(assignments, participants, allMatches),
    [assignments, participants, allMatches]);

  const myIndex = useMemo(() =>
    myEmail ? participantEmails.findIndex(e => e === myEmail) : -1,
    [myEmail, participantEmails]);

  const myTeams = useMemo(() =>
    myIndex >= 0 && assignments ? assignments[myIndex] ?? null : null,
    [myIndex, assignments]);

  const myPoints = useMemo(() =>
    computeParticipantPoints(myTeams || [], allMatches),
    [myTeams, allMatches]);

  // ═════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Special Elite, cursive', fontSize: '1.2rem', color: '#2D5A1B' }}>
        ⏳ Loading sweepstake…
      </div>
    );
  }

  // ── Admin password prompt ─────────────────────────────────────
  if (adminMode && !adminAuthed) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="admin-login">
          <h2 style={{ fontFamily: 'Special Elite, cursive', marginBottom: '1rem' }}>Admin Login</h2>
          <input
            className="inp"
            type="password"
            placeholder="Password"
            value={adminPasswordInput}
            onChange={e => setAdminPasswordInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdminLogin()}
            style={{ marginBottom: '.7rem' }}
          />
          {adminError && <p className="signup-error" style={{ marginBottom: '.7rem' }}>{adminError}</p>}
          <button
            className="draw-btn"
            style={{ fontSize: '1rem', padding: '.5rem 1.5rem', display: 'block', width: '100%' }}
            onClick={handleAdminLogin}
          >
            Enter
          </button>
          <div style={{ marginTop: '1rem', textAlign: 'center' }}>
            <button
              className="admin-link"
              onClick={() => { setAdminMode(false); setAdminPasswordInput(''); setAdminError(''); }}
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Admin panel ───────────────────────────────────────────────
  if (adminMode && adminAuthed) {
    return (
      <div className="admin-panel">
        <div style={{ marginBottom: '1rem' }}>
          <button
            className="admin-link"
            onClick={() => { setAdminMode(false); setAdminAuthed(false); setAdminPasswordInput(''); }}
          >
            ← Back to Sweepstake
          </button>
        </div>
        <h2 style={{ fontFamily: 'Special Elite, cursive', fontSize: '1.4rem', marginBottom: '.25rem' }}>
          Admin Panel
        </h2>
        <p style={{ fontFamily: 'Courier Prime, monospace', fontSize: '.82rem', color: '#888', marginBottom: '1.5rem' }}>
          {participants.length} {participants.length === 1 ? 'participant' : 'participants'}
        </p>
        {participants.length === 0 ? (
          <p style={{ color: '#888', fontFamily: 'Special Elite, cursive' }}>No participants yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr><th>#</th><th>Name</th><th>Email</th><th>Teams</th><th></th></tr>
              </thead>
              <tbody>
                {participants.map((name, i) => {
                  const tids = assignments?.[i] || [];
                  return (
                    <tr key={i}>
                      <td style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, color: 'var(--green)', width: '2rem' }}>{i + 1}</td>
                      <td style={{ fontFamily: 'Special Elite, cursive', whiteSpace: 'nowrap' }}>{name}</td>
                      <td style={{ fontSize: '.8rem', color: '#666' }}>{participantEmails[i] || '—'}</td>
                      <td>{tids.map(tid => { const t = getTeam(tid); return t ? `${t.flag} ${t.name}` : tid; }).join(' · ')}</td>
                      <td><button className="btn-remove" onClick={() => handleRemove(i)}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ── Landing page (not signed in) ──────────────────────────────
  if (myIndex === -1) {
    return (
      <div>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        <Ticker todaysMatches={todaysMatches} nextMatch={nextMatch} loading={tickerLoading} apiError={apiError} />
        {apiError && <div className="api-banner">⚠ {apiError}</div>}

        <div className="hdr">
          <div className="hdr-title">⚽ World Cup 2026 ⚽</div>
          <div className="hdr-title" style={{ fontSize: 'clamp(1.2rem,3.5vw,2.2rem)', marginTop: '.1rem' }}>
            Company Sweepstake
          </div>
          <div className="hdr-sub">USA · Canada · Mexico — June–July 2026</div>
        </div>

        <div className="landing">
          <section className="rules-box">
            <h2 className="rules-title">How It Works</h2>
            <ul className="rules-list">
              <li>Sign up and you&apos;ll be randomly assigned <strong>2 countries</strong> immediately.</li>
              <li>Points are earned as your teams progress through the tournament.</li>
              <li>Points per round: Group Stage=1 · R32=3 · R16=6 · QF=10 · SF=15 · 3rd=20 · Final=25 · Champion=40</li>
              <li>The participant with the most points wins a <strong>digital trophy</strong>. 🏆</li>
              <li>Sign up with your <strong>@autone.io</strong> email — teams are assigned instantly!</li>
            </ul>
          </section>

          <div className="signup-box">
            <div className="mode-toggle">
              <button
                className={`mode-btn${signupMode === 'signup' ? ' mode-btn--active' : ''}`}
                onClick={() => { setSignupMode('signup'); setSignupError(''); setSignupEmail(''); }}
              >
                Sign Up
              </button>
              <button
                className={`mode-btn${signupMode === 'signin' ? ' mode-btn--active' : ''}`}
                onClick={() => { setSignupMode('signin'); setSignupError(''); setSignupName(''); }}
              >
                Sign In
              </button>
            </div>

            {signupMode === 'signup' ? (
              <>
                <input
                  className="inp signup-inp"
                  placeholder="Your full name"
                  value={signupName}
                  onChange={e => setSignupName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSignup()}
                />
                <input
                  className="inp signup-inp"
                  type="email"
                  placeholder="you@autone.io"
                  value={signupEmail}
                  onChange={e => setSignupEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSignup()}
                />
                {signupError && <p className="signup-error">{signupError}</p>}
                <button
                  className="draw-btn"
                  style={{ fontSize: '1.1rem', padding: '.6rem 2rem' }}
                  onClick={handleSignup}
                >
                  Join Sweepstake
                </button>
                <p className="signup-spots">
                  {participants.length} {participants.length === 1 ? 'person' : 'people'} joined
                  {' · '}
                  {Math.max(0, 48 - Object.values(assignments || {}).flat().length)} team slots remaining
                </p>
              </>
            ) : (
              <>
                <input
                  className="inp signup-inp"
                  type="email"
                  placeholder="you@autone.io"
                  value={signupEmail}
                  onChange={e => setSignupEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSignIn()}
                />
                {signupError && <p className="signup-error">{signupError}</p>}
                <button
                  className="draw-btn"
                  style={{ fontSize: '1.1rem', padding: '.6rem 2rem' }}
                  onClick={handleSignIn}
                >
                  Sign In
                </button>
              </>
            )}
          </div>
        </div>

        <div className="footer">
          ⚽ &nbsp; FIFA World Cup 2026 &nbsp;·&nbsp; USA, Canada &amp; Mexico &nbsp;·&nbsp; June–July 2026 &nbsp; ⚽
          <br />
          <button className="admin-link" style={{ marginTop: '.5rem' }} onClick={() => setAdminMode(true)}>
            Admin
          </button>
        </div>
      </div>
    );
  }

  // ── Logged-in participant view ─────────────────────────────────
  return (
    <div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <Ticker todaysMatches={todaysMatches} nextMatch={nextMatch} loading={tickerLoading} apiError={apiError} />
      {apiError && <div className="api-banner">⚠ {apiError}</div>}

      <div className="hdr">
        <div className="hdr-title">⚽ World Cup 2026 ⚽</div>
        <div className="hdr-title" style={{ fontSize: 'clamp(1.2rem,3.5vw,2.2rem)', marginTop: '.1rem' }}>
          Company Sweepstake
        </div>
        <div className="hdr-sub">USA · Canada · Mexico — June–July 2026</div>
        <div style={{ position: 'relative', zIndex: 1, marginTop: '.6rem' }}>
          <span style={{ fontFamily: 'Special Elite, cursive', color: 'var(--parchment)', fontSize: '.92rem' }}>
            Welcome, {participants[myIndex]}!
          </span>
          <button className="btn-signout" onClick={handleSignOut} style={{ marginLeft: '1rem' }}>
            Sign Out
          </button>
        </div>
      </div>

      <div className="content">
        {winnerResult && <WinnerBanner result={winnerResult} />}

        <div className="participant-tabs">
          {[
            { id: 'teams',       label: 'My Teams' },
            { id: 'leaderboard', label: 'Leaderboard' },
            { id: 'fixtures',    label: 'Fixtures' },
            { id: 'groups',      label: 'Group Tables' },
          ].map(t => (
            <button
              key={t.id}
              className={`participant-tab${participantTab === t.id ? ' participant-tab--active' : ''}`}
              onClick={() => setParticipantTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {participantTab === 'teams' && (
          <div className="my-teams-box">
            <div className="my-teams-title">Your Teams</div>
            {myTeams ? (
              <>
                <div className="my-teams-row">
                  {myTeams.map(tid => {
                    const t   = getTeam(tid);
                    const s   = teamStatus[tid] || 'active';
                    const pts = computeParticipantPoints([tid], allMatches);
                    return (
                      <div key={tid} className={`my-team-card my-team-card--${s}`}>
                        <div className="my-team-flag">{t?.flag}</div>
                        <div className="my-team-name">{t?.name}</div>
                        <div className="my-team-pts">{pts} pts</div>
                        {s === 'eliminated' && <div className="my-team-status">OUT</div>}
                        {s === 'champion'   && <div className="my-team-status">🏆 CHAMPION</div>}
                      </div>
                    );
                  })}
                </div>
                <p className="my-points">Total: <strong>{myPoints} pts</strong></p>
              </>
            ) : (
              <p style={{ color: '#888', fontFamily: 'Special Elite, cursive' }}>No teams assigned yet.</p>
            )}
          </div>
        )}

        {participantTab === 'leaderboard' && (
          <section className="participant-section">
            {leaderboard.length === 0 ? (
              <p style={{ color: '#888', fontFamily: 'Special Elite, cursive', padding: '2rem', textAlign: 'center' }}>
                No participants yet.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr><th>#</th><th>Name</th><th>Teams</th><th>Points</th></tr>
                  </thead>
                  <tbody>
                    {leaderboard.map(({ name, i, tids, pts }, rank) => (
                      <tr key={i} className={
                        i === myIndex ? 'my-row'    :
                        rank === 0    ? 'lb-rank-1' :
                        rank === 1    ? 'lb-rank-2' :
                        rank === 2    ? 'lb-rank-3' : ''
                      }>
                        <td style={{ fontFamily: 'Oswald,sans-serif', fontWeight: 700, color: 'var(--green)', fontSize: '.88rem', width: '2.5rem' }}>
                          {rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank + 1}
                        </td>
                        <td style={{ fontFamily: 'Special Elite,cursive', fontSize: '.95rem', whiteSpace: 'nowrap' }}>
                          {name}{i === myIndex ? ' 👈' : ''}
                        </td>
                        <td>{tids.map(tid => <TeamPill key={tid} tid={tid} status={teamStatus[tid] || 'active'} />)}</td>
                        <td className="pts-cell">{pts}<span className="pts-label">pts</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {participantTab === 'fixtures' && (
          <section className="participant-section">
            <Fixtures
              allMatches={allMatches}
              assignments={assignments}
              participants={participants}
              lastUpdated={lastUpdated}
              myTeamIds={new Set(myTeams || [])}
            />
          </section>
        )}

        {participantTab === 'groups' && (
          <section className="participant-section">
            <GroupTable standings={standings} assignments={assignments} participants={participants} />
            {lastUpdated && (
              <div className="last-updated">Last updated: {lastUpdated.toLocaleTimeString('en-GB')}</div>
            )}
          </section>
        )}
      </div>

      <div className="footer">
        ⚽ &nbsp; FIFA World Cup 2026 &nbsp;·&nbsp; USA, Canada &amp; Mexico &nbsp;·&nbsp; June–July 2026 &nbsp; ⚽
        <br />
        <button className="admin-link" style={{ marginTop: '.5rem' }} onClick={() => setAdminMode(true)}>
          Admin
        </button>
      </div>
    </div>
  );
}
