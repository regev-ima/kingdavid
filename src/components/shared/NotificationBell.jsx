import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Bell, Check, Trash2, Settings } from "lucide-react";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { formatDistanceToNow } from '@/lib/safe-date-fns';
import { he } from 'date-fns/locale';

export default function NotificationBell({ user }) {
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user?.id) return;

    const fetchNotifications = async () => {
      try {
        const allNotifs = await base44.entities.Notification.filter(
          { user_id: user.id },
          '-created_date',
          50
        );
        setNotifications(allNotifs);
        setUnreadCount(allNotifs.filter(n => !n.is_read).length);
      } catch (error) {
        console.error('Error fetching notifications:', error);
      }
    };

    fetchNotifications();

    // Subscribe to real-time updates
    const unsubscribe = base44.entities.Notification.subscribe((event) => {
      if (event.data?.user_id === user.id) {
        if (event.type === 'create') {
          setNotifications(prev => [event.data, ...prev]);
          setUnreadCount(prev => prev + 1);
        } else if (event.type === 'update') {
          setNotifications(prev => prev.map(n => n.id === event.id ? event.data : n));
          if (event.data.is_read) {
            setUnreadCount(prev => Math.max(0, prev - 1));
          }
        } else if (event.type === 'delete') {
          setNotifications(prev => prev.filter(n => n.id !== event.id));
          setUnreadCount(prev => Math.max(0, prev - 1));
        }
      }
    });

    return () => unsubscribe();
  }, [user?.id]);

  const handleMarkAsRead = async (notificationId, e) => {
    e.stopPropagation();
    try {
      await base44.entities.Notification.update(notificationId, { is_read: true });
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleDelete = async (notificationId, e) => {
    e.stopPropagation();
    try {
      await base44.entities.Notification.delete(notificationId);
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const unreadNotifs = notifications.filter(n => !n.is_read);
      await Promise.all(
        unreadNotifs.map(n => base44.entities.Notification.update(n.id, { is_read: true }))
      );
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-primary';
      case 'low': return 'bg-muted-foreground';
      default: return 'bg-primary';
    }
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 h-4 w-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[380px] p-0">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-lg">התראות</h3>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleMarkAllAsRead}
                className="text-xs"
              >
                סמן הכל כנקרא
              </Button>
            )}
            <Link to={createPageUrl('NotificationSettings')} onClick={() => setIsOpen(false)}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
        
        <ScrollArea className="h-[400px]">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-2 text-muted-foreground/30" />
              <p>אין התראות</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-4 hover:bg-muted/50 transition-colors ${
                    !notification.is_read ? 'bg-primary/[0.03]' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`h-2 w-2 rounded-full mt-2 flex-shrink-0 ${getPriorityColor(notification.priority)}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className={`text-sm font-medium ${!notification.is_read ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {notification.title}
                        </h4>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!notification.is_read && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={(e) => handleMarkAsRead(notification.id, e)}
                            >
                              <Check className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-red-500"
                            onClick={(e) => handleDelete(notification.id, e)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">{notification.message}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground/70">
                          {formatDistanceToNow(new Date(notification.created_date), { 
                            addSuffix: true,
                            locale: he 
                          })}
                        </span>
                        {notification.link && (
                          <Link 
                            to={notification.link} 
                            onClick={() => {
                              setIsOpen(false);
                              if (!notification.is_read) {
                                handleMarkAsRead(notification.id, { stopPropagation: () => {} });
                              }
                            }}
                          >
                            <Button variant="link" size="sm" className="h-auto p-0 text-xs">
                              {notification.link_label || 'צפה'}
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}