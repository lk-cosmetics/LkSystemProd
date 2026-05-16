"""
LkSystem Users App - API Views
ViewSets for User, Role, and Profile management.
"""

from django.contrib.auth import get_user_model
from rest_framework import viewsets, status, generics
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from drf_spectacular.utils import extend_schema, extend_schema_view, OpenApiParameter

from ..models import Profile
from .serializers import (
    LkSystemTokenObtainPairSerializer,
    ProfileSerializer,
    UserListSerializer,
    UserDetailSerializer,
    CreateEmployeeSerializer,
    UpdateUserSerializer,
    ChangePasswordSerializer,
    ForgotPasswordSerializer,
    ResetPasswordSerializer,
    ValidateResetTokenSerializer,
    InviteEmployeeSerializer,
    InvitationDetailSerializer,
    ValidateInvitationSerializer,
    AcceptInvitationSerializer,
)
from ..models import Invitation

User = get_user_model()


# =============================================================================
# JWT AUTHENTICATION VIEWS
# =============================================================================

@extend_schema(
    tags=['Auth'],
    summary='Login and get JWT tokens',
    description='Authenticate with matricule and password to receive access and refresh tokens along with user details. This endpoint is public and does not require authentication.',
)
class LkSystemTokenObtainPairView(TokenObtainPairView):
    """
    Custom JWT login endpoint.
    Returns access and refresh tokens with user context.
    
    POST /api/v1/auth/login/
    Body: {"matricule": "COMP-0001", "password": "xxx"}
    """
    permission_classes = [AllowAny]
    serializer_class = LkSystemTokenObtainPairSerializer


# =============================================================================
# PASSWORD RESET VIEWS
# =============================================================================

