async function dbCall(action, params = {}) {
  const res = await fetch('/.netlify/functions/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  });
  return res.json();
}

export async function loadAllGames() {
  const { data } = await dbCall('loadAllGames');
  return data || [];
}

export async function loadSweepstake(gameCode) {
  const { data } = await dbCall('loadSweepstake', { gameCode });
  return data;
}

export async function saveSweepstake(gameCode, patch) {
  const { error } = await dbCall('saveSweepstake', { gameCode, patch });
  return error;
}

export async function createGame(code, teamsPerPerson) {
  const { error } = await dbCall('createGame', { code, teamsPerPerson });
  return error;
}

export async function deleteGame(gameCode) {
  const { error } = await dbCall('deleteGame', { gameCode });
  return error;
}
