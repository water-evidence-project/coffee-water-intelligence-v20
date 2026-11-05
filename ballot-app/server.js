const express = require('express');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
const candidates = ['VY', 'THƯ', 'LIỄU', 'HIỀN'];

app.disable('x-powered-by');
app.use(express.json({ limit: '2kb' }));
app.use(express.static('public', { etag: true, maxAge: '5m' }));

app.get('/api/results', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT candidate, votes FROM vote_totals ORDER BY CASE candidate WHEN $1 THEN 1 WHEN $2 THEN 2 WHEN $3 THEN 3 WHEN $4 THEN 4 END',
      candidates
    );
    res.set('Cache-Control', 'no-store');
    res.json({ results: rows });
  } catch (error) {
    console.error('results_error', error.message);
    res.status(503).json({ error: 'Chưa thể tải kết quả. Vui lòng thử lại.' });
  }
});

app.post('/api/vote', async (req, res) => {
  const picks = req.body && req.body.picks;
  if (!Array.isArray(picks) || picks.length !== 2 ||
      picks[0] === picks[1] || picks.some(x => !candidates.includes(x))) {
    return res.status(400).json({ error: 'Mỗi phiếu phải chọn đúng hai ứng viên khác nhau.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const candidate of picks) {
      await client.query(
        'UPDATE vote_totals SET votes = votes + 1 WHERE candidate = $1',
        [candidate]
      );
    }
    await client.query('COMMIT');
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('vote_error', error.message);
    res.status(503).json({ error: 'Chưa ghi nhận được phiếu. Vui lòng thử lại.' });
  } finally {
    client.release();
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log('Ballot server listening on ' + port));
