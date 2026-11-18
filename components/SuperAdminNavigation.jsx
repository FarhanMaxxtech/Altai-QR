// src/components/SuperAdminNavigation.jsx
import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import '../../src/styles/Navigation.css';

const navItems = [
    { path: '/superadmin/dashboard', label: 'Platform Dashboard' },
    {
        label: 'QR Generator',
        children: [
            { path: '/superadmin/qrcodes', label: 'Generate QR Codes' },
            { path: '/superadmin/qrcodes/history', label: 'History Generated QR' },
        ],
    },
    { path: '/superadmin/merchants', label: 'Merchant Management' },
];

export default function SuperAdminNavigation() {
    const navigate = useNavigate();
    const location = useLocation();

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
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="sidebar-logo">
                    <div className="logo-placeholder">LOGO</div>
                    <span className="logo-text">Super Admin</span>
                </div>
                <div className="profile-block">
                    <span className="profile-name">—</span>
                    <span className="profile-role">Super Admin</span>
                </div>
            </div>

            <nav className="sidebar-nav">
                {navItems.map((item) =>
                    item.children ? (
                        <div key={item.label} className="nav-group">
                            <button
                                type="button"
                                className={`nav-button nav-button-parent ${isChildActive(item) ? 'nav-button-active' : ''}`}
                                onClick={() => toggleMenu(item.label)}
                            >
                                <span>{item.label}</span>
                                {openMenus[item.label] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                            {openMenus[item.label] && (
                                <div className="nav-submenu">
                                    {item.children.map((child) => (
                                        <NavLink
                                            key={child.path}
                                            to={child.path}
                                            end
                                            className={({ isActive }) => `nav-button nav-subitem ${isActive ? 'nav-button-active' : ''}`}
                                        >
                                            {child.label}
                                        </NavLink>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            className={({ isActive }) => `nav-button ${isActive ? 'nav-button-active' : ''}`}
                        >
                            {item.label}
                        </NavLink>
                    )
                )}
            </nav>

            <div className="sidebar-footer">
                <button className="footer-button footer-button-logout" onClick={handleLogout}>
                    Log Out
                </button>
            </div>
        </aside>
    );
}