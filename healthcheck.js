import http from 'node:http';

const port = Number(process.env.PORT || 3000);

const req = http.request(
  {
    host: '127.0.0.1',
    port,
    path: '/',
    method: 'GET',
    timeout: 5000,
  },
  (res) => {
    process.exit(res.statusCode && res.statusCode < 500 ? 0 : 1);
  }
);

req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
req.end();
