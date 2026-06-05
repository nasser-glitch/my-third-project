import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default supabase;

export async function loadAllGames() {
  const { data, error } = await supabase
    .from('sweepstake')
    .select('id, teams_per_person, participants, participant_emails')
    .order('updated_at', { ascending: false });
  if (error) console.error('Supabase loadAllGames error:', error);
  return data || [];
}

export async function loadSweepstake(gameCode) {
  const { data, error } = await supabase
    .from('sweepstake')
    .select('*')
    .eq('id', gameCode)
    .single();
  if (error) console.error('Supabase load error:', error);
  return data;
}

export async function saveSweepstake(gameCode, patch) {
  const { error } = await supabase
    .from('sweepstake')
    .upsert({ id: gameCode, ...patch, updated_at: new Date().toISOString() });
  if (error) console.error('Supabase save error:', error);
}

export async function createGame(code, teamsPerPerson) {
  const { error } = await supabase
    .from('sweepstake')
    .insert({
      id: code,
      teams_per_person: teamsPerPerson,
      participants: [],
      participant_emails: [],
      assignments: {},
      team_status: {},
      dup_ids: [],
      updated_at: new Date().toISOString(),
    });
  if (error) console.error('Supabase createGame error:', error);
  return error;
}

export async function deleteGame(gameCode) {
  const { error } = await supabase
    .from('sweepstake')
    .delete()
    .eq('id', gameCode);
  if (error) console.error('Supabase deleteGame error:', error);
  return error;
}
