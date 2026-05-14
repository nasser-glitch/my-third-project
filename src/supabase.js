import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default supabase;

export async function loadSweepstake() {
  const { data, error } = await supabase
    .from('sweepstake')
    .select('*')
    .eq('id', 'main')
    .single();
  if (error) console.error('Supabase load error:', error);
  return data;
}

export async function saveSweepstake(patch) {
  const { error } = await supabase
    .from('sweepstake')
    .upsert({ id: 'main', ...patch, updated_at: new Date().toISOString() });
  if (error) console.error('Supabase save error:', error);
}
