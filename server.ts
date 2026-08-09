import express from 'express';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = express();

  server.all(/.*/, (req, res) => {
    return handle(req, res);
  });

  server.listen(port, hostname, () => {
    console.log(`> Next.js Server Ready on http://${hostname}:${port}`);
  });
}).catch((err) => {
  console.error('Error starting server:', err);
  process.exit(1);
});
