exports.handler = async (event) => {
  const path = event.queryStringParameters?.path || '';
  const res = await fetch(`https://api.football-data.org/v4${path}`, {
    headers: { 'X-Auth-Token': process.env.FOOTBALL_API_KEY || '' },
  });
  const body = await res.text();
  return {
    statusCode: res.status,
    headers: {
      'Content-Type': 'application/json',
      'X-Requests-Available-Minute': res.headers.get('X-Requests-Available-Minute') || '',
      'X-RequestCounter-Reset': res.headers.get('X-RequestCounter-Reset') || '',
    },
    body,
  };
};
