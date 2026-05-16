import { useState } from 'react';
import { Bell, Check, Trash2, CheckCheck, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import notificationsData from '@/data/notifications.json';

// Mock notification types
type NotificationType = 'user' | 'system' | 'alert' | 'info';

interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  time: string;
  read: boolean;
  date: string;
}

export default function NotificationsPage() {
  // Load notifications from JSON file
  const [notifications, setNotifications] = useState<Notification[]>(
    notificationsData as Notification[]
  );

  const [filterType, setFilterType] = useState<string>('all');

  const unreadCount = notifications.filter(n => !n.read).length;

  // Filter notifications
  const filteredNotifications =
    filterType === 'all'
      ? notifications
      : notifications.filter(n => n.type === filterType);

  const unreadNotifications = filteredNotifications.filter(n => !n.read);
  const readNotifications = filteredNotifications.filter(n => n.read);

  // Mark notification as read
  const markAsRead = (id: number) => {
    setNotifications(
      notifications.map(n => (n.id === id ? { ...n, read: true } : n))
    );
  };

  // Mark all as read
  const markAllAsRead = () => {
    setNotifications(notifications.map(n => ({ ...n, read: true })));
  };

  // Delete notification
  const deleteNotification = (id: number) => {
    setNotifications(notifications.filter(n => n.id !== id));
  };

  // Clear all read notifications
  const clearAllRead = () => {
    setNotifications(notifications.filter(n => !n.read));
  };

  // Get notification type badge variant
  const getTypeBadge = (type: NotificationType) => {
    switch (type) {
      case 'user':
        return { variant: 'default' as const, label: 'User' };
      case 'system':
        return { variant: 'secondary' as const, label: 'System' };
      case 'alert':
        return { variant: 'destructive' as const, label: 'Alert' };
      case 'info':
        return { variant: 'outline' as const, label: 'Info' };
      default:
        return { variant: 'default' as const, label: 'Other' };
    }
  };

  // Notification card component
  const NotificationCard = ({
    notification,
  }: {
    notification: Notification;
  }) => {
    const typeBadge = getTypeBadge(notification.type);

    return (
      <Card
        className={`p-4 transition-all hover:shadow-md ${
          notification.read ? 'opacity-60' : 'border-primary/50'
        }`}
      >
        <div className="flex items-start gap-4">
          {/* Unread indicator */}
          {notification.read ? (
            <div className="size-2 mt-2 rounded-full bg-l-bg-3 dark:bg-d-bg-3" />
          ) : (
            <div className="size-2 mt-2 rounded-full bg-primary animate-pulse" />
          )}

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-base">
                  {notification.title}
                </h3>
                <Badge variant={typeBadge.variant} className="text-xs">
                  {typeBadge.label}
                </Badge>
              </div>
              <span className="text-xs text-l-text-3 dark:text-d-text-3 whitespace-nowrap">
                {notification.time}
              </span>
            </div>
            <p className="text-sm text-l-text-2 dark:text-d-text-2 mb-3">
              {notification.message}
            </p>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {!notification.read && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => markAsRead(notification.id)}
                  className="h-8 text-xs gap-1"
                >
                  <Check className="size-3" />
                  Mark as read
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteNotification(notification.id)}
                className="h-8 text-xs gap-1 text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Bell className="size-8 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-sm">
                {unreadCount} new
              </Badge>
            )}
          </div>
          <p className="text-l-text-2 dark:text-d-text-2 mt-2">
            Stay updated with your system activities
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={markAllAsRead}
            disabled={unreadCount === 0}
            className="gap-2"
          >
            <CheckCheck className="size-4" />
            Mark all read
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={clearAllRead}
            disabled={readNotifications.length === 0}
            className="gap-2"
          >
            <Trash2 className="size-4" />
            Clear read
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-l-text-3 dark:text-d-text-3" />
            <span className="text-sm font-medium">Filter by type:</span>
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="alert">Alert</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-sm text-l-text-3 dark:text-d-text-3">
            Showing {filteredNotifications.length} notification
            {filteredNotifications.length === 1 ? '' : 's'}
          </div>
        </div>
      </Card>

      {/* Notifications Tabs */}
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="all">
            All ({filteredNotifications.length})
          </TabsTrigger>
          <TabsTrigger value="unread">
            Unread ({unreadNotifications.length})
          </TabsTrigger>
          <TabsTrigger value="read">
            Read ({readNotifications.length})
          </TabsTrigger>
        </TabsList>

        {/* All Notifications */}
        <TabsContent value="all" className="space-y-4 mt-6">
          {filteredNotifications.length > 0 ? (
            filteredNotifications.map(notification => (
              <NotificationCard
                key={notification.id}
                notification={notification}
              />
            ))
          ) : (
            <Card className="p-12 text-center">
              <Bell className="size-12 mx-auto mb-4 text-l-text-3 dark:text-d-text-3" />
              <p className="text-l-text-2 dark:text-d-text-2">
                No notifications found
              </p>
            </Card>
          )}
        </TabsContent>

        {/* Unread Notifications */}
        <TabsContent value="unread" className="space-y-4 mt-6">
          {unreadNotifications.length > 0 ? (
            unreadNotifications.map(notification => (
              <NotificationCard
                key={notification.id}
                notification={notification}
              />
            ))
          ) : (
            <Card className="p-12 text-center">
              <CheckCheck className="size-12 mx-auto mb-4 text-green-500" />
              <p className="text-l-text-2 dark:text-d-text-2 font-medium mb-2">
                All caught up!
              </p>
              <p className="text-sm text-l-text-3 dark:text-d-text-3">
                You have no unread notifications
              </p>
            </Card>
          )}
        </TabsContent>

        {/* Read Notifications */}
        <TabsContent value="read" className="space-y-4 mt-6">
          {readNotifications.length > 0 ? (
            readNotifications.map(notification => (
              <NotificationCard
                key={notification.id}
                notification={notification}
              />
            ))
          ) : (
            <Card className="p-12 text-center">
              <Bell className="size-12 mx-auto mb-4 text-l-text-3 dark:text-d-text-3" />
              <p className="text-l-text-2 dark:text-d-text-2">
                No read notifications
              </p>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
