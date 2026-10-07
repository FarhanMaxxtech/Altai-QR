// src/components/PageHeader.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, QrCode, Clock, Bell, X } from 'lucide-react';
import { apiFetch } from '../utils/api';
import ScanLookupModal from './ScanLookupModal';
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

function roleBadgeLabel(user) {
  if (user.role === 'admin') return 'Admin';
  if (user.role === 'super_admin') return 'Super Admin';
  return user.permission_preset || 'Viewer';
}

const handleLogout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
    window.location.href = '/login';
};

export default function PageHeader() {
  const location = useLocation();
  const basePath = '/' + (location.pathname.split('/')[1] || '');

  const navigate = useNavigate();
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const [dynamicSubtitle, setDynamicSubtitle] = useState(null);
  const [expiryDate, setExpiryDate] = useState(null); // Date | null
  const [expiryLoaded, setExpiryLoaded] = useState(false);
  const [scopedStores, setScopedStores] = useState([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [isScanLookupOpen, setIsScanLookupOpen] = useState(false);

  const headerRef = useRef(null);
const [headerHeight, setHeaderHeight] = useState(64);

const [isRenewContactOpen, setIsRenewContactOpen] = useState(false);

const VENDOR_NAME = 'Maxxtech Systems Sdn Bhd';
const VENDOR_PHONE_PRIMARY = '+603 3006 8302';
const VENDOR_PHONE_SECONDARY = '016 645 8154';

useEffect(() => {
  if (!headerRef.current) return;

  const updateHeight = () => {
    setHeaderHeight(headerRef.current.offsetHeight);
  };

  updateHeight();

  const resizeObserver = new ResizeObserver(updateHeight);
  resizeObserver.observe(headerRef.current);

  return () => resizeObserver.disconnect();
}, []);


  const currentUser = useMemo(() => {
  const raw = localStorage.getItem('authUser');
  return raw ? JSON.parse(raw) : null;
  }, []);

  const isFullStoreAccess = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

// Closed (Inactive) stores shouldn't count toward "how many stores this
// covers" — matches the same Active-only filtering used elsewhere (e.g.
// StoreManagement, StockAdjustment).
const activeScopedStores = useMemo(
  () => scopedStores.filter((s) => s.status === 'Active'),
  [scopedStores]
);

const storeCount = activeScopedStores.length;

const storeScopeLabel = useMemo(() => {
  if (isFullStoreAccess) return 'All stores';
  if (activeScopedStores.length === 0) return 'No store access';
  if (activeScopedStores.length === 1) return activeScopedStores[0].location;
  return `${activeScopedStores.length} stores`;
}, [isFullStoreAccess, activeScopedStores]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch once — merchant's own licence expiry doesn't change per-route.
      useEffect(() => {
      if (!currentUser) {
        setExpiryLoaded(true);
        return;
      }

      if (currentUser.role === 'admin') {
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
      } else if (currentUser.role === 'staff') {
        // Staff have their own optional expiry_date — never the merchant's.
        if (currentUser.expiry_date) {
          const d = new Date(currentUser.expiry_date);
          setExpiryDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)));
        }
        setExpiryLoaded(true);
      } else {
        // super_admin — no expiry concept
        setExpiryLoaded(true);
      }

      apiFetch('/api/stores')
        .then((res) => res.json())
        .then((stores) => setScopedStores(stores))
        .catch((err) => console.error('Failed to load stores:', err));
    }, []);

  useEffect(() => {
    setDynamicSubtitle(null);

    if (basePath === '/listing') {
      apiFetch('/api/products')
        .then((res) => res.json())
        .then((products) => {
          const variantCount = products.reduce((sum, p) => sum + (p.variants?.length || 0), 0);
          setDynamicSubtitle(`${products.length} products · ${variantCount} variants`);
        })
        .catch(() => setDynamicSubtitle(null));
    }

    if (basePath === '/stores') {
      apiFetch('/api/stores')
        .then((res) => res.json())
        .then((stores) => {
          setDynamicSubtitle(`${stores.length} location${stores.length === 1 ? '' : 's'}`);
        })
        .catch(() => setDynamicSubtitle(null));
    }

    if (basePath === '/users') {
      apiFetch('/api/users')
        .then((res) => res.json())
        .then((users) => {
          const roleLabel = (u) => {
            if (u.role === 'admin') return 'Admin';
            if (u.role === 'super_admin') return 'Super Admin';
            return u.permission_preset || 'Viewer';
          };
          const roleCount = new Set(users.map(roleLabel)).size;
          setDynamicSubtitle(`${users.length} account${users.length === 1 ? '' : 's'} · ${roleCount} role${roleCount === 1 ? '' : 's'}`);
        })
        .catch(() => setDynamicSubtitle(null));
    }
  }, [basePath]);

  // NEW: Ctrl+L / Cmd+L keyboard shortcut
useEffect(() => {
  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      setIsScanLookupOpen(true);
    }
  };

  window.addEventListener('keydown', handleKeyDown);

  return () => {
    window.removeEventListener('keydown', handleKeyDown);
  };
}, []);

  // Auto-open the notification bell the moment the licence actually
  // expires — checked every second via `now`, but guarded by a ref so it
  // only force-opens once per expiry event (won't reopen if the person
  // closes it again while still expired).
  const hasAutoOpenedExpiryNotifRef = useRef(false);

  useEffect(() => {
    if (!expiryDate) return;
    const isExpiredNow = now >= expiryDate;

    if (isExpiredNow && !hasAutoOpenedExpiryNotifRef.current) {
      hasAutoOpenedExpiryNotifRef.current = true;
      setIsNotifOpen(true);
    }

    // Licence got renewed (expiryDate moved into the future again) —
    // reset the guard so a future expiry can trigger the popup again.
    if (!isExpiredNow) {
      hasAutoOpenedExpiryNotifRef.current = false;
    }
  }, [now, expiryDate]);

  const { title, subtitle } = useMemo(() => {
    const entry = STATIC_HEADERS[basePath];
    if (!entry) return { title: '', subtitle: '' };
    if (basePath === '/dashboard') {
      return { title: entry.title, subtitle: `${storeScopeLabel} · ${todayLabel()}` };
    }
    return { title: entry.title, subtitle: dynamicSubtitle || entry.subtitle || '' };
  },  [basePath, dynamicSubtitle, storeScopeLabel]);

  if (!title) return null;

  const msLeft = expiryDate ? expiryDate - now : null;
  const expired = msLeft !== null && msLeft <= 0;
  const dd = msLeft !== null ? Math.floor(Math.abs(msLeft) / 86400000) : 0;
  const hh = msLeft !== null ? Math.floor(Math.abs(msLeft) / 3600000) % 24 : 0;
  const mm = msLeft !== null ? Math.floor(Math.abs(msLeft) / 60000) % 60 : 0;
  const ss = msLeft !== null ? Math.floor(Math.abs(msLeft) / 1000) % 60 : 0;
  const urgent = expired || (msLeft !== null && dd <= 7);

  const expiryDateLabel = expiryDate
    ? expiryDate.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : '';
  // Banner only makes sense as an urgency nudge — same threshold as the
  // badge's color change (<=7 days), not shown once the plan has room to spare.
  const showBanner = expiryLoaded && expiryDate && urgent && !bannerDismissed;

  return (
    <>
      <header
          className="page-header"
          ref={headerRef}
          style={{ '--ph-height': `${headerHeight}px` }}
        >
        <div className="page-header-title-block">
          <div className="page-header-title">{title}</div>
          {subtitle && <div className="page-header-subtitle">{subtitle}</div>}
        </div>

        <div className="page-header-spacer" />

        <div className="page-header-live">
          <span className="page-header-live-dot" />
          <span>LIVE · {pad(now.getHours())}:{pad(now.getMinutes())}</span>
        </div>

        <button
          type="button"
          className="page-header-lookup-btn"
          onClick={() => setIsScanLookupOpen(true)}
        >
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

        <div className="page-header-notif-wrap">
          <button
            type="button"
            className="page-header-bell"
            aria-label="Notifications"
            onClick={() => setIsNotifOpen((prev) => !prev)}
          >
            <Bell size={16} />
            {expiryLoaded && expiryDate && <span className="page-header-bell-badge">1</span>}
          </button>

          {isNotifOpen && (
            <div className="page-header-notif-panel">
              <div className="notif-panel-header">
                <span className="notif-panel-title">Notifications</span>
                {expiryLoaded && expiryDate && <span className="notif-panel-new-badge">1 NEW</span>}
                <div className="page-header-spacer" />
                <button
                  type="button"
                  className="notif-panel-mark-read"
                  onClick={() => setIsNotifOpen(false)}
                >
                  Mark all read
                </button>
              </div>

              <div className="notif-panel-list">
                {expiryLoaded && expiryDate ? (
                  <div className="notif-row">
                    <span className={`notif-dot ${urgent ? 'notif-dot-critical' : 'notif-dot-ok'}`} />
                    <div className="notif-row-body">
                      <span className="notif-row-title">
                        {expired ? 'Merchant licence expired' : 'Merchant licence expiring'}
                      </span>
                      <span className="notif-row-desc">
                        {expired
                          ? 'Your plan has expired. Renew to restore scan access.'
                          : `Your plan ends in ${dd} day${dd === 1 ? '' : 's'}. Renew to avoid losing scan access.`}
                      </span>
                      <span className="notif-row-time">Just now</span>
                    </div>
                  </div>
                ) : (
                  <p className="notif-empty">No notifications right now.</p>
                )}
              </div>

              <div className="notif-panel-footer">
                <span>Merchant plan renews automatically</span>
                <a href="#" className="notif-panel-manage-link">Manage plan →</a>
              </div>
            </div>
          )}
        </div>

        <button type="button" className="page-header-transfer-btn" onClick={handleLogout}>
          Log Out
        </button>
      </header>
        <ScanLookupModal isOpen={isScanLookupOpen} onClose={() => setIsScanLookupOpen(false)} />
      {showBanner && (
        <div className="expiry-banner">
          <Clock size={17} className="expiry-banner-icon" />
          <span className="expiry-banner-text">
            <span className="expiry-banner-title">
              {expired ? 'Merchant licence has expired' : `Merchant licence expires in ${dd} day${dd === 1 ? '' : 's'}`}
            </span>
            <span className="expiry-banner-subtitle">
              {expired ? 'Renew now to restore' : `Renew before ${expiryDateLabel} to keep`} scanning and stock sync
              active{storeCount > 0 ? ` across all ${storeCount} store${storeCount === 1 ? '' : 's'}` : ''}.
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
          {isRenewContactOpen ? (
            <div className="expiry-contact-card">
              <div className="expiry-contact-label">Contact vendor to renew:</div>
              <div className="expiry-contact-name">{VENDOR_NAME}</div>
              <div className="expiry-contact-phone">
                {VENDOR_PHONE_PRIMARY} · {VENDOR_PHONE_SECONDARY}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="expiry-banner-renew-btn"
              onClick={() => setIsRenewContactOpen(true)}
            >
              Renew licence
            </button>
          )}
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

      {expired && (
        <div className="license-lockout-overlay">
          <div className="license-lockout-card">
            <Clock size={28} className="license-lockout-icon" />
            <h2>Licence Expired</h2>
            <p>
              Your organisation's licence expired
              {expiryDateLabel ? ` on ${expiryDateLabel}` : ''}. Access is
              suspended until it's renewed — please contact your vendor below.
            </p>
            <div className="expiry-contact-card license-lockout-contact">
              <div className="expiry-contact-label">Contact vendor to renew:</div>
              <div className="expiry-contact-name">{VENDOR_NAME}</div>
              <div className="expiry-contact-phone">
                {VENDOR_PHONE_PRIMARY} · {VENDOR_PHONE_SECONDARY}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}   