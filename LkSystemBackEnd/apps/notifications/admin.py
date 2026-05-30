"""LkSystem Notifications App - Django admin."""

from django.contrib import admin

from apps.notifications.models import Notification, NotificationRecipient


class NotificationRecipientInline(admin.TabularInline):
    model = NotificationRecipient
    extra = 0
    can_delete = False
    readonly_fields = ('user', 'is_read', 'read_at', 'category', 'priority', 'created_at')

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('id', 'category', 'priority', 'title', 'company', 'target_type', 'created_at')
    list_filter = ('category', 'priority', 'target_type', 'created_at')
    search_fields = ('title', 'body', 'entity_type', 'entity_id')
    readonly_fields = ('created_at',)
    date_hierarchy = 'created_at'
    inlines = [NotificationRecipientInline]
    raw_id_fields = ('created_by', 'company')


@admin.register(NotificationRecipient)
class NotificationRecipientAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'notification', 'category', 'priority', 'is_read', 'created_at')
    list_filter = ('is_read', 'category', 'priority', 'created_at')
    search_fields = ('user__matricule', 'user__email', 'notification__title')
    raw_id_fields = ('notification', 'user')
    readonly_fields = ('notification', 'user', 'category', 'priority', 'created_at', 'read_at')
    date_hierarchy = 'created_at'
