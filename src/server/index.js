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
import merchantRouter from './routes/merchant.js';
import variantsRouter from './routes/variants.js';
import agentsRouter from './routes/agents.js';
import bundlesRouter from './routes/qr-bundles.js';
import { loadStoreScope } from './middleware/storeScope.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check — lets hosting (and you) confirm the API is up
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Public — login/register only
app.use('/api/auth', authRouter);

// Protected — merchant-scoped routes
app.use('/api/stores', requireAuth, loadStoreScope, storesRouter);
app.use('/api/products', requireAuth, productRoute);
app.use('/api/transactions', requireAuth, loadStoreScope, transactionsRouter);
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/dashboard', requireAuth, loadStoreScope, dashboardRouter);
app.use('/api/qrcode', requireAuth, loadStoreScope, merchantQrcodesRouter);
app.use('/api/product-groups', requireAuth, productGroupsRouter);
app.use('/api/stock-balance', requireAuth, loadStoreScope, stockBalanceRouter);
app.use('/api/merchant', requireAuth, merchantRouter);
app.use('/api/variants', requireAuth, variantsRouter);
app.use('/api/agents', requireAuth, agentsRouter);
app.use('/api/bundles', requireAuth, loadStoreScope, bundlesRouter);

// Protected — Super Admin only
app.use('/api/superadmin', requireAuth, requireSuperAdmin, superadminRouter);
app.use('/api/superadmin/qrcode', requireAuth, requireSuperAdmin, qrcodesRouter);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));