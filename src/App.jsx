import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TEAMS, getDemoNames } from './data.js';
import { shuffle, getTeam, fmt, playThwack, findTeamId, getLoserTeamId, getWinnerTeamId, isLive, computeTeamProgress, PROGRESS_LABELS, computeParticipantPoints, formatRoundLabel } from './utils.js';
import { fetchTodaysMatches, fetchAllMatches, fetchStandings, fetchNextMatch } from './api.js';
import { sendDrawEmail, sendAdvanceEmail, sendFinalEmail } from './email.js';
import supabase, { loadSweepstake, saveSweepstake } from './supabase.js';

import Confetti     from './components/Confetti.jsx';
import PaniniCard   from './components/PaniniCard.jsx';
import TeamPill     from './components/TeamPill.jsx';
import Ticker       from './components/Ticker.jsx';
import Fixtures     from './components/Fixtures.jsx';
import GroupTable   from './components/GroupTable.jsx';
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

// ── Helpers ──────────────────────────────────────────────────────
function stripColor(group) {
  const hues = { A:0,B:25,C:200,D:120,E:280,F:45,G:160,H:330,I:60,J:190,K:310,L:85 };
  return `hsl(${hues[group] ?? 0},55%,32%)`;
}

const KNOCKOUT_STAGES = ['LAST_32','LAST_16','QUARTER_FINALS','SEMI_FINALS','THIRD_PLACE','FINAL'];

