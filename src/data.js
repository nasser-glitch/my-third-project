// 48 World Cup 2026 teams — tla/apiName used for matching football-data.org responses
// fifaRank = FIFA Men's World Ranking (April 2026, inside.fifa.com)
export const TEAMS = [
  { id:1,  name:'USA',          flag:'🇺🇸', group:'A', tla:'USA', apiName:'United States',   fifaRank:16 },
  { id:2,  name:'Brazil',       flag:'🇧🇷', group:'A', tla:'BRA', apiName:'Brazil',           fifaRank:6  },
  { id:3,  name:'Serbia',       flag:'🇷🇸', group:'A', tla:'SRB', apiName:'Serbia',           fifaRank:39 },
  { id:4,  name:'Morocco',      flag:'🇲🇦', group:'A', tla:'MAR', apiName:'Morocco',          fifaRank:8  },
  { id:5,  name:'Mexico',       flag:'🇲🇽', group:'B', tla:'MEX', apiName:'Mexico',           fifaRank:15 },
  { id:6,  name:'France',       flag:'🇫🇷', group:'B', tla:'FRA', apiName:'France',           fifaRank:1  },
  { id:7,  name:'Poland',       flag:'🇵🇱', group:'B', tla:'POL', apiName:'Poland',           fifaRank:35 },
  { id:8,  name:'Senegal',      flag:'🇸🇳', group:'B', tla:'SEN', apiName:'Senegal',          fifaRank:14 },
  { id:9,  name:'Canada',       flag:'🇨🇦', group:'C', tla:'CAN', apiName:'Canada',           fifaRank:30 },
  { id:10, name:'Spain',        flag:'🇪🇸', group:'C', tla:'ESP', apiName:'Spain',            fifaRank:2  },
  { id:11, name:'Switzerland',  flag:'🇨🇭', group:'C', tla:'SUI', apiName:'Switzerland',      fifaRank:19 },
  { id:12, name:'Japan',        flag:'🇯🇵', group:'C', tla:'JPN', apiName:'Japan',            fifaRank:18 },
  { id:13, name:'Argentina',    flag:'🇦🇷', group:'D', tla:'ARG', apiName:'Argentina',        fifaRank:3  },
  { id:14, name:'Germany',      flag:'🇩🇪', group:'D', tla:'GER', apiName:'Germany',          fifaRank:10 },
  { id:15, name:'Croatia',      flag:'🇭🇷', group:'D', tla:'CRO', apiName:'Croatia',          fifaRank:11 },
  { id:16, name:'South Korea',  flag:'🇰🇷', group:'D', tla:'KOR', apiName:'Korea Republic',   fifaRank:25 },
  { id:17, name:'England',      flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', group:'E', tla:'ENG', apiName:'England',           fifaRank:4  },
  { id:18, name:'Portugal',     flag:'🇵🇹', group:'E', tla:'POR', apiName:'Portugal',         fifaRank:5  },
  { id:19, name:'Denmark',      flag:'🇩🇰', group:'E', tla:'DEN', apiName:'Denmark',          fifaRank:20 },
  { id:20, name:'Australia',    flag:'🇦🇺', group:'E', tla:'AUS', apiName:'Australia',        fifaRank:27 },
  { id:21, name:'Netherlands',  flag:'🇳🇱', group:'F', tla:'NED', apiName:'Netherlands',      fifaRank:7  },
  { id:22, name:'Belgium',      flag:'🇧🇪', group:'F', tla:'BEL', apiName:'Belgium',          fifaRank:9  },
  { id:23, name:'Sweden',       flag:'🇸🇪', group:'F', tla:'SWE', apiName:'Sweden',           fifaRank:38 },
  { id:24, name:'Iran',         flag:'🇮🇷', group:'F', tla:'IRN', apiName:'IR Iran',          fifaRank:21 },
  { id:25, name:'Italy',        flag:'🇮🇹', group:'G', tla:'ITA', apiName:'Italy',            fifaRank:12 },
  { id:26, name:'Turkey',       flag:'🇹🇷', group:'G', tla:'TUR', apiName:'Türkiye',          fifaRank:22 },
  { id:27, name:'Ukraine',      flag:'🇺🇦', group:'G', tla:'UKR', apiName:'Ukraine',          fifaRank:32 },
  { id:28, name:'Nigeria',      flag:'🇳🇬', group:'G', tla:'NGA', apiName:'Nigeria',          fifaRank:26 },
  { id:29, name:'Colombia',     flag:'🇨🇴', group:'H', tla:'COL', apiName:'Colombia',         fifaRank:13 },
  { id:30, name:'Uruguay',      flag:'🇺🇾', group:'H', tla:'URU', apiName:'Uruguay',          fifaRank:17 },
  { id:31, name:'Scotland',     flag:'🏴󠁧󠁢󠁳󠁣󠁴󠁿', group:'H', tla:'SCO', apiName:'Scotland',          fifaRank:43 },
  { id:32, name:'Cameroon',     flag:'🇨🇲', group:'H', tla:'CMR', apiName:'Cameroon',         fifaRank:45 },
  { id:33, name:'Chile',        flag:'🇨🇱', group:'I', tla:'CHI', apiName:'Chile',            fifaRank:54 },
  { id:34, name:'Ecuador',      flag:'🇪🇨', group:'I', tla:'ECU', apiName:'Ecuador',          fifaRank:23 },
  { id:35, name:'Egypt',        flag:'🇪🇬', group:'I', tla:'EGY', apiName:'Egypt',            fifaRank:29 },
  { id:36, name:'Tunisia',      flag:'🇹🇳', group:'I', tla:'TUN', apiName:'Tunisia',          fifaRank:44 },
  { id:37, name:'Paraguay',     flag:'🇵🇾', group:'J', tla:'PAR', apiName:'Paraguay',         fifaRank:40 },
  { id:38, name:'Bolivia',      flag:'🇧🇴', group:'J', tla:'BOL', apiName:'Bolivia',          fifaRank:76 },
  { id:39, name:'Saudi Arabia', flag:'🇸🇦', group:'J', tla:'KSA', apiName:'Saudi Arabia',     fifaRank:61 },
  { id:40, name:'Ghana',        flag:'🇬🇭', group:'J', tla:'GHA', apiName:'Ghana',            fifaRank:74 },
  { id:41, name:'Peru',         flag:'🇵🇪', group:'K', tla:'PER', apiName:'Peru',             fifaRank:54 },
  { id:42, name:'Venezuela',    flag:'🇻🇪', group:'K', tla:'VEN', apiName:'Venezuela',        fifaRank:49 },
  { id:43, name:'Austria',      flag:'🇦🇹', group:'K', tla:'AUT', apiName:'Austria',          fifaRank:24 },
  { id:44, name:'Algeria',      flag:'🇩🇿', group:'K', tla:'ALG', apiName:'Algeria',          fifaRank:28 },
  { id:45, name:'Czech Rep.',   flag:'🇨🇿', group:'L', tla:'CZE', apiName:'Czech Republic',   fifaRank:41 },
  { id:46, name:'Hungary',      flag:'🇭🇺', group:'L', tla:'HUN', apiName:'Hungary',          fifaRank:42 },
  { id:47, name:'Greece',       flag:'🇬🇷', group:'L', tla:'GRE', apiName:'Greece',           fifaRank:47 },
  { id:48, name:'Qatar',        flag:'🇶🇦', group:'L', tla:'QAT', apiName:'Qatar',            fifaRank:55 },
];

export const DEMO_NAMES = [
  'Alice Thompson','Bob Martinez','Charlie Davis','Diana Wilson',
  'Edward Brown','Fiona Taylor','George Anderson','Hannah Jackson',
  'Ivan White','Julia Harris','Kevin Martin','Laura Garcia',
  'Michael Johnson','Natalie Smith','Oliver Jones','Patricia Lee',
  'Quincy Walker','Rachel Hall','Samuel Allen','Tara Young',
  'Umberto King','Victoria Wright','William Scott','Xena Green',
  'Yasmin Baker','Zachary Adams','Amber Nelson','Brian Carter',
  'Carla Mitchell','Derek Perez','Elena Roberts','Frank Turner',
  'Grace Phillips','Henry Campbell','Irene Parker','James Evans',
  'Karen Edwards','Liam Collins','Monica Stewart','Nathan Sanchez',
  'Olivia Morris','Peter Rogers','Quinn Reed','Rebecca Cook',
  'Simon Morgan','Teresa Bell','Victor Murphy','Wendy Bailey',
  'Xavier Rivera','Yvette Cooper',
];

export function getDemoNames(n) {
  return Array.from({ length: n }, (_, i) =>
    i < DEMO_NAMES.length ? DEMO_NAMES[i] : `Participant ${i + 1}`
  );
}

export const CONFETTI_COLORS = [
  '#C41E3A','#C8971C','#F0C040','#2D5A1B','#4A8A2D','#ffffff','#0F1B4C',
];
