"""
LkSystem RBAC — API Views.

Endpoints:
    GET     /api/v1/rbac/permissions/           — list all permissions (grouped)
    GET     /api/v1/rbac/roles/                 — list roles
    POST    /api/v1/rbac/roles/                 — create role
    GET     /api/v1/rbac/roles/{id}/            — role detail
    PUT     /api/v1/rbac/roles/{id}/            — update role
    DELETE  /api/v1/rbac/roles/{id}/            — delete role (non-system only)
    GET     /api/v1/rbac/assignments/           — list user-role assignments
    POST    /api/v1/rbac/assignments/assign/    — assign role to user
    POST    /api/v1/rbac/assignments/revoke/    — revoke assignment
    GET     /api/v1/rbac/assignments/my/        — current user's assignments
    GET     /api/v1/rbac/assignments/user/{id}/ — assignments for a specific user
"""

from collections import defaultdict

from django.contrib.auth import get_user_model
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import AppPermission, Role, UserRole
from ..permissions import require_permission
from ..services import PermissionService
from .serializers import (
    AppPermissionSerializer,
    AssignRoleSerializer,
    RevokeRoleSerializer,
    RoleDetailSerializer,
    RoleListSerializer,
    UserRoleAssignmentSerializer,
)

User = get_user_model()


# ── Permissions endpoint ────────────────────────────────────────────────

class PermissionViewSet(viewsets.ViewSet):
    """
    Read-only endpoint that lists every AppPermission,
    optionally grouped by category.
    """
    permission_classes = [IsAuthenticated]

    def list(self, request):
        """Return permissions grouped by category."""
        qs = AppPermission.objects.all().order_by('category', 'codename')
        grouped: dict[str, list] = defaultdict(list)
        for perm in qs:
            grouped[perm.category].append(
                AppPermissionSerializer(perm).data
            )

        result = [
            {'category': cat, 'permissions': perms}
            for cat, perms in sorted(grouped.items())
        ]
        return Response(result)


# ── Role CRUD ───────────────────────────────────────────────────────────

class RoleViewSet(viewsets.ModelViewSet):
    """Full CRUD for roles."""
    permission_classes = [IsAuthenticated]
    filterset_fields = ['scope_type', 'company', 'is_system']
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'created_at']

    def get_queryset(self):
        user = self.request.user
        qs = Role.objects.select_related('company').prefetch_related(
            'permissions', 'assignments'
        )
        # Super-users see all roles
        if user.is_superuser:
            return qs
        # Others see platform roles + roles owned by their company
        return qs.filter(
            models_Q_company_null_or_own(user)
        )

    def get_serializer_class(self):
        if self.action in ('retrieve', 'create', 'update', 'partial_update'):
            return RoleDetailSerializer
        return RoleListSerializer

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [require_permission('view_roles')()]
        if self.action == 'create':
            return [require_permission('create_roles')()]
        if self.action == 'destroy':
            return [require_permission('delete_roles')()]
        return [require_permission('edit_roles')()]

    def _force_company_for_non_platform(self, serializer):
        """
        A CEO (company-scoped) creating or updating a role must not be able
        to write a platform-wide role or a role owned by a different company.
        Pin ``company`` and ``scope_type`` for them.
        """
        user = self.request.user
        if user.is_superuser:
            return  # superuser may craft any role
        if user.user_roles.filter(role__scope_type='platform').exists():
            return  # platform admin may craft any role too

        # Company-scoped user → lock to their tenant.
        current_company_id = getattr(user, 'current_company_id', None)
        if not current_company_id:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('You must belong to a company to manage roles.')

        # Override whatever the client sent; the backend is the source of truth.
        serializer.validated_data['company_id'] = current_company_id
        # Mark it as company-scoped (the only scope a CEO is allowed to mint).
        serializer.validated_data['scope_type'] = 'company'
        # System roles are platform-managed.
        serializer.validated_data['is_system'] = False

    def perform_create(self, serializer):
        self._force_company_for_non_platform(serializer)
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        # Block CEOs from re-tagging an existing role to another company /
        # promoting it to a platform role mid-life.
        instance = serializer.instance
        user = self.request.user
        if instance.is_system and not user.is_superuser:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('System roles cannot be edited.')
        self._force_company_for_non_platform(serializer)
        serializer.save()

    def perform_destroy(self, instance):
        if instance.is_system:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('System roles cannot be deleted.')
        # Defence-in-depth: don't let a CEO delete a role from another tenant
        # even if it leaked into the queryset somehow.
        user = self.request.user
        if not user.is_superuser:
            user_company_id = getattr(user, 'current_company_id', None)
            if instance.company_id and instance.company_id != user_company_id:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('You can only delete roles owned by your company.')
        instance.delete()


# ── Assignments ─────────────────────────────────────────────────────────

class AssignmentViewSet(viewsets.ViewSet):
    """Assign / revoke roles and list assignments."""
    permission_classes = [IsAuthenticated]

    def list(self, request):
        """List all assignments (filtered by requesting user's company)."""
        user = request.user
        qs = UserRole.objects.select_related(
            'user', 'role', 'company', 'brand', 'sales_channel',
        ).order_by('-assigned_at')

        if not user.is_superuser:
            qs = qs.filter(
                user__current_company=user.current_company,
            )

        serializer = UserRoleAssignmentSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='my')
    def my_assignments(self, request):
        """Return the requesting user's own assignments + permissions."""
        assignments = PermissionService.get_user_assignments(request.user)
        permissions = sorted(
            PermissionService.get_user_permissions(request.user)
        )
        roles = sorted(PermissionService.get_user_role_names(request.user))

        return Response({
            'roles': roles,
            'permissions': permissions,
            'assignments': UserRoleAssignmentSerializer(
                assignments, many=True
            ).data,
        })

    @action(
        detail=False,
        methods=['get'],
        url_path=r'user/(?P<user_id>\d+)',
    )
    def user_assignments(self, request, user_id=None):
        """Return assignments for a specific user."""
        try:
            target = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response(
                {'detail': 'User not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        assignments = PermissionService.get_user_assignments(target)
        permissions = sorted(
            PermissionService.get_user_permissions(target)
        )
        roles = sorted(PermissionService.get_user_role_names(target))

        return Response({
            'user_id': target.id,
            'roles': roles,
            'permissions': permissions,
            'assignments': UserRoleAssignmentSerializer(
                assignments, many=True
            ).data,
        })

    @action(detail=False, methods=['post'], url_path='assign')
    def assign_role(self, request):
        """Assign a role to a user at a specific scope."""
        ser = AssignRoleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        assignment, created = UserRole.objects.get_or_create(
            user_id=d['user_id'],
            role_id=d['role_id'],
            company_id=d.get('company_id'),
            brand_id=d.get('brand_id'),
            sales_channel_id=d.get('sales_channel_id'),
            defaults={'assigned_by': request.user},
        )

        if not created:
            return Response(
                {'detail': 'This role is already assigned at this scope.'},
                status=status.HTTP_409_CONFLICT,
            )

        return Response(
            UserRoleAssignmentSerializer(assignment).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=['post'], url_path='revoke')
    def revoke_role(self, request):
        """Revoke a user-role assignment by its ID."""
        ser = RevokeRoleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        UserRole.objects.filter(
            id=ser.validated_data['assignment_id']
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── Helper ──────────────────────────────────────────────────────────────

def models_Q_company_null_or_own(user):
    """Q filter: platform roles (company=NULL) OR user's company."""
    from django.db.models import Q

    q = Q(company__isnull=True)
    if user.current_company_id:
        q |= Q(company=user.current_company)
    return q