// ── Auto-elimination computation ─────────────────────────────────
function computeEliminations(allMatches, standings, assignments, participants, prevStatus) {
  if (!assignments) return { newStatus: prevStatus, toasts: [] };

  const newStatus = { ...prevStatus };
  const toasts = [];

  function markEliminated(teamId) {
    if (newStatus[teamId] === 'eliminated' || newStatus[teamId] === 'champion') return;
    newStatus[teamId] = 'eliminated';

    // Find all participants who own this team
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

  // 1. Group stage — eliminate teams in positions 3+ when group is complete
  if (standings?.length) {
    standings.forEach(grp => {
      if (grp.type !== 'TOTAL') return;
      const table = grp.table || [];
      // Group complete when all teams have played 3 games
      const allPlayed3 = table.length === 4 && table.every(r => r.playedGames >= 3);
      if (allPlayed3) {
        table.slice(2).forEach(row => {
          const tid = findTeamId(row.team);
          if (tid) markEliminated(tid);
        });
      }
    });
  }

  // 2. Knockout rounds — losers of FINISHED matches
  if (allMatches?.length) {
    allMatches.filter(m => m.status === 'FINISHED' && KNOCKOUT_STAGES.includes(m.stage))
      .forEach(m => {
        const loserId = getLoserTeamId(m);
        if (loserId) markEliminated(loserId);

        // Champion = winner of the Final
        if (m.stage === 'FINAL') {
          const winnerId = getWinnerTeamId(m);
          if (winnerId) markChampion(winnerId);
        }
      });
  }

  return { newStatus, toasts };
}

// ═════════════════════════════════════════════════════════════════
// APP
// ═════════════════════════════════════════════════════════════════
export default function App() {
  // ── Sweepstake state ──────────────────────────────────────────
  const [loading, setLoading]           = useState(true);
  const [tab, setTab]                   = useState('setup');
  const [participants, setParticipants] = useState(getDemoNames(24));
  const [assignments,  setAssignments]  = useState(null);
  const [teamStatus,   setTeamStatus]   = useState({});
  const [buyIn,        setBuyIn]        = useState('5');
  const [drawing,      setDrawing]      = useState(false);
  const [revealed,     setRevealed]     = useState(0);
  const [query,        setQuery]        = useState('');
  const [confetti,     setConfetti]     = useState(false);
  const [dupIds,       setDupIds]       = useState([]);
  const [participantEmails, setParticipantEmails] = useState(Array(24).fill(''));
  const [copied,       setCopied]       = useState(false);
  const [winnerResult, setWinnerResult] = useState(null);

  // ── API state ─────────────────────────────────────────────────
  const [todaysMatches, setTodaysMatches] = useState([]);
  const [allMatches, setAllMatches]       = useState([]);
  const [standings, setStandings]         = useState([]);
  const [nextMatch, setNextMatch]         = useState(null);
  const [apiError, setApiError]           = useState(null);
  const [tickerLoading, setTickerLoading] = useState(false);
  const [lastUpdated, setLastUpdated]     = useState(null);
  const [toasts, setToasts]               = useState([]);

  // Refs to avoid stale closure issues in polling callbacks
  const drawRef     = useRef(null);
  const todayRef    = useRef(todaysMatches);
  const statusRef   = useRef(teamStatus);
  const assignRef   = useRef(assignments);
  const partRef     = useRef(participants);
  const pollRef     = useRef(null);
  const emailedMatchIdsRef = useRef(new Set());
  const saveTimerRef       = useRef(null);

  useEffect(() => { todayRef.current   = todaysMatches;  }, [todaysMatches]);
  useEffect(() => { statusRef.current  = teamStatus;     }, [teamStatus]);
  useEffect(() => { assignRef.current  = assignments;    }, [assignments]);
  useEffect(() => { partRef.current    = participants;   }, [participants]);

  // ── Load from Supabase on first open ─────────────────────────
  useEffect(() => {
    loadSweepstake().then(data => {
      if (data) {
        const names = data.participants ?? getDemoNames(24);
        setParticipants(names);
        setAssignments(data.assignments ?? null);
        setTeamStatus(data.team_status ?? {});
        setBuyIn(data.buy_in ?? '5');
        setDupIds(data.dup_ids ?? []);
        setParticipantEmails(data.participant_emails ?? Array(names.length).fill(''));
        if (data.assignments) setRevealed(Object.keys(data.assignments).length);
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
        buy_in: buyIn,
        dup_ids: dupIds,
        participant_emails: participantEmails,
      });
    }, 1000);
  }, [participants, assignments, teamStatus, buyIn, dupIds, participantEmails, loading]);

  // ── Real-time sync: update all open tabs when DB changes ──────
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
          setBuyIn(row.buy_in ?? '5');
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

    // Fetch "next match" if no matches today
    const todayMatches = todayRes.status === 'fulfilled' ? (todayRes.value.data?.matches || []) : [];
    if (todayMatches.length === 0) {
      try {
        const nextRes = await fetchNextMatch();
        const nm = nextRes.data?.matches?.[0] || null;
        setNextMatch(nm);
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

  // Initial load + start polling
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

  // ── Advancement email notifications ───────────────────────────
  useEffect(() => {
    if (!assignments) return;
    const KNOCKOUT = ['LAST_32','LAST_16','QUARTER_FINALS','SEMI_FINALS','FINAL'];
    allMatches
      .filter(m => m.status === 'FINISHED' && KNOCKOUT.includes(m.stage))
      .forEach(m => {
        if (emailedMatchIdsRef.current.has(m.id)) return;
        emailedMatchIdsRef.current.add(m.id);
        saveSweepstake({ emailed_match_ids: [...emailedMatchIdsRef.current] });
        const winnerId = getWinnerTeamId(m);
        if (!winnerId) return;
        const stageLabel = formatRoundLabel(m.stage, null);
        Object.entries(assignments).forEach(([idx, tids]) => {
          if (!tids.includes(winnerId)) return;
          const email = participantEmails[+idx];
          const name  = participants[+idx];
          const team  = getTeam(winnerId);
          if (email?.endsWith('@autone.io') && team) {
            sendAdvanceEmail(email, name, `${team.flag} ${team.name}`, stageLabel);
          }
        });
      });
  }, [allMatches, assignments, participants, participantEmails]);

  // ── Winner computation ────────────────────────────────────────
  useEffect(() => {
    if (!assignments) { setWinnerResult(null); return; }
    setWinnerResult(computeWinner(assignments, participants, allMatches));
  }, [allMatches, assignments, participants, teamStatus]);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Draw ──────────────────────────────────────────────────────
  const doDraw = useCallback(() => {
    if (drawing) return;
    const n = participants.filter(Boolean).length;
    if (n < 2) return;
    const totalSlots = n * 2; // always 2 teams per person
    const shuffledIds = shuffle(TEAMS.map(t => t.id));

    let pool, newDupIds = [];
    if (totalSlots <= TEAMS.length) {
      // ≤24 participants: use only 2N teams, rest sit out (no duplicates)
      pool = shuffledIds.slice(0, totalSlots);
    } else {
      // >24 participants: duplicate (2N−48) teams so everyone still gets 2
      const extraNeeded = totalSlots - TEAMS.length;
      const dupes = shuffle([...shuffledIds]).slice(0, extraNeeded);
      newDupIds = dupes;
      pool = shuffle([...shuffledIds, ...dupes]);
    }

    // Assign 2 teams per participant
    const ass = {};
    participants.forEach((_, i) => {
      ass[i] = [pool[i * 2], pool[i * 2 + 1]];
    });

    setDupIds(newDupIds);
    setAssignments(ass);
    setTeamStatus({});
    setRevealed(0);
    setDrawing(true);
    setTab('draw');

    let c = 0;
    drawRef.current = setInterval(() => {
      c++;
      setRevealed(c);
      playThwack(c);
      if (c >= n) {
        clearInterval(drawRef.current);
        setDrawing(false);
        setConfetti(true);
        setTimeout(() => setConfetti(false), 8000);
        participants.forEach((name, pi) => {
          const email = participantEmails[pi];
          if (!email || !email.endsWith('@autone.io')) return;
          const [t1, t2] = ass[pi] || [];
          const t1obj = getTeam(t1);
          const t2obj = getTeam(t2);
          sendDrawEmail(
            email, name,
            t1obj ? `${t1obj.flag} ${t1obj.name}` : '?',
            t2obj ? `${t2obj.flag} ${t2obj.name}` : '?'
          );
        });
      }
    }, 160);
  }, [drawing, participants, participantEmails]);

  const doReset = useCallback(() => {
    clearInterval(drawRef.current);
    setAssignments(null);
    setTeamStatus({});
    setRevealed(0);
    setDrawing(false);
    setDupIds([]);
    setConfetti(false);
  }, []);

  useEffect(() => () => { clearInterval(drawRef.current); clearTimeout(pollRef.current); }, []);

  // ── Status cycle (manual) ────────────────────────────────────
  const cycleStatus = useCallback((tid) => {
    setTeamStatus(prev => {
      const cur = prev[tid] || 'active';
      const nxt = cur === 'active' ? 'eliminated' : cur === 'eliminated' ? 'champion' : 'active';
      return { ...prev, [tid]: nxt };
    });
  }, []);

  // ── Prizes ────────────────────────────────────────────────────
  const pot = (parseFloat(buyIn) || 0) * participants.length;
  const prizes = [
    { label: '🥇 Winner',      pct: '50%', amt: pot * 0.50 },
    { label: '🥈 Runner-up',   pct: '25%', amt: pot * 0.25 },
    { label: '🥉 Third',       pct: '15%', amt: pot * 0.15 },
    { label: '🪵 Wooden Spoon',pct: '10%', amt: pot * 0.10 },
  ];

  // ── Export ────────────────────────────────────────────────────
  const doExport = useCallback(() => {
    if (!assignments) return;
    let txt = `WORLD CUP 2026 SWEEPSTAKE\n`;
    txt += `${new Date().toLocaleDateString('en-GB')}  |  Buy-in: ${fmt(parseFloat(buyIn) || 0)}  |  Pot: ${fmt(pot)}\n`;
    txt += '─'.repeat(52) + '\n';
    participants.forEach((n, i) => {
      const tids = assignments[i] || [];
      const teams = tids.map(tid => {
        const t = getTeam(tid);
        const s = teamStatus[tid] || 'active';
        return `${t.flag} ${t.name}${s === 'champion' ? ' 🏆' : s === 'eliminated' ? ' (OUT)' : ''}`;
      }).join(' & ');
      txt += `${String(i + 1).padStart(2, '0')}. ${n.padEnd(22)} ${teams}\n`;
    });
    txt += '─'.repeat(52) + '\n';
    prizes.forEach(p => { txt += `  ${p.label} (${p.pct}): ${fmt(p.amt)}\n`; });
    navigator.clipboard.writeText(txt)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); })
      .catch(() => alert(txt));
  }, [assignments, participants, teamStatus, buyIn, pot, prizes]);

  // ── Filtered participants for draw tab ───────────────────────
  const filtered = useMemo(() =>
    participants
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => n.toLowerCase().includes(query.toLowerCase())),
    [participants, query]
  );

  // ── Points leaderboard ───────────────────────────────────────
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

  // ── Sorted leaderboard (champion → active → eliminated) ──────
  const sortedParticipants = useMemo(() => {
    if (!assignments) return [];
    const order = { champion: 0, active: 1, eliminated: 2 };
    return participants.map((n, i) => {
      const tids = assignments[i] || [];
      const best = tids.reduce((b, tid) => {
        const s = teamStatus[tid] || 'active';
        return order[s] < order[b] ? s : b;
      }, 'eliminated');
      return { n, i, tids, best };
    }).sort((a, b) => order[a.best] - order[b.best]);
  }, [assignments, participants, teamStatus]);

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Special Elite, cursive', fontSize: '1.2rem', color: '#2D5A1B' }}>
        ⏳ Loading sweepstake…
      </div>
    );
  }

  return (
    <div>
      <Confetti active={confetti} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* TICKER */}
      <Ticker
        todaysMatches={todaysMatches}
        nextMatch={nextMatch}
        loading={tickerLoading}
        apiError={apiError}
      />

      {/* API error banner */}
      {apiError && (
        <div className="api-banner">
          ⚠ {apiError}
        </div>
      )}

      {/* HEADER */}
      <div className="hdr">
        <div className="hdr-title">⚽ World Cup 2026 ⚽</div>
        <div className="hdr-title" style={{ fontSize: 'clamp(1.2rem,3.5vw,2.2rem)', marginTop: '.1rem' }}>
          Company Sweepstake
        </div>
        <div className="hdr-sub">USA · Canada · Mexico — June–July 2026</div>
      </div>

      {/* TABS */}
      <div className="tabs">
        {[
          { id: 'setup',    label: '👥 Setup' },
          { id: 'draw',     label: '🎲 Draw' },
          { id: 'fixtures', label: '📅 Fixtures' },
          { id: 'groups',   label: '🏟 Groups' },
          { id: 'prizes',   label: '💰 Prizes' },
        ].map(t => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="content">

        {/* ══════════════ SETUP ══════════════ */}
        {tab === 'setup' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1rem' }}>
              <h2 className="sec-hdr" style={{ margin: 0, border: 'none' }}>Participants</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                <button className="count-btn" onClick={() => { setParticipants(p => p.length > 2 ? p.slice(0, -1) : p); setParticipantEmails(p => p.length > 2 ? p.slice(0, -1) : p); }}>−</button>
                <span className="count-display">{participants.length}</span>
                <button className="count-btn" onClick={() => { setParticipants(p => [...p, '']); setParticipantEmails(p => [...p, '']); }}>+</button>
                <button className="btn-outline" onClick={() => setParticipants(getDemoNames(participants.length))}>
                  Load Demo Names
                </button>
              </div>
            </div>
            <div style={{ fontFamily: 'Special Elite,cursive', fontSize: '.82rem', color: '#888', marginBottom: '.75rem' }}>
              Each person gets <strong>2 teams</strong> · {participants.length <= 24
                ? `${48 - participants.length * 2} teams will sit out`
                : `${participants.length * 2 - 48} team${participants.length * 2 - 48 > 1 ? 's' : ''} shared between 2 people`}
            </div>

            <div className="rbox" data-label="PARTICIPANT LIST" style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: '.2rem' }}>
                {participants.map((n, i) => (
                  <div key={i} className="p-row">
                    <span className="p-num">{i + 1}.</span>
                    <input
                      className="inp"
                      value={n}
                      onChange={e => {
                        const next = [...participants];
                        next[i] = e.target.value;
                        setParticipants(next);
                      }}
                      placeholder={`Participant ${i + 1}`}
                      style={{ fontSize: '.85rem', padding: '.28rem .5rem' }}
                    />
                    <input
                      className="inp inp-email"
                      type="email"
                      value={participantEmails[i] || ''}
                      onChange={e => {
                        const next = [...participantEmails];
                        next[i] = e.target.value;
                        setParticipantEmails(next);
                      }}
                      placeholder="name@autone.io"
                    />
                    <button
                      className="remove-btn"
                      onClick={() => {
                        setParticipants(p => p.filter((_, idx) => idx !== i));
                        setParticipantEmails(p => p.filter((_, idx) => idx !== i));
                      }}
                      disabled={participants.length <= 2}
                    >×</button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <button className="draw-btn" onClick={doDraw} disabled={drawing}>
                {drawing ? '⏳ Drawing…' : '🎲 Start The Draw!'}
              </button>
            </div>

            <h2 className="sec-hdr">All 48 Teams</h2>
            <div className="grid">
              {TEAMS.map(t => (
                <div key={t.id} className="card">
                  <div className="card-strip" style={{ background: stripColor(t.group) }}>
                    <span style={{ fontFamily: 'Oswald,sans-serif', fontSize: '.6rem', fontWeight: 700, color: '#fff', letterSpacing: '.1em' }}>
                      GRP {t.group}
                    </span>
                  </div>
                  <div className="card-flag">{t.flag}</div>
                  <div className="card-name">{t.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════ DRAW ══════════════ */}
        {tab === 'draw' && (
          <div>
            {!assignments ? (
              <div style={{ textAlign: 'center', padding: '5rem 1rem' }}>
                <p style={{ fontFamily: 'Special Elite,cursive', fontSize: '1.15rem', marginBottom: '2rem', color: 'var(--ink)', lineHeight: 1.7 }}>
                  All {participants.length} participants are ready.<br />Click the button to begin the draw!
                </p>
                <button className="draw-btn" onClick={doDraw} disabled={drawing}>
                  🎲 DRAW!
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.65rem', marginBottom: '1rem' }}>
                  <h2 className="sec-hdr" style={{ margin: 0, border: 'none' }}>Draw Results</h2>
                  {!drawing && (
                    <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
                      <button className="btn-green" onClick={doExport}>
                        {copied ? '✓ Copied!' : '📋 Copy Results'}
                      </button>
                      <button className="btn-outline" onClick={doReset}>↺ Reset Draw</button>
                    </div>
                  )}
                </div>

                {drawing && (
                  <div style={{ marginBottom: '1.25rem' }}>
                    <div className="announce" style={{ marginBottom: '.4rem' }}>
                      Drawing… {revealed} / {participants.length}
                    </div>
                    <div className="prog">
                      <div className="prog-bar" style={{ width: `${(revealed / participants.length) * 100}%` }} />
                    </div>
                  </div>
                )}

                {!drawing && revealed >= participants.length && (
                  <div style={{ textAlign: 'center', marginBottom: '1.25rem', padding: '.75rem', background: 'var(--green)', borderRadius: '5px', border: '3px solid var(--ink)' }}>
                    <span className="announce">🎉 Draw Complete! Good luck everyone! 🎉</span>
                  </div>
                )}

                {dupIds.length > 0 && (
                  <div style={{ marginBottom: '.9rem', padding: '.45rem .9rem', background: 'rgba(200,151,28,.15)', border: '2px solid var(--gold)', borderRadius: '4px', fontSize: '.83rem', fontFamily: 'Courier Prime,monospace' }}>
                    <strong>⚠ {dupIds.length} team{dupIds.length > 1 ? 's' : ''} shared</strong> (2 participants each):&nbsp;
                    {dupIds.map(id => { const t = getTeam(id); return `${t.flag} ${t.name}`; }).join(', ')}
                  </div>
                )}

                {/* Winner banner */}
                {winnerResult && <WinnerBanner result={winnerResult} />}

                {/* Search */}
                <div style={{ position: 'relative', maxWidth: '300px', marginBottom: '1rem' }}>
                  <span style={{ position: 'absolute', left: '.65rem', top: '50%', transform: 'translateY(-50%)', fontSize: '.85rem', pointerEvents: 'none' }}>🔍</span>
                  <input className="inp" style={{ paddingLeft: '2.1rem' }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search participant…" />
                </div>

                {/* Table — uses sortedParticipants once draw is done */}
                <div style={{ overflowX: 'auto', marginBottom: '1.75rem' }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Participant</th>
                        <th>Team(s)</th>
                        <th>Status</th>
                        <th>Update</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(query ? filtered : sortedParticipants.map(r => ({ n: r.n, i: r.i }))).map(({ n, i }) => {
                        if (i >= revealed) return null;
                        const tids = assignments[i] || [];
                        return (
                          <tr key={i} className={
                            tids.every(tid => (teamStatus[tid] || 'active') === 'eliminated') ? 'row-elim' :
                            tids.some(tid => teamStatus[tid] === 'champion') ? 'row-champ' : ''
                          }>
                            <td style={{ fontFamily: 'Oswald,sans-serif', fontWeight: 700, color: 'var(--green)', fontSize: '.88rem', width: '2.5rem' }}>{i + 1}</td>
                            <td style={{ fontFamily: 'Special Elite,cursive', fontSize: '.95rem', whiteSpace: 'nowrap' }}>{n}</td>
                            <td>{tids.map(tid => <TeamPill key={tid} tid={tid} status={teamStatus[tid] || 'active'} />)}</td>
                            <td>
                              {tids.map(tid => {
                                const s = teamStatus[tid] || 'active';
                                return (
                                  <span key={tid} className={`badge ${s === 'active' ? 'b-active' : s === 'eliminated' ? 'b-elim' : 'b-champ'}`} style={{ marginRight: 3 }}>
                                    {s === 'active' ? 'Active' : s === 'eliminated' ? 'Out' : 'Champion'}
                                  </span>
                                );
                              })}
                            </td>
                            <td>
                              {tids.map(tid => {
                                const t = getTeam(tid);
                                const s = teamStatus[tid] || 'active';
                                const lbl = s === 'active' ? '→ Elim' : s === 'eliminated' ? '→ Champ' : '→ Active';
                                return (
                                  <button key={tid} className="cycle-btn" onClick={() => cycleStatus(tid)} title="Click to cycle status">
                                    {t.flag} {lbl}
                                  </button>
                                );
                              })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {lastUpdated && (
                  <div className="last-updated">Last updated: {lastUpdated.toLocaleTimeString('en-GB')}</div>
                )}

                {/* Sticker grid */}
                {revealed > 0 && (
                  <>
                    <h3 className="sec-hdr">Sticker Album</h3>
                    <div className="grid">
                      {participants.map((n, i) => {
                        if (i >= revealed) return null;
                        return (assignments[i] || []).map(tid => (
                          <PaniniCard
                            key={`${i}-${tid}`}
                            tid={tid}
                            status={teamStatus[tid] || 'active'}
                            owner={n}
                            idx={i}
                            animated
                            onCycleStatus={cycleStatus}
                          />
                        ));
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════════ FIXTURES ══════════════ */}
        {tab === 'fixtures' && (
          <div>
            <h2 className="sec-hdr">Tournament Fixtures</h2>
            <Fixtures
              allMatches={allMatches}
              assignments={assignments}
              participants={participants}
              lastUpdated={lastUpdated}
            />
          </div>
        )}

        {/* ══════════════ GROUPS ══════════════ */}
        {tab === 'groups' && (
          <div>
            <h2 className="sec-hdr">Group Standings</h2>
            <GroupTable standings={standings} assignments={assignments} participants={participants} />
            {lastUpdated && (
              <div className="last-updated">Last updated: {lastUpdated.toLocaleTimeString('en-GB')}</div>
            )}
          </div>
        )}

        {/* ══════════════ PRIZES ══════════════ */}
        {tab === 'prizes' && (
          <div>
            <h2 className="sec-hdr">Prize Pot Calculator</h2>

            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
              <div className="rbox" data-label="BUY-IN" style={{ flex: '1 1 220px', minWidth: '200px' }}>
                <label style={{ fontFamily: 'Oswald,sans-serif', fontSize: '.8rem', fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.4rem' }}>
                  Buy-in per person
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                  <span style={{ fontFamily: 'Oswald,sans-serif', fontSize: '1.2rem', fontWeight: 700 }}>£</span>
                  <input className="inp" type="number" min="0" step="0.5" value={buyIn} onChange={e => setBuyIn(e.target.value)} style={{ width: '110px' }} />
                </div>
                <div style={{ marginTop: '.75rem', fontFamily: 'Courier Prime,monospace', fontSize: '.85rem' }}>
                  <span style={{ fontFamily: 'Oswald,sans-serif', fontWeight: 600, fontSize: '.8rem', letterSpacing: '.08em', textTransform: 'uppercase' }}>Participants:</span> {participants.length}
                </div>
              </div>

              <div style={{ flex: '1 1 220px', minWidth: '200px', background: 'var(--green)', border: '4px solid var(--ink)', borderRadius: '6px', padding: '1.25rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontFamily: 'Oswald,sans-serif', fontSize: '.85rem', fontWeight: 600, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--parchment)', marginBottom: '.35rem' }}>
                  Total Prize Pot
                </div>
                <div className="pot-num">{fmt(pot)}</div>
              </div>
            </div>

            <h3 className="sec-hdr">Prize Splits</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {prizes.map((p, i) => (
                <div key={i} className="rbox" style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: 'Special Elite,cursive', fontSize: '1rem', marginBottom: '.5rem' }}>{p.label}</div>
                  <div style={{ fontFamily: 'Oswald,sans-serif', fontSize: '.75rem', fontWeight: 600, color: '#888', letterSpacing: '.1em', marginBottom: '.35rem' }}>{p.pct} of pot</div>
                  <div className="scoreboard">{fmt(p.amt)}</div>
                </div>
              ))}
            </div>

            <div className="divider">⚽</div>

            {winnerResult && <WinnerBanner result={winnerResult} />}

            {assignments && (
              <div style={{ textAlign: 'center', margin: '1rem 0' }}>
                <button
                  className="btn-outline"
                  disabled={!participants.some((_, i) => participantEmails[i]?.endsWith('@autone.io'))}
                  onClick={() => {
                    const winnerName = winnerResult?.winner?.name ?? 'TBD';
                    const lbText = leaderboard
                      .map((row, rank) => `${rank + 1}. ${row.name} — ${row.pts} pts`)
                      .join('\n');
                    participants.forEach((name, i) => {
                      const email = participantEmails[i];
                      if (!email?.endsWith('@autone.io')) return;
                      sendFinalEmail(email, name, winnerName, lbText);
                    });
                  }}
                >
                  📧 Email Final Results to All
                </button>
              </div>
            )}

            {assignments ? (
              <>
                <h3 className="sec-hdr">Points Leaderboard</h3>
                <div style={{ fontFamily: 'Special Elite,cursive', fontSize: '.82rem', color: '#888', marginBottom: '.75rem' }}>
                  Points awarded per round reached — Group Stage=1 · R32=3 · R16=6 · QF=10 · SF=15 · 3rd=20 · Final=25 · Champion=40
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl">
                    <thead>
                      <tr><th>#</th><th>Participant</th><th>Team(s)</th><th>Points</th></tr>
                    </thead>
                    <tbody>
                      {leaderboard.map(({ name, i, tids, pts }, rank) => (
                        <tr key={i} className={rank === 0 ? 'lb-rank-1' : rank === 1 ? 'lb-rank-2' : rank === 2 ? 'lb-rank-3' : ''}>
                          <td style={{ fontFamily: 'Oswald,sans-serif', fontWeight: 700, color: 'var(--green)', fontSize: '.88rem', width: '2.5rem' }}>
                            {rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank + 1}
                          </td>
                          <td style={{ fontFamily: 'Special Elite,cursive', fontSize: '.95rem', whiteSpace: 'nowrap' }}>{name}</td>
                          <td>{tids.map(tid => <TeamPill key={tid} tid={tid} status={teamStatus[tid] || 'active'} />)}</td>
                          <td className="pts-cell">{pts}<span className="pts-label">pts</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'Special Elite,cursive', color: '#888', fontSize: '1rem' }}>
                Complete the draw first to see the leaderboard.
              </div>
            )}

            {lastUpdated && (
              <div className="last-updated">Last updated: {lastUpdated.toLocaleTimeString('en-GB')}</div>
            )}
          </div>
        )}
      </div>

      <div className="footer">
        ⚽ &nbsp; FIFA World Cup 2026 &nbsp;·&nbsp; USA, Canada &amp; Mexico &nbsp;·&nbsp; June–July 2026 &nbsp; ⚽
      </div>
    </div>
  );
}
