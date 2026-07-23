import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { requireAuth, requireSuperAdmin } from './middleware/auth.js';

import storesRouter from './routes/stores.js';
import productRoute from './routes/products.js';
import transactionsRouter from './routes/transactions.js';
import usersRouter from './routes/users.js';
import authRouter from './routes/auth.js';
import superadminRouter from './routes/superadmin.js';
import qrcodesRouter from './routes/qrcodes.js';
import dashboardRouter from './routes/dashboard.js';
import merchantQrcodesRouter from './routes/merchant-qrcodes.js';
import productGroupsRouter from './routes/product-groups.js';
import stockBalanceRouter from './routes/stock-balance.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Public — login/register only
app.use('/api/auth', authRouter);

// Protected — merchant-scoped routes
app.use('/api/stores', requireAuth, storesRouter);
app.use('/api/products', requireAuth, productRoute);
app.use('/api/transactions', requireAuth, transactionsRouter);
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/qrcode', requireAuth, merchantQrcodesRouter);
app.use('/api/product-groups', requireAuth, productGroupsRouter);
app.use('/api/stock-balance', requireAuth, stockBalanceRouter);
app.use('/api/transactions', requireAuth, transactionsRouter);

// Protected — Super Admin only
app.use('/api/superadmin', requireAuth, requireSuperAdmin, superadminRouter);
app.use('/api/superadmin/qrcode', requireAuth, requireSuperAdmin, qrcodesRouter);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));