@extend_schema(
    tags=['Auth'],
    summary='Request password reset',
    description='''
Request a password reset link via email.

**Flow:**
1. User submits their email address
2. If email exists, a reset link is sent
3. Link expires after 1 hour
4. User clicks link and resets password

**Note:** For security, this endpoint always returns success even if email doesn't exist.
''',
    request=ForgotPasswordSerializer,
    responses={
        200: {'description': 'Password reset email sent (if email exists)'},
    },
)
class ForgotPasswordView(APIView):
    """
    Request password reset email.
    POST /api/v1/auth/forgot-password/
    """
    permission_classes = [AllowAny]
    serializer_class = ForgotPasswordSerializer
    
    def post(self, request):
        serializer = ForgotPasswordSerializer(
            data=request.data,
            context={'request': request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        
        return Response({
            'message': 'If an account with this email exists, a password reset link has been sent.',
            'email': serializer.validated_data['email'],
        })


@extend_schema(
    tags=['Auth'],
    summary='Reset password with token',
    description='''
Reset password using the token received via email.

**Required fields:**
- `email`: User's email address
- `token`: Reset token from email link
- `new_password`: New password (must meet security requirements)
- `new_password_confirm`: Confirm new password
''',
    request=ResetPasswordSerializer,
    responses={
        200: {'description': 'Password reset successful'},
        400: {'description': 'Invalid or expired token'},
    },
)
class ResetPasswordView(APIView):
    """
    Reset password with token.
    POST /api/v1/auth/reset-password/
    """
    permission_classes = [AllowAny]
    serializer_class = ResetPasswordSerializer
    
    def post(self, request):
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        
        return Response({
            'message': 'Password has been reset successfully. You can now login with your new password.',
        })


@extend_schema(
    tags=['Auth'],
    summary='Validate reset token',
    description='''
Check if a password reset token is valid before showing the reset form.

Use this to validate the token when user lands on the reset password page.
''',
    request=ValidateResetTokenSerializer,
    responses={
        200: {'description': 'Token is valid'},
        400: {'description': 'Token is invalid or expired'},
    },
)
class ValidateResetTokenView(APIView):
    """
    Validate password reset token.
    POST /api/v1/auth/validate-reset-token/
    """
    permission_classes = [AllowAny]
    serializer_class = ValidateResetTokenSerializer
    
    def post(self, request):
        serializer = ValidateResetTokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        return Response({
            'valid': True,
            'message': 'Token is valid. You can reset your password.',
        })


@extend_schema(
    tags=['Auth'],
    summary='Logout (invalidate tokens)',
    description='Logout the user. Note: With JWT, tokens are stateless. This endpoint is for frontend compatibility.',
)
class LogoutView(APIView):
    """
    Logout endpoint for frontend compatibility.
    POST /api/v1/auth/logout/
    
    Note: JWT tokens are stateless. The frontend should:
    1. Delete the tokens from local storage
    2. Optionally call this endpoint for logging purposes
    """
    permission_classes = [AllowAny]
    
    def post(self, request):
        return Response({
            'message': 'Logged out successfully. Please delete your tokens.',
        })


# =============================================================================
# USER VIEWS
# =============================================================================

@extend_schema_view(
    list=extend_schema(
        tags=['Users'],
        summary='List all users',
        description='Returns a paginated list of all users. Supports filtering by company, role, and active status.',
    ),
    create=extend_schema(
        tags=['Users'],
        summary='Create a user (employee)',
        description='Create a new employee user with role and brand assignments.',
    ),
    retrieve=extend_schema(
        tags=['Users'],
        summary='Get user details',
        description='Retrieve detailed information about a specific user including their profile.',
    ),
    update=extend_schema(
        tags=['Users'],
        summary='Update a user',
        description='Update all fields of an existing user.',
    ),
    partial_update=extend_schema(
        tags=['Users'],
        summary='Partial update a user',
        description='Update specific fields of an existing user.',
    ),
    destroy=extend_schema(
        tags=['Users'],
        summary='Delete a user',
        description='Delete a user and their associated profile.',
    ),
)
class UserViewSet(viewsets.ModelViewSet):
    """
    API ViewSet for User management.
    
    Endpoints:
    - GET /api/v1/users/ - List all users
    - POST /api/v1/users/ - Create a user (employee)
    - GET /api/v1/users/{id}/ - Get user details
    - PUT /api/v1/users/{id}/ - Update a user
    - DELETE /api/v1/users/{id}/ - Delete a user
    - GET /api/v1/users/me/ - Get current user
    - POST /api/v1/users/{id}/change_password/ - Change password
    """
    
    queryset = User.objects.all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['current_company', 'is_active']
    search_fields = ['matricule', 'email', 'first_name', 'last_name']
    ordering_fields = ['matricule', 'date_joined', 'email']
    ordering = ['matricule']
    
    def get_serializer_class(self):
        if self.action == 'list':
            return UserListSerializer
        elif self.action == 'create':
            return CreateEmployeeSerializer
        elif self.action in ['update', 'partial_update', 'me']:
            return UpdateUserSerializer
        elif self.action == 'change_password':
            return ChangePasswordSerializer
        return UserDetailSerializer
    
    def get_queryset(self):
        """Optimize queryset with related data."""
        queryset = super().get_queryset()
        queryset = queryset.select_related('current_company')
        
        if self.action == 'retrieve':
            queryset = queryset.prefetch_related('allowed_brands', 'profile')
        
        # Filter by current user's company (unless superuser)
        user = self.request.user
        if not user.is_superuser and user.current_company:
            queryset = queryset.filter(current_company=user.current_company)
        
        return queryset
    
    @extend_schema(
        tags=['Users'],
        summary='Get or update current user',
        description='''
Get or update the currently authenticated user details.

**GET**: Returns the current user's full details including profile.

**PATCH**: Update the current user's information. Users can update:
- Personal info: first_name, last_name
- Profile data: phone, birth_date, gender, nationality, city, address, avatar, etc.

**Note**: Users cannot change their own role, company, or allowed_brands via this endpoint.
''',
    )
    @action(detail=False, methods=['get', 'patch', 'put'])
    def me(self, request):
        """
        Get or update current authenticated user's details.
        GET /api/v1/users/me/ - Get user details
        PATCH /api/v1/users/me/ - Partial update user
        PUT /api/v1/users/me/ - Full update user
        """
        user = request.user
        
        if request.method == 'GET':
            serializer = UserDetailSerializer(user)
            return Response(serializer.data)
        
        # For PATCH/PUT - update user data
        # Restrict certain fields that users cannot change themselves
        data = request.data.copy()
        restricted_fields = ['current_company', 'allowed_brands', 'is_active', 'is_staff', 'is_superuser', 'matricule']
        for field in restricted_fields:
            data.pop(field, None)
        
        serializer = UpdateUserSerializer(
            user,
            data=data,
            partial=(request.method == 'PATCH'),
            context={'request': request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        
        # Return updated user details
        return Response(UserDetailSerializer(user).data)
    
    @extend_schema(
        tags=['Users'],
        summary='Change password',
        description='''
Change the password for a user with role-based permission hierarchy.

**Permission Hierarchy:**
- **Superadmin**: Can change password for any user (no old password required)
- **CEO**: Can change password for users within their company (no old password required)
- **Manager**: Can change password for users within their brand(s) (no old password required)
- **Regular User**: Can only change their own password (old password required)

**Security Features:**
- Rate limited to 5 attempts per 15 minutes
- Password change events are logged
- Email notification sent to user after password change
''',
        request=ChangePasswordSerializer,
    )
    @action(detail=True, methods=['post'])
    def change_password(self, request, pk=None):
        """
        Change user's password with role-based permissions.
        POST /api/v1/users/{id}/change_password/
        """
        from django.core.cache import cache
        from django.core.mail import send_mail
        from django.conf import settings
        import logging
        
        logger = logging.getLogger(__name__)
        target_user = self.get_object()
        requesting_user = request.user
        
        # =================================================================
        # RATE LIMITING: 5 attempts per 15 minutes per user
        # =================================================================
        rate_limit_key = f'password_change_attempts:{requesting_user.id}'
        attempts = cache.get(rate_limit_key, 0)
        
        if attempts >= 5:
            logger.warning(
                f'Rate limit exceeded for password change. '
                f'User: {requesting_user.matricule}, Target: {target_user.matricule}'
            )
            return Response(
                {'detail': 'Too many password change attempts. Please try again in 15 minutes.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        
        # =================================================================
        # PERMISSION CHECK: Role-based hierarchy
        # =================================================================
        permission_granted, permission_type = self._check_password_change_permission(
            requesting_user, target_user
        )
        
        if not permission_granted:
            # Increment rate limit counter on failed permission
            cache.set(rate_limit_key, attempts + 1, timeout=900)  # 15 minutes
            logger.warning(
                f'Unauthorized password change attempt. '
                f'User: {requesting_user.matricule} tried to change {target_user.matricule}'
            )
            return Response(
                {'detail': 'You do not have permission to change this user\'s password.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # =================================================================
        # VALIDATE AND CHANGE PASSWORD
        # =================================================================
        serializer = ChangePasswordSerializer(
            data=request.data,
            context={'request': request, 'target_user': target_user}
        )
        
        if not serializer.is_valid():
            # Increment rate limit counter on validation failure
            cache.set(rate_limit_key, attempts + 1, timeout=900)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        # Change the password
        target_user.set_password(serializer.validated_data['new_password'])
        target_user.save()
        
        # Clear rate limit on success
        cache.delete(rate_limit_key)
        
        # =================================================================
        # LOGGING: Record password change event
        # =================================================================
        is_self_change = requesting_user == target_user
        logger.info(
            f'Password changed successfully. '
            f'Target: {target_user.matricule}, '
            f'Changed by: {requesting_user.matricule}, '
            f'Permission type: {permission_type}, '
            f'Self change: {is_self_change}'
        )
        
        # =================================================================
        # EMAIL NOTIFICATION: Notify user of password change
        # =================================================================
        try:
            if target_user.email:
                subject = 'LkSystem - Your Password Has Been Changed'
                
                if is_self_change:
                    message = (
                        f'Hello {target_user.get_full_name()},\n\n'
                        f'Your password was successfully changed.\n\n'
                        f'If you did not make this change, please contact your administrator immediately.\n\n'
                        f'Best regards,\n'
                        f'LkSystem Team'
                    )
                else:
                    message = (
                        f'Hello {target_user.get_full_name()},\n\n'
                        f'Your password was changed by {requesting_user.get_full_name()} ({permission_type}).\n\n'
                        f'If you did not authorize this change, please contact your administrator immediately.\n\n'
                        f'Best regards,\n'
                        f'LkSystem Team'
                    )
                
                send_mail(
                    subject=subject,
                    message=message,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[target_user.email],
                    fail_silently=True,  # Don't fail if email fails
                )
        except Exception as e:
            logger.error(f'Failed to send password change notification email: {e}')
        
        return Response({
            'detail': 'Password changed successfully.',
            'changed_by': permission_type,
            'email_notification_sent': bool(target_user.email),
        })
    
    def _check_password_change_permission(self, requesting_user, target_user):
        """
        Check if requesting_user has permission to change target_user's password.
        
        Returns:
            tuple: (permission_granted: bool, permission_type: str)
        
        Permission Hierarchy:
        1. Superadmin - Can change any user's password
        2. CEO - Can change passwords for users in their company
        3. Manager - Can change passwords for users in their brand(s)
        4. Self - Users can change their own password
        """
        # Self-change is always allowed
        if requesting_user == target_user:
            return True, 'self'
        
        # Self-change by ID comparison (in case objects are different instances)
        if requesting_user.id == target_user.id:
            return True, 'self'
        
        # Superadmin can change anyone's password (check is_superuser flag)
        if requesting_user.is_superuser:
            return True, 'superadmin'
        
        # Check RBAC roles
        from apps.rbac.services import PermissionService
        role_names = [r.upper() for r in PermissionService.get_user_role_names(requesting_user)]

        if 'SUPER ADMIN' in role_names:
            return True, 'superadmin'

        if 'CEO' in role_names:
            if (requesting_user.current_company and
                target_user.current_company and
                requesting_user.current_company.id == target_user.current_company.id):
                return True, 'ceo'
            return False, 'ceo_wrong_company'

        if 'MANAGER' in role_names:
            requesting_brands = set(requesting_user.allowed_brands.values_list('id', flat=True))
            target_brands = set(target_user.allowed_brands.values_list('id', flat=True))
            if requesting_brands & target_brands:
                return True, 'manager'
            return False, 'manager_no_common_brand'

        return False, 'insufficient_permissions'
    
    @extend_schema(
        tags=['Users'],
        summary='Filter users by brand',
        description='Get users who have access to a specific brand.',
        parameters=[
            OpenApiParameter(name='brand_id', description='Brand ID to filter by', required=True, type=int),
        ],
    )
    @action(detail=False, methods=['get'])
    def by_brand(self, request):
        """
        Get users filtered by brand.
        GET /api/v1/users/by_brand/?brand_id=1
        """
        brand_id = request.query_params.get('brand_id')
        if not brand_id:
            return Response(
                {'detail': 'brand_id parameter is required.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        queryset = self.get_queryset().filter(allowed_brands__id=brand_id)
        page = self.paginate_queryset(queryset)
        
        if page is not None:
            serializer = UserListSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = UserListSerializer(queryset, many=True)
        return Response(serializer.data)


# =============================================================================
# INVITATION VIEWS
# =============================================================================

@extend_schema(
    tags=['Invitations'],
    summary='Invite an employee',
    description=(
        'Send an invitation email to a new employee. '
        'The invitee receives a link to complete registration.\n\n'
        '**Required:** email, role_id, company_id\n'
        '**Optional:** brand_ids, sales_channel_id'
    ),
    request=InviteEmployeeSerializer,
)
class InviteEmployeeView(APIView):
    """POST /api/v1/users/invite/"""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = InviteEmployeeSerializer(
            data=request.data, context={'request': request}
        )
        serializer.is_valid(raise_exception=True)
        invitation = serializer.save()
        return Response(
            InvitationDetailSerializer(invitation).data,
            status=status.HTTP_201_CREATED,
        )


@extend_schema(
    tags=['Invitations'],
    summary='List invitations',
    description='List all invitations sent by the current user or within their scope.',
)
class InvitationListView(generics.ListAPIView):
    """GET /api/v1/users/invitations/"""
    permission_classes = [IsAuthenticated]
    serializer_class = InvitationDetailSerializer

    def get_queryset(self):
        qs = Invitation.objects.select_related(
            'role', 'company', 'invited_by', 'sales_channel',
        ).prefetch_related('brands')
        user = self.request.user
        if not user.is_superuser:
            qs = qs.filter(invited_by=user)
        return qs


@extend_schema(
    tags=['Invitations'],
    summary='Cancel an invitation',
    description='Cancel a pending invitation by ID.',
)
class CancelInvitationView(APIView):
    """POST /api/v1/users/invitations/{id}/cancel/"""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            invitation = Invitation.objects.get(
                pk=pk, status=Invitation.Status.PENDING,
            )
        except Invitation.DoesNotExist:
            return Response(
                {'detail': 'Invitation not found or already processed.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        invitation.cancel()
        return Response({'detail': 'Invitation cancelled.'})


@extend_schema(
    tags=['Invitations'],
    summary='Validate invitation token',
    description='Check if an invitation token is valid. Public endpoint — no auth required.',
    request=ValidateInvitationSerializer,
)
class ValidateInvitationView(APIView):
    """POST /api/v1/auth/validate-invitation/"""
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ValidateInvitationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invitation = serializer.validated_data['_invitation']
        return Response({
            'valid': True,
            'role_name': invitation.role.name,
            'company_name': invitation.company.name,
        })


@extend_schema(
    tags=['Invitations'],
    summary='Accept invitation and create account',
    description=(
        'Accept an invitation by providing name and password. '
        'Creates the user account with pre-assigned role and scope.\n\n'
        'Public endpoint — no auth required.'
    ),
    request=AcceptInvitationSerializer,
)
class AcceptInvitationView(APIView):
    """POST /api/v1/auth/accept-invitation/"""
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = AcceptInvitationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response({
            'message': 'Account created successfully. You can now log in.',
            'matricule': user.matricule,
            'email': user.email,
        }, status=status.HTTP_201_CREATED)


# =============================================================================
# PROFILE VIEWS
# =============================================================================

@extend_schema_view(
    list=extend_schema(
        tags=['Profiles'],
        summary='List all profiles',
        description='Returns a paginated list of all user profiles.',
    ),
    retrieve=extend_schema(
        tags=['Profiles'],
        summary='Get profile details',
        description='Retrieve detailed information about a specific user profile.',
    ),
    update=extend_schema(
        tags=['Profiles'],
        summary='Update a profile',
        description='Update all fields of an existing profile.',
    ),
    partial_update=extend_schema(
        tags=['Profiles'],
        summary='Partial update a profile',
        description='Update specific fields of an existing profile.',
    ),
)
class ProfileViewSet(viewsets.ModelViewSet):
    """
    API ViewSet for Profile management.
    
    Endpoints:
    - GET /api/v1/users/profiles/ - List all profiles
    - GET /api/v1/users/profiles/{id}/ - Get profile details
    - PUT /api/v1/users/profiles/{id}/ - Update a profile
    - GET /api/v1/users/profiles/my_profile/ - Get current user's profile
    """
    
    queryset = Profile.objects.all()
    serializer_class = ProfileSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['is_complete', 'gender', 'education_level']
    search_fields = ['cin_number', 'user__matricule', 'user__email']
    
    def get_queryset(self):
        """Optimize and filter by company."""
        queryset = super().get_queryset().select_related('user', 'user__current_company')
        
        user = self.request.user
        if not user.is_superuser and user.current_company:
            queryset = queryset.filter(user__current_company=user.current_company)
        
        return queryset
    
    @extend_schema(
        tags=['Profiles'],
        summary='Get or update my profile',
        description='Get or update the current authenticated user\'s profile.',
    )
    @action(detail=False, methods=['get', 'put', 'patch'])
    def my_profile(self, request):
        """
        Get or update current user's profile.
        GET/PUT/PATCH /api/v1/users/profiles/my_profile/
        """
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            # Create profile if it doesn't exist
            profile = Profile.objects.create(user=request.user)
        
        if request.method == 'GET':
            serializer = ProfileSerializer(profile)
            return Response(serializer.data)
        
        partial = request.method == 'PATCH'
        serializer = ProfileSerializer(profile, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        
        return Response(serializer.data)
