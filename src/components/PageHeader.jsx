// src/components/PageHeader.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, QrCode, Clock, Bell, X } from 'lucide-react';
import { apiFetch } from '../utils/api';
import '../styles/PageHeader.css';

const STATIC_HEADERS = {
  '/dashboard': { title: 'Dashboard' },
  '/registry': { title: 'Register New Product', subtitle: 'Add an item to the master catalogue' },
  '/listing': { title: 'Products' },
  '/assign-qr': { title: 'Assign QR to Product', subtitle: 'Bind printed QR labels to a product variant' },
  '/stock-balance': { title: 'Inventory Balance', subtitle: 'Live on-hand quantity across every store' },
  '/stores': { title: 'Store Management' },
  '/stock': { title: 'Stock Adjustment', subtitle: 'Pending counts and corrections' },
  '/ledger': { title: 'Transaction History', subtitle: 'Every movement, immutable · click a row for detail' },
  '/users': { title: 'User Management' },
};

function todayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export default function PageHeader() {
  const location = useLocation();
  const basePath = '/' + (location.pathname.split('/')[1] || '');

  const [now, setNow] = useState(new Date());
  const [dynamicSubtitle, setDynamicSubtitle] = useState(null);
  const [expiryDate, setExpiryDate] = useState(null); // Date | null
  const [expiryLoaded, setExpiryLoaded] = useState(false);
  const [storeCount, setStoreCount] = useState(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch once — merchant's own licence expiry doesn't change per-route.
  useEffect(() => {
    apiFetch('/api/merchant/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.expiry_date) {
          const d = new Date(data.expiry_date);
          setExpiryDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)));
        }
      })
      .catch((err) => console.error('Failed to load merchant info:', err))
      .finally(() => setExpiryLoaded(true));

    apiFetch('/api/stores')
      .then((res) => res.json())
      .then((stores) => setStoreCount(stores.length))
      .catch((err) => console.error('Failed to load stores:', err));
  }, []);

  useEffect(() => {
    setDynamicSubtitle(null);

    if (basePath === '/listing') {
      apiFetch('/api/products')
        .then((res) => res.json())
        .then((products) => {
          const variantCount = products.reduce((sum, p) => sum + (p.variants?.length || 0), 0);
          setDynamicSubtitle(`${products.length} items · ${variantCount} variants`);
        })
        .catch(() => setDynamicSubtitle(null));
    }

    if (basePath === '/stores') {
      apiFetch('/api/stores')
        .then((res) => res.json())
        .then((stores) => {
          setDynamicSubtitle(`${stores.length} location${stores.length === 1 ? '' : 's'} · 12 scanning devices`);
        })
        .catch(() => setDynamicSubtitle(null));
    }

    if (basePath === '/users') {
      apiFetch('/api/users')
        .then((res) => res.json())
        .then((users) => {
          const roleCount = new Set(users.map((u) => u.role)).size;
          setDynamicSubtitle(`${users.length} account${users.length === 1 ? '' : 's'} · ${roleCount} role${roleCount === 1 ? '' : 's'}`);
        })
        .catch(() => setDynamicSubtitle(null));
    }
  }, [basePath]);

  const { title, subtitle } = useMemo(() => {
    const entry = STATIC_HEADERS[basePath];
    if (!entry) return { title: '', subtitle: '' };
    if (basePath === '/dashboard') {
      return { title: entry.title, subtitle: `All stores · ${todayLabel()}` };
    }
    return { title: entry.title, subtitle: dynamicSubtitle || entry.subtitle || '' };
  }, [basePath, dynamicSubtitle]);

  if (!title) return null;

  const msLeft = expiryDate ? expiryDate - now : null;
  const expired = msLeft !== null && msLeft <= 0;
  const dd = msLeft !== null ? Math.floor(Math.abs(msLeft) / 86400000) : 0;
  const hh = msLeft !== null ? Math.floor(Math.abs(msLeft) / 3600000) % 24 : 0;
  const mm = msLeft !== null ? Math.floor(Math.abs(msLeft) / 60000) % 60 : 0;
  const ss = msLeft !== null ? Math.floor(Math.abs(msLeft) / 1000) % 60 : 0;
  const urgent = expired || (msLeft !== null && dd <= 7);

  const expiryDateLabel = expiryDate
    ? expiryDate.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  // Banner only makes sense as an urgency nudge — same threshold as the
  // badge's color change (<=7 days), not shown once the plan has room to spare.
  const showBanner = expiryLoaded && expiryDate && urgent && !bannerDismissed;

  return (
    <>
      <header className="page-header">
        <div className="page-header-title-block">
          <div className="page-header-title">{title}</div>
          {subtitle && <div className="page-header-subtitle">{subtitle}</div>}
        </div>

        <div className="page-header-spacer" />

        <div className="page-header-search">
          <Search size={14} />
          <span>Search SKU, QR code, store…</span>
          <span className="page-header-kbd">⌘K</span>
        </div>

        <div className="page-header-live">
          <span className="page-header-live-dot" />
          <span>LIVE · {pad(now.getHours())}:{pad(now.getMinutes())}</span>
        </div>

        <button type="button" className="page-header-lookup-btn">
          <QrCode size={14} />
          <span>Scan lookup</span>
          <span className="page-header-kbd page-header-kbd-muted">⌘L</span>
        </button>

        {expiryLoaded && expiryDate && (
          <div className={`page-header-expiry ${urgent ? 'page-header-expiry-urgent' : ''}`}>
            <Clock size={13} />
            {expired ? (
              <span>Expired {dd}d ago</span>
            ) : (
              <span>{dd}d {pad(hh)}:{pad(mm)}:{pad(ss)}</span>
            )}
            <span className="page-header-expiry-caption">{expired ? '' : 'left on plan'}</span>
          </div>
        )}

        {/*<button type="button" className="page-header-bell" aria-label="Notifications">
          <Bell size={16} />
          <span className="page-header-bell-badge">3</span>
        </button>

        <button type="button" className="page-header-transfer-btn">
          New transfer
        </button>*/}
      </header>

      {showBanner && (
        <div className="expiry-banner">
          <Clock size={17} className="expiry-banner-icon" />
          <span className="expiry-banner-text">
            <span className="expiry-banner-title">
              {expired ? 'Merchant licence has expired' : `Merchant licence expires in ${dd} day${dd === 1 ? '' : 's'}`}
            </span>
            <span className="expiry-banner-subtitle">
              {expired ? 'Renew now to restore' : `Renew before ${expiryDateLabel} to keep`} scanning and stock sync
              active{storeCount !== null ? ` across all ${storeCount} store${storeCount === 1 ? '' : 's'}` : ''}.
            </span>
          </span>
          <span className="expiry-banner-countdown">
            {[[dd, 'DAYS'], [hh, 'HRS'], [mm, 'MIN'], [ss, 'SEC']].map(([value, label]) => (
              <span key={label} className="expiry-banner-unit">
                <span className="expiry-banner-unit-value">{pad(value)}</span>
                <span className="expiry-banner-unit-label">{label}</span>
              </span>
            ))}
          </span>
          <button type="button" className="expiry-banner-renew-btn">Renew licence</button>
          <button
            type="button"
            className="expiry-banner-dismiss"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}   