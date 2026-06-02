"""
LkSystem — Workspace switching API.

    GET  /api/v1/auth/workspaces/        — companies + brands the user may use
    POST /api/v1/auth/switch-workspace/  — switch active company / brand

The switch is validated server-side by ``WorkspaceService`` and returns a
freshly minted JWT pair whose claims reflect the new workspace, plus the
updated user payload. The frontend swaps the tokens and purges its cache.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema, OpenApiResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.rbac.services import PermissionService
from apps.users.workspace import WorkspaceService, WorkspaceError


def _build_user_payload(user) -> dict:
    """Mirror the login payload so the frontend can swap state in place."""
    roles = PermissionService.get_user_role_names(user)
    perms = sorted(PermissionService.get_user_permissions(user))
    return {
        'id': user.id,
        'matricule': user.matricule,
        'email': user.email,
        'full_name': user.get_full_name(),
        'role': roles[0] if roles else None,
        'roles': roles,
        'permissions': perms,
        'is_superuser': user.is_superuser,
        'can_switch_brands': 'switch_brands' in perms,
        'company_id': user.current_company_id,
        'company_name': user.current_company.name if user.current_company_id else None,
        'current_brand_id': user.current_brand_id,
        'allowed_brand_ids': user.get_allowed_brand_ids(),
    }


class WorkspacesView(APIView):
    """GET /api/v1/auth/workspaces/ — the switcher's data source."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=['Auth'],
        summary='List switchable workspaces',
        description='Companies (and their brands) the current user may switch '
                    'into, derived from RBAC role assignments.',
        responses={200: OpenApiResponse(description='Workspace list')},
    )
    def get(self, request):
        from apps.brands.models import Brand

        user = request.user
        companies = list(WorkspaceService.switchable_companies(user).order_by('name'))

        # Resolve the allowed brand ids per company (lightweight id queries),
        # then fetch every brand object in ONE query and group in Python. This
        # avoids an N+1 over companies (previously one Brand fetch per company,
        # which grows with the number of companies a Super Admin can see).
        allowed_by_company = {
            company.id: WorkspaceService.switchable_brand_ids(user, company.id)
            for company in companies
        }
        all_brand_ids: set[int] = set().union(
            *allowed_by_company.values()
        ) if allowed_by_company else set()

        brands_by_company: dict[int, list] = {}
        if all_brand_ids:
            for brand in Brand.objects.filter(id__in=all_brand_ids).order_by('name'):
                brands_by_company.setdefault(brand.company_id, []).append(brand)

        data = [
            {
                'id': company.id,
                'name': company.name,
                'abbreviation': company.abbreviation,
                'logo': company.logo.url if company.logo else None,
                'is_active_company': company.id == user.current_company_id,
                'brands': [
                    {
                        'id': b.id,
                        'name': b.name,
                        'is_active_brand': b.id == user.current_brand_id,
                    }
                    for b in brands_by_company.get(company.id, [])
                ],
            }
            for company in companies
        ]

        return Response({
            'active_company_id': user.current_company_id,
            'active_brand_id': user.current_brand_id,
            'workspaces': data,
        })


class SwitchWorkspaceView(APIView):
    """POST /api/v1/auth/switch-workspace/ — validate + apply + re-issue JWT."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=['Auth'],
        summary='Switch active workspace',
        description='Switch the active company and/or brand. Body: '
                    '`{ "company_id": <int?>, "brand_id": <int|null?> }`. '
                    'Returns fresh tokens and the updated user payload.',
    )
    def post(self, request):
        user = request.user
        company_id = request.data.get('company_id')
        # A missing or null brand_id means "whole company" (clear brand focus).
        # We never carry a brand from a previous company across a switch.
        brand_id = request.data.get('brand_id')

        try:
            WorkspaceService.switch(
                user,
                company_id=int(company_id) if company_id else None,
                brand_id=int(brand_id) if brand_id else None,
            )
        except WorkspaceError as exc:
            return Response(
                {'detail': str(exc)}, status=status.HTTP_403_FORBIDDEN
            )
        except (TypeError, ValueError):
            return Response(
                {'detail': 'Invalid company_id or brand_id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Re-issue identity so the new workspace + permissions are reflected
        # in the token claims as well as the DB.
        from apps.users.api.serializers import LkSystemTokenObtainPairSerializer
        refresh = LkSystemTokenObtainPairSerializer.get_token(user)

        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': _build_user_payload(user),
        })


class CurrentIdentityView(APIView):
    """GET /api/v1/auth/me/ — the caller's identity with permissions recomputed
    fresh from the database.

    Lets the SPA refresh its cached permission set after an admin changes the
    user's roles, without forcing a logout/login. The backend already authorises
    every request against the live DB; this only keeps the client UI (menus,
    buttons) in sync.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=['Auth'],
        summary='Current identity with fresh permissions',
        responses={200: OpenApiResponse(description='Current user payload.')},
    )
    def get(self, request):
        return Response({'user': _build_user_payload(request.user)})
