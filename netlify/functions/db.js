const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid json' }) };
  }

  const { action, ...p } = body;

  if (action === 'loadAllGames') {
    const { data } = await supabase
      .from('sweepstake')
      .select('id, teams_per_person, participants, participant_emails')
      .order('updated_at', { ascending: false });
    return ok(data || []);
  }

  if (action === 'loadSweepstake') {
    const { data } = await supabase
      .from('sweepstake')
      .select('*')
      .eq('id', p.gameCode)
      .single();
    return ok(data ?? null);
  }

  if (action === 'saveSweepstake') {
    const { error } = await supabase
      .from('sweepstake')
      .upsert({ id: p.gameCode, ...p.patch, updated_at: new Date().toISOString() });
    return ok(null, error);
  }

  if (action === 'createGame') {
    const { error } = await supabase.from('sweepstake').insert({
      id: p.code,
      teams_per_person: p.teamsPerPerson,
      participants: [],
      participant_emails: [],
      assignments: {},
      team_status: {},
      dup_ids: [],
      updated_at: new Date().toISOString(),
    });
    return ok(null, error);
  }

  if (action === 'deleteGame') {
    const { error } = await supabase
      .from('sweepstake')
      .delete()
      .eq('id', p.gameCode);
    return ok(null, error);
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'unknown action' }) };
};

function ok(data, error = null) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, error }),
  };
}
