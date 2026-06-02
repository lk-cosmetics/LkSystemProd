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
        # Platform admin: scoped to the actively-selected company (workspace
        # context) so the Roles page shows only that company's roles; with no
        # company selected they see every role (global mode, for managing
        # templates and the platform Super Admin role).
        #
        # Exception: when an explicit ``?company=`` filter is supplied (e.g. the
        # Add-User dialog asking for a specific company's roles), honour it and
        # let DjangoFilterBackend narrow, so a Super Admin can pick any
        # company's roles regardless of their current workspace.
        if PermissionService.is_platform_admin(user):
            if self.request.query_params.get('company'):
                result = qs
            else:
                current_company_id = getattr(user, 'current_company_id', None)
                result = qs.filter(company_id=current_company_id) if current_company_id else qs
        else:
            # A company-scoped user sees their own company's roles PLUS the
            # global default/custom roles a Super Admin published for everyone
            # (company IS NULL, non-system). The global business TEMPLATES
            # (is_system, company NULL) stay hidden because each company already
            # has its own provisioned copy of them — never another tenant's role.
            current_company_id = getattr(user, 'current_company_id', None)
            if not current_company_id:
                return qs.none()
            from django.db.models import Q
            result = qs.filter(
                Q(company_id=current_company_id)
                | Q(company__isnull=True, is_system=False)
            )

        # ``?assignable=true`` → only the roles the caller may actually grant:
        # within their permission ceiling, and (for a non-platform admin) never a
        # platform-scoped role. This lets the Add-User / Invite role dropdowns
        # show only roles at or below the caller's level instead of offering
        # higher roles that would 403 on submit. The backend assignment paths
        # still enforce the ceiling — this is UX, not the security boundary.
        if (self.request.query_params.get('assignable', '').lower() == 'true'
                and not PermissionService.is_platform_admin(user)):
            from apps.rbac.provisioning import permission_ceiling
            ceiling = permission_ceiling(user)  # None == unrestricted
            if ceiling is not None:
                result = result.exclude(scope_type='platform')
                assignable_ids = [
                    r.id for r in result
                    if set(r.permissions.values_list('codename', flat=True)) <= ceiling
                ]
                result = result.filter(id__in=assignable_ids)
        return result

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

    def _enforce_permission_ceiling(self, serializer):
        """
        A non-platform actor may not grant a permission they do not hold.
        Blocks privilege escalation through role creation / editing.
        """
        requested = [
            p.codename for p in serializer.validated_data.get('permissions', [])
        ]
        from apps.rbac.provisioning import assert_within_ceiling
        assert_within_ceiling(self.request.user, requested)

    def _scope_platform_admin_role(self, serializer):
        """
        When a Super Admin creates a role while focused on a company
        (workspace context), the new role belongs to THAT company unless they
        explicitly asked for a platform role. Without this a Super Admin would
        accidentally mint a global role that shows up for every company.
        """
        user = self.request.user
        if not PermissionService.is_platform_admin(user):
            return
        # ``is_global`` truthy → a GLOBAL default/custom role (company=None),
        # visible to every company; never auto-tag it to the active company.
        if str(self.request.data.get('is_global', '')).lower() in ('1', 'true', 'yes'):
            serializer.validated_data['company'] = None
            serializer.validated_data.pop('company_id', None)
            return
        if serializer.validated_data.get('scope_type') == 'platform':
            return  # an explicit, intentional platform role
        has_company = (
            serializer.validated_data.get('company')
            or serializer.validated_data.get('company_id')
        )
        current_company_id = getattr(user, 'current_company_id', None)
        if current_company_id and not has_company:
            serializer.validated_data['company_id'] = current_company_id

    def perform_create(self, serializer):
        self._force_company_for_non_platform(serializer)
        self._scope_platform_admin_role(serializer)
        self._enforce_permission_ceiling(serializer)
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        # Block CEOs from re-tagging an existing role to another company /
        # promoting it to a platform role mid-life.
        instance = serializer.instance
        user = self.request.user
        if instance.is_system and not user.is_superuser:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('System roles cannot be edited.')
        # A CEO can only edit a role owned by their own company — never a global
        # default role (platform-admin managed) nor another tenant's role.
        if not PermissionService.is_platform_admin(user):
            from rest_framework.exceptions import PermissionDenied
            user_company_id = getattr(user, 'current_company_id', None)
            if instance.company_id is None:
                raise PermissionDenied(
                    'Global default roles can only be edited by a platform administrator.'
                )
            if instance.company_id != user_company_id:
                raise PermissionDenied(
                    'You can only edit roles owned by your company.'
                )
        self._force_company_for_non_platform(serializer)
        self._enforce_permission_ceiling(serializer)
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
    """Assign / revoke roles and list assignments.

    Authorisation rules (enforced server-side, never trust the client):

    * Reading or mutating assignments requires the ``can_assign_roles``
      permission (a platform admin / Django superuser always passes).
    * A non-platform actor is confined to their own company. They cannot
      see, assign or revoke roles for users of another company, cannot
      assign a platform-scoped role, cannot assign a role owned by another
      company, and cannot target a scope (company/brand/channel) outside
      their own company.
    """
    permission_classes = [IsAuthenticated]

    # ── Authorisation helpers ───────────────────────────────────────────

    def _require_assign_permission(self, user):
        if PermissionService.is_platform_admin(user):
            return
        has = PermissionService.has_permission(
            user, 'can_assign_roles',
            company=getattr(user, 'current_company', None),
        )
        if not has:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(
                'You do not have permission to manage role assignments.'
            )

    def _assert_target_in_company(self, actor, target_user):
        """A non-platform actor may only touch users in their own company."""
        if PermissionService.is_platform_admin(actor):
            return
        actor_company = getattr(actor, 'current_company_id', None)
        if not actor_company or target_user.current_company_id != actor_company:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(
                'You can only manage users that belong to your own company.'
            )

    def _assert_role_assignable(self, actor, role):
        """
        A non-platform actor may only assign a role **owned by their own
        company**. This blocks platform roles (Super Admin), cross-company
        roles, and the global business templates (company=NULL) that exist
        only for provisioning. Tenant isolation is therefore strict.
        """
        if PermissionService.is_platform_admin(actor):
            return
        from rest_framework.exceptions import PermissionDenied
        if role.scope_type == 'platform':
            raise PermissionDenied(
                'Only a platform administrator can assign platform roles.'
            )
        actor_company = getattr(actor, 'current_company_id', None)
        if not actor_company:
            raise PermissionDenied('You must belong to a company to assign roles.')
        # A company-owned role must match the actor's company; a GLOBAL role
        # (company IS NULL, non-platform) is assignable by every company,
        # subject to the permission ceiling enforced at the call site.
        if role.company_id is not None and role.company_id != actor_company:
            raise PermissionDenied(
                'You can only assign roles that belong to your company.'
            )

    def _assert_scope_in_company(self, actor, *, company_id, brand_id, sales_channel_id):
        """Ensure every scope FK resolves inside the actor's own company."""
        if PermissionService.is_platform_admin(actor):
            return
        from rest_framework.exceptions import PermissionDenied
        actor_company = getattr(actor, 'current_company_id', None)
        if not actor_company:
            raise PermissionDenied('You must belong to a company to assign roles.')

        if company_id and int(company_id) != actor_company:
            raise PermissionDenied('Scope company is outside your company.')

        if brand_id:
            from apps.brands.models import Brand
            if not Brand.objects.filter(
                id=brand_id, company_id=actor_company
            ).exists():
                raise PermissionDenied('Scope brand is outside your company.')

        if sales_channel_id:
            from apps.sales_channels.models import SalesChannel
            if not SalesChannel.objects.filter(
                id=sales_channel_id, brand__company_id=actor_company
            ).exists():
                raise PermissionDenied('Scope channel is outside your company.')

    def list(self, request):
        """List assignments (a non-platform actor sees only their company)."""
        user = request.user
        self._require_assign_permission(user)

        qs = UserRole.objects.select_related(
            'user', 'role', 'company', 'brand', 'sales_channel',
        ).order_by('-assigned_at')

        if not PermissionService.is_platform_admin(user):
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
        """Return assignments for a specific user (company-scoped)."""
        self._require_assign_permission(request.user)
        try:
            target = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response(
                {'detail': 'User not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Never disclose another company's user to a non-platform actor.
        self._assert_target_in_company(request.user, target)

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
        """Assign a role to a user at a specific scope (authorised + scoped)."""
        actor = request.user
        self._require_assign_permission(actor)

        ser = AssignRoleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        target = User.objects.get(id=d['user_id'])
        role = Role.objects.get(id=d['role_id'])

        # Server-side authorisation — defence in depth, never trust the client.
        self._assert_target_in_company(actor, target)
        self._assert_role_assignable(actor, role)
        self._assert_scope_in_company(
            actor,
            company_id=d.get('company_id'),
            brand_id=d.get('brand_id'),
            sales_channel_id=d.get('sales_channel_id'),
        )
        # Privilege ceiling: cannot hand out a role more powerful than yourself.
        if not PermissionService.is_platform_admin(actor):
            from apps.rbac.provisioning import assert_within_ceiling
            assert_within_ceiling(
                actor, role.permissions.values_list('codename', flat=True)
            )

        assignment, created = UserRole.objects.get_or_create(
            user_id=d['user_id'],
            role_id=d['role_id'],
            company_id=d.get('company_id'),
            brand_id=d.get('brand_id'),
            sales_channel_id=d.get('sales_channel_id'),
            defaults={'assigned_by': actor},
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
        """Revoke a user-role assignment by its ID (authorised + scoped)."""
        actor = request.user
        self._require_assign_permission(actor)

        ser = RevokeRoleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        assignment = (
            UserRole.objects.select_related('user', 'role')
            .filter(id=ser.validated_data['assignment_id'])
            .first()
        )
        if assignment is None:
            return Response(status=status.HTTP_204_NO_CONTENT)

        if not PermissionService.is_platform_admin(actor):
            from rest_framework.exceptions import PermissionDenied
            # A non-platform actor cannot revoke a platform-level assignment.
            if assignment.role.scope_type == 'platform' or (
                assignment.company_id is None
                and assignment.brand_id is None
                and assignment.sales_channel_id is None
            ):
                raise PermissionDenied(
                    'You cannot revoke a platform-level assignment.'
                )
            # The target user must belong to the actor's company.
            self._assert_target_in_company(actor, assignment.user)

        assignment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'], url_path='set-role')
    def set_role(self, request):
        """Replace a user's role with a single new one (Edit User → Role).

        Removes the target's existing assignable (company-owned, non-platform)
        role assignments and creates the new role at the scope it implies
        (company / brand / channel), reusing the same authorisation guards as
        ``assign_role`` plus a privilege guard so a user more powerful than the
        actor can never be re-roled.
        """
        from rest_framework.exceptions import PermissionDenied
        from django.db import transaction
        from apps.rbac.services import scope_kwargs_for_role

        actor = request.user
        self._require_assign_permission(actor)

        try:
            target = User.objects.get(id=request.data.get('user_id'))
            role = Role.objects.get(id=request.data.get('role_id'))
        except (User.DoesNotExist, Role.DoesNotExist):
            return Response({'detail': 'User or role not found.'}, status=status.HTTP_404_NOT_FOUND)

        self._assert_target_in_company(actor, target)
        self._assert_role_assignable(actor, role)
        if not PermissionService.is_platform_admin(actor):
            from apps.rbac.provisioning import assert_within_ceiling
            # Cannot grant a role more powerful than the actor holds.
            assert_within_ceiling(actor, role.permissions.values_list('codename', flat=True))
            # Cannot re-role a user whose privileges already exceed the actor's.
            if PermissionService.is_platform_admin(target):
                raise PermissionDenied("You cannot change a platform administrator's role.")
            if not (PermissionService.get_user_permissions(target)
                    <= PermissionService.get_user_permissions(actor)):
                raise PermissionDenied(
                    'You cannot change the role of a user whose permissions exceed your own.'
                )

        # Resolve scope ingredients from the role + the target's own data so the
        # caller need not re-pick a brand/sales-point that the user already has.
        company = target.current_company
        scope = (role.scope_type or '').lower()
        brands = list(target.allowed_brands.all()) if scope in ('brand', 'channel') else []
        sales_channel = getattr(target, 'assigned_sales_channel', None) if scope == 'channel' else None
        if scope == 'brand' and not brands:
            return Response(
                {'detail': f'{role.name} is brand-scoped — give the user brand access first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if scope == 'channel' and not sales_channel:
            return Response(
                {'detail': f'{role.name} works at a single sales point — assign the user a sales point first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            # Clear the target's current assignable roles so they end with
            # exactly the new one. A non-platform actor only touches roles owned
            # by their company and never platform-level assignments.
            existing = UserRole.objects.filter(user=target).exclude(
                role__scope_type='platform'
            )
            if not PermissionService.is_platform_admin(actor):
                # The user's effective role lives either as a per-company copy in
                # the actor's company or as a global business template; replace
                # both, but never another tenant's or a platform assignment.
                from django.db.models import Q
                existing = existing.filter(
                    Q(role__company_id=actor.current_company_id)
                    | Q(role__company__isnull=True)
                )
            existing.delete()

            if scope == 'brand' and len(brands) > 1:
                for brand in brands:
                    UserRole.objects.create(
                        user=target, role=role, company=company, brand=brand,
                        assigned_by=actor,
                    )
            else:
                kwargs = scope_kwargs_for_role(
                    role, company=company, brands=brands, sales_channel=sales_channel,
                )
                UserRole.objects.create(user=target, role=role, assigned_by=actor, **kwargs)

        return Response({
            'detail': 'Role updated.',
            'roles': sorted(PermissionService.get_user_role_names(target)),
        })
