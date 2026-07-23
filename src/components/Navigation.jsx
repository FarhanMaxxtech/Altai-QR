// src/components/Navigation.jsx
import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    QrCode,
    PackageSearch,
    Store,
    ArrowLeftRight,
    ScrollText,
    Users,
    ChevronDown,
    ChevronRight,
} from 'lucide-react';
import '../../src/styles/Navigation.css';

const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, module: null },
    {
        label: 'Product InfoCenter',
        icon: QrCode,
        children: [
            { path: '/registry', label: 'Register New Product', module: 'Asset Registry' },
            { path: '/listing', label: 'Product Listing', module: 'Product Listing' },
        ],
    },
    { path: '/stock-balance', label: 'Product Balance', icon: PackageSearch, module: 'Stock Adjustment' },
    { path: '/stores', label: 'Store Management', icon: Store, module: 'Store Management' },
    { path: '/stock', label: 'Stock Adjustment', icon: ArrowLeftRight, module: 'Stock Adjustment' },
    { path: '/ledger', label: 'Transaction Ledger', icon: ScrollText, module: 'Ledger' },
    { path: '/users', label: 'User Management', icon: Users, module: 'User Management' },
];

function hasAccess(user, module) {
    if (user?.role === 'admin') return true; // admin always sees everything
    if (!module) return true; // no restriction
    return user?.modules?.includes(module);
}

export default function Navigation() {
    const storedUser = localStorage.getItem('authUser');
    const user = storedUser ? JSON.parse(storedUser) : null;
    const navigate = useNavigate();
    const location = useLocation();
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    const isChildActive = (item) =>
        item.children?.some((child) => location.pathname.startsWith(child.path));

    const [openMenus, setOpenMenus] = useState(() => {
        const initial = {};
        navItems.forEach((item) => {
            if (item.children) initial[item.label] = isChildActive(item);
        });
        return initial;
    });

    const toggleMenu = (label) => {
        setOpenMenus((prev) => ({ ...prev, [label]: !prev[label] }));
    };

    const handleLogout = () => {
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUser');
        navigate('/login');
    };

    return (
        <>
            <button
                className="mobile-menu-toggle"
                onClick={() => setIsMobileOpen(!isMobileOpen)}
                aria-label="Toggle menu"
            >
                ☰
            </button>

            {isMobileOpen && (
                <div className="sidebar-overlay" onClick={() => setIsMobileOpen(false)} />
            )}

            <aside className={`sidebar ${isMobileOpen ? 'sidebar-open' : ''}`}>
                <div className="sidebar-header">
                    <div className="sidebar-logo">
                        <div className="logo-placeholder">LOGO</div>
                        <span className="logo-text">HQ Inventory</span>
                    </div>
                    <div className="profile-block">
                        <span className="profile-name">{user?.name || '—'}</span>
                        <span className="profile-role">{user?.role || '—'}</span>
                    </div>
                </div>

                <nav className="sidebar-nav">
                    {navItems.map((item) => {
                        // --- Dropdown item ---
                        if (item.children) {
                            const visibleChildren = item.children.filter((child) =>
                                hasAccess(user, child.module)
                            );
                            if (visibleChildren.length === 0) return null; // no access to any child at all

                            const Icon = item.icon;
                            return (
                                <div key={item.label} className="nav-group">
                                    <button
                                        type="button"
                                        className={`nav-button nav-button-parent ${isChildActive(item) ? 'nav-button-active' : ''}`}
                                        onClick={() => toggleMenu(item.label)}
                                    >
                                        <Icon size={18} className="nav-icon" />
                                        <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
                                        {openMenus[item.label] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    </button>
                                    {openMenus[item.label] && (
                                        <div className="nav-submenu">
                                            {visibleChildren.map((child) => (
                                                <NavLink
                                                    key={child.path}
                                                    to={child.path}
                                                    onClick={() => setIsMobileOpen(false)}
                                                    className={({ isActive }) =>
                                                        `nav-button nav-subitem ${isActive ? 'nav-button-active' : ''}`
                                                    }
                                                >
                                                    {child.label}
                                                </NavLink>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        }

                        // --- Regular item ---
                        if (!hasAccess(user, item.module)) return null;
                        const Icon = item.icon;
                        return (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                onClick={() => setIsMobileOpen(false)}
                                className={({ isActive }) => `nav-button ${isActive ? 'nav-button-active' : ''}`}
                            >
                                <Icon size={18} className="nav-icon" />
                                <span>{item.label}</span>
                            </NavLink>
                        );
                    })}
                </nav>

                <div className="sidebar-footer">
                    <button className="footer-button" onClick={() => alert('Settings — coming soon')}>
                        Settings
                    </button>
                    <button className="footer-button footer-button-logout" onClick={handleLogout}>
                        Log Out
                    </button>
                </div>
            </aside>
        </>
    );
}