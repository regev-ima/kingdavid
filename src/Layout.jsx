import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { useImpersonation } from "@/components/shared/ImpersonationContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  Users,
  FileText,
  ShoppingCart,
  Headphones,
  Truck,
  RotateCcw,
  Factory,
  DollarSign,
  Package,
  BarChart3,
  Settings,
  LogOut,
  Search,
  Menu,
  X,
  ChevronDown,
  Crown,
  Phone,
  CheckSquare,

  RefreshCw
} from "lucide-react";
import GlobalSearch from "@/components/shared/GlobalSearch";

import { ImpersonationProvider } from "@/components/shared/ImpersonationContext";
import NotificationBell from "@/components/shared/NotificationBell";

import VoiceCenterCallPopup from "@/components/call/VoiceCenterCallPopup";
import UserAvatar from "@/components/shared/UserAvatar";

// Navigation organized by role priority
const navigationByRole = {
  admin: [
    { name: 'דשבורד כללי', href: 'Dashboard', icon: LayoutDashboard },
    { name: 'לידים', href: 'Leads', icon: Users },
    { name: 'לקוחות', href: 'Customers', icon: Crown },
    { name: 'משימות מכירה', href: 'SalesTasks', icon: CheckSquare },
    { name: 'הזמנות', href: 'Orders', icon: ShoppingCart },
    { name: 'הצעות מחיר', href: 'Quotes', icon: FileText },
    { name: 'מפעל', href: 'Factory', icon: Factory },
    { name: 'משלוחים', href: 'Deliveries', icon: Truck },
    { name: 'מלאי', href: 'Inventory', icon: Package },
    { name: 'שירות לקוחות', href: 'Support', icon: Headphones },
    { name: 'החזרות', href: 'Returns', icon: RotateCcw },
    { name: 'קטלוג מוצרים', href: 'ProductsNew', icon: Package },
    { name: 'ניתוח שיחות', href: 'CallAnalytics', icon: Phone },
    { name: 'דוחות תפעוליים', href: 'OperationalReports', icon: BarChart3 },
    { name: 'כספים', href: 'Finance', icon: DollarSign },
    { name: 'נציגים', href: 'Representatives', icon: Users },
    { name: 'שיווק', href: 'Marketing', icon: BarChart3 },
    { name: 'דפי נחיתה', href: 'LandingPages', icon: BarChart3 },
    { name: 'תוספות להזמנות', href: 'ExtraCharges', icon: DollarSign },
    { name: 'עדכון המוני', href: 'BulkUpdate', icon: RefreshCw },
    { name: 'הגדרות', href: 'Settings', icon: Settings },
  ],
  sales_user: [
    { name: 'דשבורד מכירות', href: 'SalesDashboard', icon: BarChart3 },
    { name: 'לידים', href: 'Leads', icon: Users },
    { name: 'לקוחות', href: 'Customers', icon: Crown },
    { name: 'משימות מכירה', href: 'SalesTasks', icon: CheckSquare },
    { name: 'הזמנות', href: 'Orders', icon: ShoppingCart },
    { name: 'הצעות מחיר', href: 'Quotes', icon: FileText },
  ],
  factory_user: [
    { name: 'דשבורד מפעל', href: 'FactoryDashboard', icon: LayoutDashboard },
    { name: 'מפעל', href: 'Factory', icon: Factory },
    { name: 'הזמנות', href: 'Orders', icon: ShoppingCart },
    { name: 'משלוחים', href: 'Deliveries', icon: Truck },
    { name: 'מלאי', href: 'Inventory', icon: Package },
    { name: 'קטלוג מוצרים', href: 'ProductsNew', icon: Package },
    { name: 'דוחות תפעוליים', href: 'OperationalReports', icon: BarChart3 },
    { name: 'שירות לקוחות', href: 'Support', icon: Headphones },
    { name: 'החזרות', href: 'Returns', icon: RotateCcw },
  ]
};

