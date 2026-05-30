"""
LkSystem Notifications App - Views

A read + state-change API over the current user's inbox:

* ``GET    /api/v1/notifications/``                  paginated, filterable list
* ``GET    /api/v1/notifications/unread-count/``      fast indexed count
* ``POST   /api/v1/notifications/{id}/mark-read/``    mark one inbox item read
* ``POST   /api/v1/notifications/mark-all-read/``     bulk mark all read

Every query is scoped to ``request.user`` so a user can only ever see or mutate
their own inbox rows — there is no way to read or touch another user's state.
"""

from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.filters import OrderingFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from core.pagination import StandardPagination

from apps.notifications.filters import NotificationFilter
from apps.notifications.models import NotificationRecipient
from apps.notifications.serializers import NotificationListSerializer


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """The current user's notification inbox."""

    permission_classes = [IsAuthenticated]
    serializer_class = NotificationListSerializer
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_class = NotificationFilter
    ordering_fields = ['created_at']
    ordering = ['-created_at']

    def get_queryset(self):
        # drf-spectacular instantiates the view with an AnonymousUser during
        # schema generation; short-circuit so it can introspect the serializer
        # without running the user-scoped filter (which would raise on the
        # AnonymousUser pk and drop this endpoint from the generated schema).
        if getattr(self, 'swagger_fake_view', False):
            return NotificationRecipient.objects.none()
        # Per-user scope is the whole tenant-safety story for reads: a row only
        # exists for users the NotificationService fanned the event out to.
        return (
            NotificationRecipient.objects
            .filter(user=self.request.user)
            .select_related('notification', 'notification__created_by')
        )

    @action(detail=False, methods=['get'], url_path='unread-count')
    def unread_count(self, request):
        """Cheap count over the ``(user, is_read)`` index — never loads rows."""
        count = NotificationRecipient.objects.filter(
            user=request.user, is_read=False,
        ).count()
        return Response({'unread': count})

    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, pk=None):
        """Mark a single inbox item read (idempotent, current user only)."""
        qs = NotificationRecipient.objects.filter(pk=pk, user=request.user)
        if not qs.exists():
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        qs.filter(is_read=False).update(is_read=True, read_at=timezone.now())
        return Response({'id': int(pk), 'is_read': True})

    @action(detail=False, methods=['post'], url_path='mark-all-read')
    def mark_all_read(self, request):
        """Bulk mark every unread item read in a single UPDATE (current user only)."""
        updated = NotificationRecipient.objects.filter(
            user=request.user, is_read=False,
        ).update(is_read=True, read_at=timezone.now())
        return Response({'updated': updated})
