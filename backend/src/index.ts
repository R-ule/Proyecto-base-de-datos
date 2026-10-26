import express from 'express';
import { z } from 'zod';

const environmentSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
});

const { PORT } = environmentSchema.parse(process.env);
const app = express();

app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
