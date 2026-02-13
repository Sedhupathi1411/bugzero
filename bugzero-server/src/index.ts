import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { loggerMiddleware } from './middleware/logger.js';
import userRoutes from './routes/userRoutes.js';
import submissionRoutes from './routes/submissionRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.SHARED_PASSWORD) {
  console.error('CRITICAL: SHARED_PASSWORD not set in environment');
  process.exit(1);
}

if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  console.error('CRITICAL: Admin credentials not set in environment');
  process.exit(1);
}

app.use(loggerMiddleware);
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to BugZero Server API' });
});

app.use('/', userRoutes);
app.use('/', submissionRoutes);
app.use('/admin', adminRoutes);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
