import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TEAMS } from './data.js';
import { shuffle, getTeam, findTeamId, getLoserTeamId, getWinnerTeamId, isLive, computeTeamProgress, PROGRESS_LABELS, computeParticipantPoints, formatRoundLabel, getWcRank } from './utils.js';
import { fetchTodaysMatches, fetchAllMatches, fetchStandings, fetchNextMatch } from './api.js';
import { sendDrawEmail } from './email.js';
import { loadAllGames, loadSweepstake, saveSweepstake, createGame, deleteGame } from './supabase.js';

import TeamPill       from './components/TeamPill.jsx';
import Ticker         from './components/Ticker.jsx';
import Fixtures       from './components/Fixtures.jsx';
import GroupTable     from './components/GroupTable.jsx';
import HowItWorks    from './components/HowItWorks.jsx';
import ToastContainer from './components/Toast.jsx';

// ── computeWinner ─────────────────────────────────────────────────
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

// ── Team assignment: assigns N teams per person ───────────────────
function assignTeamsForNewSignup(currentAssignments, currentDupIds, teamsPerPerson = 2) {
  const allIds = TEAMS.map(t => t.id);
  const taken  = new Set(Object.values(currentAssignments).flat());
  let free     = shuffle(allIds.filter(id => !taken.has(id)));
  const newDupIds = [...currentDupIds];
  const teams = [];
  const usedInDraw = new Set();

  for (let i = 0; i < teamsPerPerson; i++) {
    if (free.length > 0) {
      const t = free.shift();
      teams.push(t);
      usedInDraw.add(t);
    } else {
      const candidates = shuffle(allIds).filter(t => !usedInDraw.has(t));
      const t = candidates.length > 0 ? candidates[0] : allIds[0];
      teams.push(t);
      usedInDraw.add(t);
      if (!newDupIds.includes(t)) newDupIds.push(t);
    }
  }

  return { teams, newDupIds };
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
  const [myEmail,            setMyEmail]            = useState('');
  const [signupMode,         setSignupMode]         = useState('signup');
  const [signupName,         setSignupName]         = useState('');
  const [signupEmail,        setSignupEmail]        = useState('');
  const [signupCode,         setSignupCode]         = useState('');
  const [signupError,        setSignupError]        = useState('');
  const [participantTab,     setParticipantTab]     = useState('teams');

  // ── Multi-game state ──────────────────────────────────────────
  const [allGames,           setAllGames]           = useState([]);
  const [currentGameCode,    setCurrentGameCode]    = useState(null);
  const [teamsPerPerson,     setTeamsPerPerson]     = useState(2);
  const [myGames,            setMyGames]            = useState([]);
  const [showGamePicker,     setShowGamePicker]     = useState(false);

  // ── Admin state ───────────────────────────────────────────────
  const [adminMode,          setAdminMode]          = useState(false);
  const [adminAuthed,        setAdminAuthed]        = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminError,         setAdminError]         = useState('');
  const [adminView,          setAdminView]          = useState('games'); // 'games'|'create'|'detail'
  const [adminSelectedGame,  setAdminSelectedGame]  = useState(null);
  const [adminGameData,      setAdminGameData]      = useState(null);
  const [newGameCode,        setNewGameCode]        = useState('');
  const [newGameTeams,       setNewGameTeams]       = useState(2);
  const [createGameError,    setCreateGameError]    = useState('');

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

  // ── Init: load all games, auto-restore session if saved ──────
  useEffect(() => {
    async function init() {
      const games = await loadAllGames();
      setAllGames(games);

      const savedEmail = localStorage.getItem('wc2026_myemail') || '';
      const savedCode  = localStorage.getItem('wc2026_gamecode') || '';

      if (savedEmail && savedCode) {
        const game = games.find(g => g.id === savedCode);
        if (game) {
          const data = await loadSweepstake(savedCode);
          if (data) {
            const names = data.participants ?? [];
            setParticipants(names);
            setAssignments(data.assignments ?? null);
            setTeamStatus(data.team_status ?? {});
            setDupIds(data.dup_ids ?? []);
            setParticipantEmails(data.participant_emails ?? Array(names.length).fill(''));
            setTeamsPerPerson(data.teams_per_person ?? 2);
            emailedMatchIdsRef.current = new Set(data.emailed_match_ids ?? []);
            setCurrentGameCode(savedCode);
            setMyEmail(savedEmail);
          }
        }
      }

      setLoading(false);
    }
    init();
  }, []);

  // ── Save to Supabase (debounced 1 second) ─────────────────────
  useEffect(() => {
    clearTimeout(saveTimerRef.current);
    if (loading || !currentGameCode) return;
    saveTimerRef.current = setTimeout(() => {
      saveSweepstake(currentGameCode, {
        participants,
        assignments,
        team_status: teamStatus,
        dup_ids: dupIds,
        participant_emails: participantEmails,
        teams_per_person: teamsPerPerson,
      });
    }, 1000);
  }, [participants, assignments, teamStatus, dupIds, participantEmails, loading, currentGameCode, teamsPerPerson]);

  // ── Poll for game updates every 5 seconds ────────────────────
  useEffect(() => {
    if (!currentGameCode) return;
    const id = setInterval(async () => {
      const data = await loadSweepstake(currentGameCode);
      if (data) {
        setParticipants(data.participants ?? []);
        setAssignments(data.assignments ?? null);
        setTeamStatus(data.team_status ?? {});
        setDupIds(data.dup_ids ?? []);
        setParticipantEmails(data.participant_emails ?? []);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [currentGameCode]);

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
  const handleSignup = useCallback(async () => {
    const code  = signupCode.trim().toUpperCase();
    const name  = signupName.trim();
    const email = signupEmail.trim().toLowerCase();

    if (!code)                         { setSignupError('Please enter a game code.'); return; }
    if (!name)                         { setSignupError('Please enter your name.'); return; }
    const game = allGames.find(g => g.id.toUpperCase() === code);
    if (!game) { setSignupError('Game code not found. Check with your admin.'); return; }

    const data = await loadSweepstake(game.id);
    const currentParticipants = data?.participants ?? [];
    const currentEmails       = data?.participant_emails ?? [];
    const currentAssignments  = data?.assignments ?? {};
    const currentDupIds       = data?.dup_ids ?? [];
    const currentStatus       = data?.team_status ?? {};
    const tpp = data?.teams_per_person ?? game.teams_per_person ?? 2;

    if (currentEmails.includes(email)) {
      // Already in this game — just sign in
      setParticipants(currentParticipants);
      setAssignments(currentAssignments);
      setTeamStatus(currentStatus);
      setDupIds(currentDupIds);
      setParticipantEmails(currentEmails);
      setTeamsPerPerson(tpp);
      emailedMatchIdsRef.current = new Set(data?.emailed_match_ids ?? []);
      setCurrentGameCode(game.id);
      localStorage.setItem('wc2026_myemail', email);
      localStorage.setItem('wc2026_gamecode', game.id);
      setMyEmail(email);
      setSignupError('');
      return;
    }

    const newIdx = currentParticipants.length;
    const { teams, newDupIds } = assignTeamsForNewSignup(currentAssignments, currentDupIds, tpp);
    const newParticipants = [...currentParticipants, name];
    const newEmails       = [...currentEmails, email];
    const newAssignments  = { ...currentAssignments, [newIdx]: teams };

    setTeamsPerPerson(tpp);

    localStorage.setItem('wc2026_myemail', email);
    setMyEmail(email);
    setSignupError('');

    const saveErr = await saveSweepstake(game.id, {
      participants: newParticipants,
      participant_emails: newEmails,
      assignments: newAssignments,
      dup_ids: newDupIds,
      team_status: currentStatus,
      teams_per_person: tpp,
    });

    if (saveErr) {
      setSignupError('Save failed — please try again.');
      localStorage.removeItem('wc2026_myemail');
      setMyEmail('');
      return;
    }

    clearTimeout(saveTimerRef.current);

    const freshData = await loadSweepstake(game.id);
    let finalTeamNames = teams.map(tid => { const t = getTeam(tid); return t ? `${t.flag} ${t.name}` : '?'; });

    if (freshData && !(freshData.participant_emails ?? []).includes(email)) {
      // Concurrent write race — our save was overwritten; retry on the fresh snapshot
      const fp = freshData.participants ?? [];
      const fe = freshData.participant_emails ?? [];
      const fa = freshData.assignments ?? {};
      const fd = freshData.dup_ids ?? [];
      const retryIdx = fp.length;
      const { teams: rt, newDupIds: rd } = assignTeamsForNewSignup(fa, fd, tpp);
      finalTeamNames = rt.map(tid => { const t = getTeam(tid); return t ? `${t.flag} ${t.name}` : '?'; });
      await saveSweepstake(game.id, {
        participants: [...fp, name],
        participant_emails: [...fe, email],
        assignments: { ...fa, [retryIdx]: rt },
        dup_ids: rd,
        team_status: freshData.team_status ?? {},
        teams_per_person: tpp,
      });
      clearTimeout(saveTimerRef.current);
      setParticipants([...fp, name]);
      setParticipantEmails([...fe, email]);
      setAssignments({ ...fa, [retryIdx]: rt });
      setDupIds(rd);
      setTeamStatus(freshData.team_status ?? {});
    } else if (freshData) {
      setParticipants(freshData.participants ?? []);
      setParticipantEmails(freshData.participant_emails ?? []);
      setAssignments(freshData.assignments ?? null);
      setDupIds(freshData.dup_ids ?? []);
      setTeamStatus(freshData.team_status ?? {});
    } else {
      // Could not reload after save (network issue) — use computed data, save succeeded
      setParticipants(newParticipants);
      setParticipantEmails(newEmails);
      setAssignments(newAssignments);
      setDupIds(newDupIds);
      setTeamStatus(currentStatus);
    }

    // Set currentGameCode only after state is correctly loaded — prevents the debounced
    // save from firing with empty state (which would wipe all participant data from the DB).
    setCurrentGameCode(game.id);
    localStorage.setItem('wc2026_gamecode', game.id);

    sendDrawEmail(email, name, finalTeamNames[0] || '?', finalTeamNames[1] || '?');
    loadAllGames().then(setAllGames);
  }, [signupCode, signupName, signupEmail, allGames]);

  // ── Sign-in ───────────────────────────────────────────────────
  const handleSignIn = useCallback(async () => {
    const email = signupEmail.trim().toLowerCase();
    const freshGames = await loadAllGames();
    setAllGames(freshGames);
    const matching = freshGames.filter(g => (g.participant_emails || []).includes(email));

    if (matching.length === 0) {
      setSignupError('No account found. Sign up with a game code first.');
      return;
    }

    if (matching.length === 1) {
      const game = matching[0];
      const data = await loadSweepstake(game.id);
      if (data) {
        const names = data.participants ?? [];
        setParticipants(names);
        setAssignments(data.assignments ?? null);
        setTeamStatus(data.team_status ?? {});
        setDupIds(data.dup_ids ?? []);
        setParticipantEmails(data.participant_emails ?? Array(names.length).fill(''));
        setTeamsPerPerson(data.teams_per_person ?? 2);
        emailedMatchIdsRef.current = new Set(data.emailed_match_ids ?? []);
      }
      setCurrentGameCode(game.id);
      localStorage.setItem('wc2026_myemail', email);
      localStorage.setItem('wc2026_gamecode', game.id);
      setMyEmail(email);
      setSignupError('');
    } else {
      setMyGames(matching);
      setShowGamePicker(true);
    }
  }, [signupEmail, allGames]);

  // ── Game picker (sign-in with multiple games) ─────────────────
  const handleGamePick = useCallback(async (gameId) => {
    const email = signupEmail.trim().toLowerCase();
    const game  = allGames.find(g => g.id === gameId);
    const data  = await loadSweepstake(gameId);
    if (data) {
      const names = data.participants ?? [];
      setParticipants(names);
      setAssignments(data.assignments ?? null);
      setTeamStatus(data.team_status ?? {});
      setDupIds(data.dup_ids ?? []);
      setParticipantEmails(data.participant_emails ?? Array(names.length).fill(''));
      setTeamsPerPerson(data.teams_per_person ?? game?.teams_per_person ?? 2);
      emailedMatchIdsRef.current = new Set(data.emailed_match_ids ?? []);
    }
    setCurrentGameCode(gameId);
    localStorage.setItem('wc2026_myemail', email);
    localStorage.setItem('wc2026_gamecode', gameId);
    setMyEmail(email);
    setShowGamePicker(false);
    setSignupError('');
  }, [signupEmail, allGames]);

  // ── Sign-out ──────────────────────────────────────────────────
  const handleSignOut = useCallback(() => {
    localStorage.removeItem('wc2026_myemail');
    localStorage.removeItem('wc2026_gamecode');
    setMyEmail('');
    setCurrentGameCode(null);
    setParticipants([]);
    setAssignments(null);
    setTeamStatus({});
    setDupIds([]);
    setParticipantEmails([]);
    setTeamsPerPerson(2);
    setSignupName('');
    setSignupEmail('');
    setSignupCode('');
    setSignupError('');
    setShowGamePicker(false);
    setMyGames([]);
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

  // ── Admin: create game ────────────────────────────────────────
  const handleCreateGame = useCallback(async () => {
    const code = newGameCode.trim().toUpperCase();
    if (!code)                               { setCreateGameError('Please enter a game code.'); return; }
    if (!/^[A-Z0-9]+$/.test(code))           { setCreateGameError('Code must be letters and numbers only.'); return; }
    if (allGames.some(g => g.id === code))   { setCreateGameError('That code is already in use.'); return; }

    const err = await createGame(code, newGameTeams);
    if (err) { setCreateGameError('Failed to create game. Try again.'); return; }

    const games = await loadAllGames();
    setAllGames(games);
    setNewGameCode('');
    setNewGameTeams(2);
    setCreateGameError('');
    setAdminView('games');
  }, [newGameCode, newGameTeams, allGames]);

  // ── Admin: view game detail ───────────────────────────────────
  const handleAdminViewGame = useCallback(async (gameCode) => {
    const data = await loadSweepstake(gameCode);
    setAdminGameData(data);
    setAdminSelectedGame(gameCode);
    setAdminView('detail');
  }, []);

  // ── Admin: delete game ────────────────────────────────────────
  const handleAdminDeleteGame = useCallback(async (gameCode) => {
    if (!window.confirm(`Delete game "${gameCode}"? This cannot be undone.`)) return;
    await deleteGame(gameCode);
    setAllGames(prev => prev.filter(g => g.id !== gameCode));
    if (gameCode === currentGameCode) {
      localStorage.removeItem('wc2026_myemail');
      localStorage.removeItem('wc2026_gamecode');
      setMyEmail('');
      setCurrentGameCode(null);
      setParticipants([]);
      setAssignments(null);
      setTeamStatus({});
      setDupIds([]);
      setParticipantEmails([]);
    }
  }, [currentGameCode]);

  // ── Admin: remove participant from a game ─────────────────────
  const handleAdminRemove = useCallback(async (idx) => {
    if (!adminGameData || !adminSelectedGame) return;
    const ps   = adminGameData.participants ?? [];
    const ems  = adminGameData.participant_emails ?? [];
    const asgn = adminGameData.assignments ?? {};
    const dups = adminGameData.dup_ids ?? [];

    if (!window.confirm(`Remove ${ps[idx]}? Their teams will be freed back to the pool.`)) return;

    const newPs   = ps.filter((_, i) => i !== idx);
    const newEms  = ems.filter((_, i) => i !== idx);
    const newAsgn = {};
    Object.entries(asgn).forEach(([k, v]) => {
      const oldIdx = parseInt(k);
      if (oldIdx === idx) return;
      const newIdx = oldIdx > idx ? oldIdx - 1 : oldIdx;
      newAsgn[newIdx] = v;
    });
    const remaining = Object.values(newAsgn).flat();
    const counts = {};
    remaining.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    const newDups = dups.filter(id => (counts[id] || 0) >= 2);

    const newData = {
      ...adminGameData,
      participants: newPs,
      participant_emails: newEms,
      assignments: Object.keys(newAsgn).length ? newAsgn : null,
      dup_ids: newDups,
    };
    setAdminGameData(newData);

    await saveSweepstake(adminSelectedGame, {
      participants: newPs,
      participant_emails: newEms,
      assignments: Object.keys(newAsgn).length ? newAsgn : null,
      dup_ids: newDups,
      team_status: adminGameData.team_status ?? {},
      teams_per_person: adminGameData.teams_per_person ?? 2,
    });

    loadAllGames().then(setAllGames);

    if (ems[idx] === myEmail && adminSelectedGame === currentGameCode) {
      localStorage.removeItem('wc2026_myemail');
      localStorage.removeItem('wc2026_gamecode');
      setMyEmail('');
      setCurrentGameCode(null);
      setParticipants([]);
      setAssignments(null);
      setTeamStatus({});
      setDupIds([]);
      setParticipantEmails([]);
    } else if (adminSelectedGame === currentGameCode) {
      setParticipants(newPs);
      setParticipantEmails(newEms);
      setAssignments(Object.keys(newAsgn).length ? newAsgn : null);
      setDupIds(newDups);
    }
  }, [adminGameData, adminSelectedGame, myEmail, currentGameCode]);

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

    // Create game form
    if (adminView === 'create') {
      return (
        <div className="admin-panel">
          <div style={{ marginBottom: '1rem' }}>
            <button className="admin-link" onClick={() => { setAdminView('games'); setCreateGameError(''); }}>
              ← Back to Games
            </button>
          </div>
          <h2 style={{ fontFamily: 'Special Elite, cursive', fontSize: '1.4rem', marginBottom: '1.5rem' }}>
            Create Game
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', maxWidth: 360 }}>
            <label style={{ fontFamily: 'Courier Prime, monospace', fontSize: '.9rem', color: '#555' }}>
              Game Code (letters &amp; numbers only)
            </label>
            <input
              className="inp"
              placeholder="e.g. WORLDCUP"
              value={newGameCode}
              onChange={e => setNewGameCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}
            />
            <label style={{ fontFamily: 'Courier Prime, monospace', fontSize: '.9rem', color: '#555' }}>
              Teams per person
            </label>
            <input
              className="inp"
              type="number"
              min={1}
              max={6}
              value={newGameTeams}
              onChange={e => setNewGameTeams(Math.min(6, Math.max(1, Number(e.target.value))))}
            />
            {createGameError && <p className="signup-error">{createGameError}</p>}
            <button
              className="draw-btn"
              style={{ fontSize: '1rem', padding: '.55rem 1.5rem' }}
              onClick={handleCreateGame}
            >
              Create Game
            </button>
          </div>
        </div>
      );
    }

    // Game detail view
    if (adminView === 'detail' && adminGameData) {
      const gPs   = adminGameData.participants ?? [];
      const gEms  = adminGameData.participant_emails ?? [];
      const gAsgn = adminGameData.assignments ?? {};
      const tpp   = adminGameData.teams_per_person ?? 2;
      return (
        <div className="admin-panel">
          <div style={{ marginBottom: '1rem' }}>
            <button className="admin-link" onClick={() => { setAdminView('games'); setAdminGameData(null); setAdminSelectedGame(null); }}>
              ← Back to Games
            </button>
          </div>
          <h2 style={{ fontFamily: 'Special Elite, cursive', fontSize: '1.4rem', marginBottom: '.25rem' }}>
            Game: {adminSelectedGame}
          </h2>
          <p style={{ fontFamily: 'Courier Prime, monospace', fontSize: '.82rem', color: '#888', marginBottom: '1.5rem' }}>
            {gPs.length} {gPs.length === 1 ? 'participant' : 'participants'} · {tpp} {tpp === 1 ? 'team' : 'teams'}/person
          </p>
          {gPs.length === 0 ? (
            <p style={{ color: '#888', fontFamily: 'Special Elite, cursive' }}>No participants yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr><th>#</th><th>Name</th><th>Email</th><th>Teams</th><th></th></tr>
                </thead>
                <tbody>
                  {gPs.map((name, i) => {
                    const tids = gAsgn[i] || [];
                    return (
                      <tr key={i}>
                        <td style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, color: 'var(--green)', width: '2rem' }}>{i + 1}</td>
                        <td style={{ fontFamily: 'Special Elite, cursive', whiteSpace: 'nowrap' }}>{name}</td>
                        <td style={{ fontSize: '.8rem', color: '#666' }}>{gEms[i] || '—'}</td>
                        <td>{tids.map(tid => { const t = getTeam(tid); return t ? `${t.flag} ${t.name}` : tid; }).join(' · ')}</td>
                        <td><button className="btn-remove" onClick={() => handleAdminRemove(i)}>Remove</button></td>
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

    // Games list (default)
    return (
      <div className="admin-panel">
        <div style={{ marginBottom: '1rem' }}>
          <button
            className="admin-link"
            onClick={() => { setAdminMode(false); setAdminAuthed(false); setAdminPasswordInput(''); setAdminView('games'); }}
          >
            ← Back to Sweepstake
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <h2 style={{ fontFamily: 'Special Elite, cursive', fontSize: '1.4rem', margin: 0 }}>
            Admin Panel
          </h2>
          <button
            className="draw-btn"
            style={{ fontSize: '.95rem', padding: '.45rem 1.2rem' }}
            onClick={() => { setAdminView('create'); setCreateGameError(''); }}
          >
            + Create Game
          </button>
        </div>
        {allGames.length === 0 ? (
          <p style={{ color: '#888', fontFamily: 'Special Elite, cursive' }}>No games yet. Create one above.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr><th>Code</th><th>Teams/Person</th><th>Players</th><th></th></tr>
              </thead>
              <tbody>
                {allGames.map(game => (
                  <tr key={game.id}>
                    <td style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, color: 'var(--green)', letterSpacing: '.05em' }}>
                      {game.id}
                    </td>
                    <td style={{ textAlign: 'center' }}>{game.teams_per_person ?? 2}</td>
                    <td style={{ textAlign: 'center' }}>{(game.participants || []).length}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="draw-btn"
                        style={{ fontSize: '.8rem', padding: '.3rem .8rem', marginRight: '.5rem' }}
                        onClick={() => handleAdminViewGame(game.id)}
                      >
                        View
                      </button>
                      <button
                        className="btn-remove"
                        onClick={() => handleAdminDeleteGame(game.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
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
            <HowItWorks />
            <p className="hiw-signup-note">Sign up with your email and your game code — teams are assigned instantly!</p>
          </section>

          <div className="signup-box">
            <div className="mode-toggle">
              <button
                className={`mode-btn${signupMode === 'signup' ? ' mode-btn--active' : ''}`}
                onClick={() => { setSignupMode('signup'); setSignupError(''); setSignupEmail(''); setShowGamePicker(false); }}
              >
                Sign Up
              </button>
              <button
                className={`mode-btn${signupMode === 'signin' ? ' mode-btn--active' : ''}`}
                onClick={() => { setSignupMode('signin'); setSignupError(''); setSignupName(''); setSignupCode(''); setShowGamePicker(false); }}
              >
                Sign In
              </button>
            </div>

            {signupMode === 'signup' ? (
              <>
                <input
                  className="inp signup-inp"
                  placeholder="Game code (e.g. WORLDCUP)"
                  value={signupCode}
                  onChange={e => setSignupCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  onKeyDown={e => e.key === 'Enter' && handleSignup()}
                  style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}
                />
                <input
                  className="inp signup-inp"
                  placeholder="Your first name"
                  value={signupName}
                  onChange={e => setSignupName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSignup()}
                />
                <input
                  className="inp signup-inp"
                  type="email"
                  placeholder="you@example.com"
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
              </>
            ) : showGamePicker ? (
              <>
                <p style={{ fontFamily: 'Special Elite, cursive', marginBottom: '1rem', color: '#444' }}>
                  You&apos;re in multiple games. Pick one:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                  {myGames.map(g => (
                    <button
                      key={g.id}
                      className="draw-btn"
                      style={{ fontSize: '1rem', padding: '.55rem 1.5rem' }}
                      onClick={() => handleGamePick(g.id)}
                    >
                      {g.id}
                    </button>
                  ))}
                </div>
                <button
                  className="admin-link"
                  style={{ marginTop: '1rem', display: 'block' }}
                  onClick={() => { setShowGamePicker(false); setSignupError(''); }}
                >
                  ← Back
                </button>
              </>
            ) : (
              <>
                <input
                  className="inp signup-inp"
                  type="email"
                  placeholder="you@example.com"
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
        {currentGameCode && (
          <div style={{ position: 'relative', zIndex: 1, marginTop: '.3rem' }}>
            <span style={{ fontFamily: 'Courier Prime, monospace', color: 'rgba(255,255,255,.7)', fontSize: '.78rem', letterSpacing: '.06em' }}>
              {currentGameCode}
            </span>
          </div>
        )}
        <div style={{ position: 'relative', zIndex: 1, marginTop: '.4rem' }}>
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
            { id: 'rules',       label: 'How It Works' },
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
                        {getWcRank(tid) && (
                          <div className="my-team-wcrank">WC Rank #{getWcRank(tid)}</div>
                        )}
                        <div className="my-team-pts">{+pts.toFixed(2)} pts</div>
                        {s === 'eliminated' && <div className="my-team-status">OUT</div>}
                        {s === 'champion'   && <div className="my-team-status">🏆 CHAMPION</div>}
                      </div>
                    );
                  })}
                </div>
                <p className="my-points">Total: <strong>{+myPoints.toFixed(2)} pts</strong></p>
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
                        <td className="pts-cell">{+pts.toFixed(2)}<span className="pts-label">pts</span></td>
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

        {participantTab === 'rules' && (
          <section className="participant-section">
            <div className="rules-box" style={{ maxWidth: 520, margin: '1.5rem auto' }}>
              <h2 className="rules-title">How It Works</h2>
              <HowItWorks />
            </div>
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
