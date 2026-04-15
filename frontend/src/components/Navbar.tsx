import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ShieldCheck, LayoutDashboard, Upload, ScrollText, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const ROLE_LABELS: Record<string, string> = {
  checker: 'Checker',
  supervisor: 'Supervisor',
  compliance: 'Compliance',
  admin: 'Administrator',
};

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const navItems = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/upload', label: 'Upload', icon: Upload, end: false },
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
      <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <NavLink to="/" className="flex items-center gap-2.5 text-blue-700 hover:opacity-90">
          <ShieldCheck className="h-7 w-7 shrink-0" />
          <span className="hidden text-base font-bold tracking-tight sm:block">
            Trade&nbsp;Doc&nbsp;Validation
          </span>
        </NavLink>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User menu */}
        {user && (
          <div className="flex items-center gap-3">
            <div className="hidden flex-col items-end sm:flex">
              <span className="text-sm font-medium text-gray-900">{user.fullName}</span>
              <span className="text-xs text-gray-500">
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white uppercase">
              {user.fullName.charAt(0)}
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="flex items-center gap-1.5 rounded-md px-2 py-2 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:block">Sign out</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
