import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TEAMS, DEMO_NAMES } from './data.js';
import { shuffle, getTeam, fmt, playThwack, findTeamId, getLoserTeamId, getWinnerTeamId, isLive } from './utils.js';
import { fetchTodaysMatches, fetchAllMatches, fetchStandings, fetchNextMatch } from './api.js';

import Confetti     from './components/Confetti.jsx';
import PaniniCard   from './components/PaniniCard.jsx';
import TeamPill     from './components/TeamPill.jsx';
import Ticker       from './components/Ticker.jsx';
import Fixtures     from './components/Fixtures.jsx';
import ToastContainer from './components/Toast.jsx';

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
  const [tab, setTab] = useState('setup');
  const [participants, setParticipants] = useState([...DEMO_NAMES]);
  const [assignments, setAssignments] = useState(null);
  const [teamStatus, setTeamStatus] = useState({});
  const [buyIn, setBuyIn] = useState('5');
  const [drawing, setDrawing] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [query, setQuery] = useState('');
  const [confetti, setConfetti] = useState(false);
  const [dupIds, setDupIds] = useState([]);
  const [copied, setCopied] = useState(false);

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

  useEffect(() => { todayRef.current   = todaysMatches;  }, [todaysMatches]);
  useEffect(() => { statusRef.current  = teamStatus;     }, [teamStatus]);
  useEffect(() => { assignRef.current  = assignments;    }, [assignments]);
  useEffect(() => { partRef.current    = participants;   }, [participants]);

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

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Draw ──────────────────────────────────────────────────────
  const doDraw = useCallback(() => {
    if (drawing) return;
    const ids = TEAMS.map(t => t.id);
    const shuffled = shuffle(ids);
    // Duplicate 2 randomly chosen teams → 50 tickets for 50 participants
    let d1 = shuffled[Math.floor(Math.random() * 48)];
    let d2 = shuffled[Math.floor(Math.random() * 47)];
    if (d2 === d1) d2 = shuffled[(shuffled.indexOf(d1) + 1) % 48];
    const tickets = shuffle([...shuffled, d1, d2]);

    const ass = {};
    participants.forEach((_, i) => { ass[i] = [tickets[i]]; });

    setDupIds([d1, d2]);
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
      if (c >= participants.length) {
        clearInterval(drawRef.current);
        setDrawing(false);
        setConfetti(true);
        setTimeout(() => setConfetti(false), 8000);
      }
    }, 160);
  }, [drawing, participants]);

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
              <h2 className="sec-hdr" style={{ margin: 0, border: 'none' }}>
                Participants &nbsp;
                <span style={{ color: 'var(--ink)', fontWeight: 400, fontSize: '1rem' }}>({participants.length})</span>
              </h2>
              <button className="btn-outline" onClick={() => setParticipants([...DEMO_NAMES])}>
                Load Demo Names
              </button>
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
                    <strong>⚠ Shared teams</strong> (2 participants each): &nbsp;
                    {dupIds.map(id => { const t = getTeam(id); return `${t.flag} ${t.name}`; }).join(' & ')}
                  </div>
                )}

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

            {assignments ? (
              <>
                <h3 className="sec-hdr">Current Standings</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl">
                    <thead>
                      <tr><th>Participant</th><th>Team(s)</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {sortedParticipants.map(({ n, i, tids, best }) => (
                        <tr key={i}>
                          <td style={{ fontFamily: 'Special Elite,cursive', whiteSpace: 'nowrap' }}>{n}</td>
                          <td>{tids.map(tid => <TeamPill key={tid} tid={tid} status={teamStatus[tid] || 'active'} />)}</td>
                          <td>
                            <span className={`badge ${best === 'active' ? 'b-active' : best === 'eliminated' ? 'b-elim' : 'b-champ'}`}>
                              {best === 'active' ? 'Active' : best === 'eliminated' ? 'Eliminated' : '🏆 Champion'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'Special Elite,cursive', color: '#888', fontSize: '1rem' }}>
                Complete the draw first to see standings.
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
