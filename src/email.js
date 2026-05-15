import emailjs from '@emailjs/browser';

const SVC       = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const PUB       = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
const T_DRAW    = import.meta.env.VITE_EMAILJS_TEMPLATE_DRAW;
const T_FINAL   = import.meta.env.VITE_EMAILJS_TEMPLATE_FINAL;

function send(templateId, params) {
  if (!SVC || !PUB) return Promise.resolve();
  return emailjs.send(SVC, templateId, params, PUB).catch(() => {});
}

export function sendDrawEmail(email, name, team1, team2) {
  return send(T_DRAW, { to_email: email, participant_name: name, team1_name: team1, team2_name: team2 });
}

export function sendFinalEmail(email, name, winnerName, leaderboardText) {
  return send(T_FINAL, { to_email: email, participant_name: name, winner_name: winnerName, leaderboard_text: leaderboardText });
}
