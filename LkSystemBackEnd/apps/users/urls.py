"""
LkSystem Users App - URL Configuration
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView, TokenVerifyView
from rest_framework.permissions import AllowAny
from drf_spectacular.utils import extend_schema

from .api.views import (
    LkSystemTokenObtainPairView,
    ForgotPasswordView,
    ResetPasswordView,
    ValidateResetTokenView,
    LogoutView,
    UserViewSet,
    ProfileViewSet,
    InviteEmployeeView,
    InvitationListView,
    CancelInvitationView,
    ValidateInvitationView,
    AcceptInvitationView,
)

# Create router and register viewsets
router = DefaultRouter()
router.register(r'profiles', ProfileViewSet, basename='profile')
router.register(r'', UserViewSet, basename='user')

app_name = 'users'

urlpatterns = [
    # Invitation endpoints (authenticated)
    path('invite/', InviteEmployeeView.as_view(), name='invite_employee'),
    path('invitations/', InvitationListView.as_view(), name='invitation_list'),
    path('invitations/<int:pk>/cancel/', CancelInvitationView.as_view(), name='cancel_invitation'),
    # Router URLs
    path('', include(router.urls)),
]


# Extend SimpleJWT views with schema and AllowAny permission
@extend_schema(tags=['Auth'], summary='Refresh access token', description='Get a new access token using the refresh token.')
class PublicTokenRefreshView(TokenRefreshView):
    permission_classes = [AllowAny]


@extend_schema(tags=['Auth'], summary='Verify token', description='Verify if a token is valid.')
class PublicTokenVerifyView(TokenVerifyView):
    permission_classes = [AllowAny]


# Auth URLs - To be included separately at /api/v1/auth/
auth_urlpatterns = [
    # JWT Authentication
    path('login/', LkSystemTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('refresh/', PublicTokenRefreshView.as_view(), name='token_refresh'),
    path('verify/', PublicTokenVerifyView.as_view(), name='token_verify'),
    path('logout/', LogoutView.as_view(), name='logout'),
    
    # Password Reset
    path('forgot-password/', ForgotPasswordView.as_view(), name='forgot_password'),
    path('reset-password/', ResetPasswordView.as_view(), name='reset_password'),
    path('validate-reset-token/', ValidateResetTokenView.as_view(), name='validate_reset_token'),

    # Invitation (public — no auth)
    path('validate-invitation/', ValidateInvitationView.as_view(), name='validate_invitation'),
    path('accept-invitation/', AcceptInvitationView.as_view(), name='accept_invitation'),
]