function LayoutContent({ children, currentPageName }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const [sdkLoaded, setSdkLoaded] = useState(false);
  const { isImpersonating, impersonatedRep, originalAdmin, stopImpersonation, getEffectiveUser } = useImpersonation();

  // Cache user data - won't refetch on every page change
  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (user && user.role !== 'admin') {
      base44.functions.invoke('claimPendingLeads').catch(() => {});
    }
  }, [user?.id]);

  // Request push notification permission
  useEffect(() => {
    if (user?.id) {
      import('@/lib/firebase').then(({ requestNotificationPermission, onForegroundMessage }) => {
        requestNotificationPermission(user.id);
        onForegroundMessage((payload) => {
          const { title, body } = payload.notification || {};
          if (title) {
            // Show in-app toast for foreground messages
            import('sonner').then(({ toast }) => {
              toast(title, { description: body });
            });
          }
        });
      }).catch(() => {});
    }
  }, [user?.id]);

  useEffect(() => {
    // Load VoiceCenter Events SDK
    if (!window.EventsSDK) {
      const script = document.createElement('script');
      script.src = 'https://cdn.voicenter.co/cdn/events-sdk/voicenter-events-sdk.umd.js';
      script.async = true;
      script.onload = () => {
        setSdkLoaded(true);
      };
      script.onerror = () => {
        console.error('Failed to load VoiceCenter SDK');
      };
      document.head.appendChild(script);
    } else {
      setSdkLoaded(true);
    }
  }, []);

  const handleLogout = async () => {
    await base44.auth.logout();
    window.location.href = '/login';
  };

  // Push notification state
  const [showNotifBanner, setShowNotifBanner] = useState(false);

  useEffect(() => {
    if (user?.id && 'Notification' in window && Notification.permission === 'default') {
      setShowNotifBanner(true);
    }
  }, [user?.id]);

  const handleEnableNotifications = async () => {
    try {
      const { requestNotificationPermission } = await import('@/lib/firebase');
      await requestNotificationPermission(user?.id);
      setShowNotifBanner(false);
    } catch (err) {
      console.error('Push error:', err);
      setShowNotifBanner(false);
    }
  };

  const effectiveUser = getEffectiveUser(user);

  // Determine user type based on role and department
  let userRole = 'sales_user';
  if (effectiveUser?.role === 'admin') {
    userRole = 'admin';
  } else if (effectiveUser?.department === 'factory') {
    userRole = 'factory_user';
  } else {
    userRole = 'sales_user';
  }
  
  // Get navigation based on role
  const filteredNav = user ? (navigationByRole[userRole] || navigationByRole.sales_user) : [];

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {showNotifBanner && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-slate-900 text-white p-4 rounded-xl shadow-2xl z-[70] flex items-center gap-3">
          <div className="flex-1">
            <p className="font-semibold text-sm">הפעל התראות</p>
            <p className="text-xs text-slate-400">קבל עדכונים על לידים חדשים ומשימות</p>
          </div>
          <button
            onClick={handleEnableNotifications}
            className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold text-sm px-4 py-2 rounded-lg whitespace-nowrap"
          >
            הפעל
          </button>
          <button
            onClick={() => setShowNotifBanner(false)}
            className="text-slate-500 hover:text-white text-lg"
          >
            ✕
          </button>
        </div>
      )}
      {isImpersonating && (
        <div className="fixed top-0 left-0 right-0 bg-amber-500 text-white px-4 py-2 z-[60] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4" />
            <span className="font-medium">
              אתה מתחזה כעת לנציג: {impersonatedRep?.full_name} ({impersonatedRep?.email})
            </span>
          </div>
          <Button
            onClick={stopImpersonation}
            variant="ghost"
            size="sm"
            className="text-white hover:bg-amber-600"
          >
            <X className="h-4 w-4 me-1" />
            צא מהתחזות
          </Button>
        </div>
      )}
      <style>{`
        /* Scrollbar styling */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: hsl(24 6% 78%); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: hsl(24 6% 60%); }
      `}</style>

      {/* Top Navigation Bar */}
      <header className={`fixed left-0 right-0 h-16 bg-white/80 glass border-b border-border/50 shadow-sm z-50 flex items-center justify-between px-6 ${isImpersonating ? 'top-10' : 'top-0'}`}>
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden text-foreground/80"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          
          <Link to={createPageUrl('Dashboard')} className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg gradient-brand shadow-primary-glow flex items-center justify-center">
              <Crown className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-foreground font-heading hidden sm:block">KING DAVID</span>
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSearchOpen(true)}
            className="text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-lg"
          >
            <Search className="h-5 w-5" />
          </Button>

          <NotificationBell user={effectiveUser} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 pr-2">
                <UserAvatar user={effectiveUser} size="sm" />
                <span className="hidden md:block text-sm font-medium">{effectiveUser?.full_name || 'משתמש'}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground/70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <div className="px-3 py-2">
                <p className="text-sm font-medium">{effectiveUser?.full_name}</p>
                <p className="text-xs text-muted-foreground">{effectiveUser?.email}</p>
                <p className="text-xs text-primary mt-1">
                  {userRole === 'admin' ? 'מנהל מערכת' : userRole === 'sales_user' ? 'נציג מכירות' : 'נציג מפעל'}
                </p>
                {isImpersonating && (
                  <p className="text-xs text-amber-600 mt-1 font-medium">מצב התחזות</p>
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to={createPageUrl('Settings')} className="cursor-pointer">
                  <Settings className="h-4 w-4 me-2" />
                  הגדרות
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-600 cursor-pointer">
                <LogOut className="h-4 w-4 me-2" />
                התנתק
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Sidebar */}
      <aside className={`
        fixed right-0 bottom-0 w-64 gradient-sidebar z-40 
        transition-transform duration-300 overflow-y-auto
        ${isImpersonating ? 'top-[104px]' : 'top-16'}
        ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
      `}>
        <nav className="p-4 space-y-1">
          {filteredNav.map((item) => {
            const isActive = currentPageName === item.href;
            return (
              <Link
                key={item.name}
                to={createPageUrl(item.href)}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-sm font-medium
                  ${isActive
                    ? 'bg-sidebar-primary/20 text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                  }
                `}
              >
                <item.icon className={`h-5 w-5 flex-shrink-0 ${isActive ? 'text-sidebar-primary-foreground' : 'text-sidebar-foreground/50'}`} />
                <span className="truncate">{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className={`lg:pr-64 min-h-screen ${isImpersonating ? 'pt-[104px]' : 'pt-16'}`}>
        <div className="p-6 lg:p-8">
          {children}
        </div>
      </main>

      {/* Global Search Modal */}
      <GlobalSearch
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        user={effectiveUser}
      />
      


      {/* VoiceCenter Call Popup */}
      {sdkLoaded && <VoiceCenterCallPopup />}
      </div>
      );
      }

export default function Layout({ children, currentPageName }) {
  return (
    <ImpersonationProvider>
      <LayoutContent children={children} currentPageName={currentPageName} />
    </ImpersonationProvider>
  );
}