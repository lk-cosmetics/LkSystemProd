import { useState, useEffect, useCallback, useRef } from 'react';
import {
  User,
  Mail,
  Phone,
  Calendar,
  MapPin,
  Globe,
  Building2,
  Tag,
  Shield,
  Key,
  Save,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Pencil,
  X,
  Settings,
  ChevronRight,
  BadgeCheck,
  Clock,
  Sparkles,
  Camera,
  Upload,
  FileText,
  Trash2,
  Home,
  CreditCard,
  GraduationCap,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { userService } from '@/services/user.service';
import { profileService } from '@/services/profile.service';
import { waitForAuthInit } from '@/store/authStore';
import { getMediaUrl } from '@/utils/helpers';
import type { UserDetails, UpdateUserRequest, EducationLevel } from '@/types';
import { EDUCATION_LEVELS } from '@/types';

// Tunisia cities constant
const TUNISIA_CITIES = [
  'Tunis',
  'Sfax',
  'Sousse',
  'Kairouan',
  'Bizerte',
  'Gabès',
  'Ariana',
  'Gafsa',
  'Monastir',
  'Ben Arous',
  'Kasserine',
  'Médenine',
  'Nabeul',
  'Tataouine',
  'Béja',
  'Kef',
  'Mahdia',
  'Sidi Bouzid',
  'Jendouba',
  'Tozeur',
  'Manouba',
  'Siliana',
  'Zaghouan',
  'Kebili',
];

export default function SettingsPage() {
  const [user, setUser] = useState<UserDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode states
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editFormData, setEditFormData] = useState<{
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    birth_date: string;
    gender: 'M' | 'F' | '';
    nationality: string;
    city: string;
    address: string;
    cin_number: string;
    emergency_phone: string;
    education_level: EducationLevel | '';
    diploma_title: string;
  }>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    birth_date: '',
    gender: '',
    nationality: '',
    city: '',
    address: '',
    cin_number: '',
    emergency_phone: '',
    education_level: '',
    diploma_title: '',
  });

  // File upload states
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [cinFrontFile, setCinFrontFile] = useState<File | null>(null);
  const [cinFrontPreview, setCinFrontPreview] = useState<string | null>(null);
  const [cinBackFile, setCinBackFile] = useState<File | null>(null);
  const [cinBackPreview, setCinBackPreview] = useState<string | null>(null);
  const [diplomaFile, setDiplomaFile] = useState<File | null>(null);
  const [diplomaPreview, setDiplomaPreview] = useState<string | null>(null);

  // File input refs
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const cinFrontInputRef = useRef<HTMLInputElement>(null);
  const cinBackInputRef = useRef<HTMLInputElement>(null);
  const diplomaInputRef = useRef<HTMLInputElement>(null);

  // Password change states
  const [passwordDialog, setPasswordDialog] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Dialog states
  const [successDialog, setSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorDialog, setErrorDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [activeTab, setActiveTab] = useState('profile');

  // Fetch user data
  const fetchUser = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Wait for auth to be initialized before making API call
      await waitForAuthInit();
      const userData = await userService.getCurrentUser();
      setUser(userData);
      // Initialize edit form data with all profile fields
      setEditFormData({
        first_name: userData.first_name || '',
        last_name: userData.last_name || '',
        email: userData.email || '',
        phone: userData.profile?.phone || '',
        birth_date: userData.profile?.birth_date || '',
        gender: userData.profile?.gender || '',
        nationality: userData.profile?.nationality || '',
        city: userData.profile?.city || '',
        address: userData.profile?.address || '',
        cin_number: userData.profile?.cin_number || '',
        emergency_phone: userData.profile?.emergency_phone || '',
        education_level:
          (userData.profile?.education_level as EducationLevel) || '',
        diploma_title: userData.profile?.diploma_title || '',
      });
      // Reset file states
      setAvatarFile(null);
      setAvatarPreview(null);
      setCinFrontFile(null);
      setCinFrontPreview(null);
      setCinBackFile(null);
      setCinBackPreview(null);
      setDiplomaFile(null);
      setDiplomaPreview(null);
    } catch (err) {
      console.error('Error fetching user:', err);
      setError('Failed to load user profile');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  // Extract error message
  const extractErrorMessage = (err: unknown): string => {
    if (err && typeof err === 'object' && 'response' in err) {
      const axiosError = err as {
        response?: {
          data?: { detail?: string; message?: string; error?: string };
        };
      };
      return (
        axiosError.response?.data?.detail ||
        axiosError.response?.data?.message ||
        axiosError.response?.data?.error ||
        'An error occurred'
      );
    }
    return 'An error occurred';
  };

  // Handle profile update
  const handleSaveProfile = async () => {
    if (!user) return;

    setIsSaving(true);
    try {
      // First, update basic user info via user service
      const updateData: UpdateUserRequest = {
        first_name: editFormData.first_name,
        last_name: editFormData.last_name,
        email: editFormData.email,
        profile: {
          phone: editFormData.phone || undefined,
          birth_date: editFormData.birth_date || undefined,
          gender: (editFormData.gender as 'M' | 'F') || undefined,
          nationality: editFormData.nationality || undefined,
          city: editFormData.city || undefined,
        },
      };

      console.log('📤 Updating profile via /me/ endpoint:', updateData);
      // Use updateCurrentUser instead of updateUser(id) to avoid permission issues
      const updatedUser = await userService.updateCurrentUser(updateData);
      console.log('📥 Updated user response:', updatedUser);

      // If we have files or additional profile fields, update via profile service
      const hasFiles = avatarFile || cinFrontFile || cinBackFile || diplomaFile;
      const hasAdditionalFields =
        editFormData.address ||
        editFormData.cin_number ||
        editFormData.emergency_phone ||
        editFormData.education_level ||
        editFormData.diploma_title;

      if ((hasFiles || hasAdditionalFields) && user.profile?.id) {
        const profileData = {
          phone: editFormData.phone || undefined,
          birth_date: editFormData.birth_date || undefined,
          gender: (editFormData.gender as 'M' | 'F') || undefined,
          nationality: editFormData.nationality || undefined,
          city: editFormData.city || undefined,
          address: editFormData.address || undefined,
          cin_number: editFormData.cin_number || undefined,
          emergency_phone: editFormData.emergency_phone || undefined,
          education_level: editFormData.education_level || undefined,
          diploma_title: editFormData.diploma_title || undefined,
        };

        const files = {
          avatar: avatarFile || undefined,
          cin_front: cinFrontFile || undefined,
          cin_back: cinBackFile || undefined,
          diploma_file: diplomaFile || undefined,
        };

        console.log('📤 Updating profile with files:', {
          profileData,
          hasFiles,
        });
        await profileService.updateProfileWithFiles(
          user.profile.id,
          profileData,
          files
        );

        // Refresh user data to get updated profile
        const refreshedUser = await userService.getCurrentUser();
        setUser(refreshedUser);
      } else {
        setUser(updatedUser);
      }

      // Reset file states
      setAvatarFile(null);
      setAvatarPreview(null);
      setCinFrontFile(null);
      setCinFrontPreview(null);
      setCinBackFile(null);
      setCinBackPreview(null);
      setDiplomaFile(null);
      setDiplomaPreview(null);

      setIsEditingProfile(false);
      setSuccessMessage('Profile updated successfully!');
      setSuccessDialog(true);
    } catch (err) {
      console.error('❌ Error updating profile:', err);
      // Log detailed error info
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosError = err as {
          response?: { status?: number; data?: unknown };
        };
        console.error('Status:', axiosError.response?.status);
        console.error('Response data:', axiosError.response?.data);
      }
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle password change
  const handleChangePassword = async () => {
    if (!user) return;

    // Validate passwords
    if (!oldPassword) {
      setPasswordError('Current password is required');
      return;
    }
    if (!newPassword) {
      setPasswordError('New password is required');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setIsChangingPassword(true);
    setPasswordError(null);
    try {
      await userService.changePassword(user.id, {
        old_password: oldPassword,
        new_password: newPassword,
        new_password_confirm: confirmPassword,
      });

      // Reset form and close dialog
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordDialog(false);
      setSuccessMessage('Password changed successfully!');
      setSuccessDialog(true);
    } catch (err) {
      console.error('Error changing password:', err);
      // Handle API errors more specifically
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosError = err as {
          response?: { status?: number; data?: Record<string, unknown> };
        };
        const data = axiosError.response?.data;

        // Log the full response for debugging
        console.error('API Error Response:', JSON.stringify(data, null, 2));

        if (axiosError.response?.status === 429) {
          setPasswordError(
            'Too many password change attempts. Please try again in 15 minutes.'
          );
        } else if (axiosError.response?.status === 403) {
          setPasswordError(
            (data?.detail as string) ||
              'You do not have permission to change this password.'
          );
        } else if (data?.old_password) {
          const oldPwdError = data.old_password as string[];
          setPasswordError(oldPwdError[0] || 'Old password is incorrect.');
        } else if (data?.new_password) {
          const newPwdError = data.new_password as string[];
          setPasswordError(
            Array.isArray(newPwdError)
              ? newPwdError.join(' ')
              : String(newPwdError)
          );
        } else if (data?.new_password_confirm) {
          const confirmError = data.new_password_confirm as string[];
          setPasswordError(confirmError[0] || 'Passwords do not match.');
        } else if (data?.detail) {
          setPasswordError(String(data.detail));
        } else if (data?.non_field_errors) {
          const nonFieldErrors = data.non_field_errors as string[];
          setPasswordError(
            Array.isArray(nonFieldErrors)
              ? nonFieldErrors.join(' ')
              : String(nonFieldErrors)
          );
        } else {
          // Show raw error data if nothing else matches
          const errorMessage = data
            ? JSON.stringify(data)
            : extractErrorMessage(err);
          setPasswordError(errorMessage);
        }
      } else {
        setPasswordError(extractErrorMessage(err));
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Cancel editing
  const handleCancelEdit = () => {
    if (user) {
      setEditFormData({
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email || '',
        phone: user.profile?.phone || '',
        birth_date: user.profile?.birth_date || '',
        gender: user.profile?.gender || '',
        nationality: user.profile?.nationality || '',
        city: user.profile?.city || '',
        address: user.profile?.address || '',
        cin_number: user.profile?.cin_number || '',
        emergency_phone: user.profile?.emergency_phone || '',
        education_level:
          (user.profile?.education_level as EducationLevel) || '',
        diploma_title: user.profile?.diploma_title || '',
      });
      // Reset file states
      setAvatarFile(null);
      setAvatarPreview(null);
      setCinFrontFile(null);
      setCinFrontPreview(null);
      setCinBackFile(null);
      setCinBackPreview(null);
      setDiplomaFile(null);
      setDiplomaPreview(null);
    }
    setIsEditingProfile(false);
  };

  // Handle file selection
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCinFrontChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCinFrontFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setCinFrontPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDiplomaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setDiplomaFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setDiplomaPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeDiploma = () => {
    setDiplomaFile(null);
    setDiplomaPreview(null);
    if (diplomaInputRef.current) {
      diplomaInputRef.current.value = '';
    }
  };

  const handleCinBackChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCinBackFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setCinBackPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeAvatar = () => {
    setAvatarFile(null);
    setAvatarPreview(null);
    if (avatarInputRef.current) {
      avatarInputRef.current.value = '';
    }
  };

  const removeCinFront = () => {
    setCinFrontFile(null);
    setCinFrontPreview(null);
    if (cinFrontInputRef.current) {
      cinFrontInputRef.current.value = '';
    }
  };

  const removeCinBack = () => {
    setCinBackFile(null);
    setCinBackPreview(null);
    if (cinBackInputRef.current) {
      cinBackInputRef.current.value = '';
    }
  };

  // Get user initials
  const getInitials = () => {
    if (user?.full_name) {
      const names = user.full_name.split(' ');
      return names
        .map(n => n.charAt(0))
        .slice(0, 2)
        .join('')
        .toUpperCase();
    }
    return user?.email?.charAt(0).toUpperCase() || 'U';
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="relative">
          <div className="size-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
        </div>
        <p className="text-l-text-2 dark:text-d-text-2 animate-pulse">
          Loading settings...
        </p>
      </div>
    );
  }

  // Error state
  if (error || !user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="p-4 rounded-full bg-red-100 dark:bg-red-900/20">
          <AlertCircle className="size-12 text-red-500" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-l-text-1 dark:text-d-text-1 mb-2">
            Unable to Load Settings
          </h2>
          <p className="text-l-text-2 dark:text-d-text-2 mb-4">
            {error || 'Failed to load user data'}
          </p>
        </div>
        <Button onClick={fetchUser} className="gap-2">
          <Loader2 className="size-4" />
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-screen bg-gradient-to-b from-l-bg-1 to-l-bg-2 dark:from-d-bg-1 dark:to-d-bg-2">
      {/* Hero Header */}
      <div className="relative overflow-hidden bg-gradient-to-r from-primary/10 via-primary/5 to-transparent dark:from-primary/20 dark:via-primary/10">
        <div className="absolute inset-0 bg-grid-pattern opacity-5" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
            {/* Avatar */}
            <div className="relative group">
              <Avatar className="size-20 sm:size-24 ring-4 ring-background shadow-xl">
                <AvatarImage
                  src={avatarPreview || getMediaUrl(user.profile?.avatar)}
                  alt={user.full_name}
                  className="object-cover"
                />
                <AvatarFallback className="text-2xl sm:text-3xl font-semibold bg-primary/10 text-primary">
                  {getInitials()}
                </AvatarFallback>
              </Avatar>
              {isEditingProfile && (
                <>
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Camera className="size-6 text-white" />
                  </button>
                  {avatarPreview && (
                    <button
                      type="button"
                      onClick={removeAvatar}
                      className="absolute -top-1 -right-1 p-1.5 rounded-full bg-red-500 text-white shadow-lg hover:bg-red-600 transition-colors"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </>
              )}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </div>

            {/* User Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">
                  {user.full_name}
                </h1>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="w-fit">
                    <Shield className="size-3 mr-1" />
                    {user.role_name}
                  </Badge>
                  {user.is_active ? (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      <CheckCircle2 className="size-3 mr-1" />
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="destructive">Inactive</Badge>
                  )}
                </div>
              </div>
              <p className="text-l-text-2 dark:text-d-text-2 mt-1 flex items-center gap-2">
                <Mail className="size-4" />
                <span className="truncate">{user.email}</span>
              </p>

              {/* Profile Completion */}
              {user.profile && (
                <div className="mt-4 max-w-xs">
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="text-l-text-2 dark:text-d-text-2 flex items-center gap-1">
                      <Sparkles className="size-3" />
                      Profile completion
                    </span>
                    <span className="font-semibold text-primary">
                      {user.profile.completion_percentage}%
                    </span>
                  </div>
                  <Progress
                    value={user.profile.completion_percentage}
                    className="h-2"
                  />
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap gap-2 sm:gap-3 w-full sm:w-auto">
              {!isEditingProfile ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditingProfile(true)}
                  className="gap-2 flex-1 sm:flex-none"
                >
                  <Pencil className="size-4" />
                  <span>Edit Profile</span>
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    onClick={handleSaveProfile}
                    disabled={isSaving}
                    className="gap-2 flex-1 sm:flex-none"
                  >
                    {isSaving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelEdit}
                    className="gap-2 flex-1 sm:flex-none"
                  >
                    <X className="size-4" />
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-6"
        >
          {/* Tab Navigation */}
          <TabsList className="w-full sm:w-auto grid grid-cols-3 sm:inline-flex h-auto p-1 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
            <TabsTrigger
              value="profile"
              className="gap-2 px-3 sm:px-6 py-2.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              <User className="size-4" />
              <span className="hidden sm:inline">Profile</span>
            </TabsTrigger>
            <TabsTrigger
              value="organization"
              className="gap-2 px-3 sm:px-6 py-2.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              <Building2 className="size-4" />
              <span className="hidden sm:inline">Organization</span>
            </TabsTrigger>
            <TabsTrigger
              value="security"
              className="gap-2 px-3 sm:px-6 py-2.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              <Key className="size-4" />
              <span className="hidden sm:inline">Security</span>
            </TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-6 mt-6">
            {/* Account Info Card */}
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <BadgeCheck className="size-5 text-primary" />
                  Account Information
                </CardTitle>
                <CardDescription>
                  Your unique account identifiers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 dark:from-primary/10 dark:to-primary/20">
                    <div className="p-2.5 rounded-lg bg-primary/10">
                      <BadgeCheck className="size-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-l-text-2 dark:text-d-text-2">
                        Matricule
                      </p>
                      <p className="font-mono font-semibold text-lg">
                        {user.matricule}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-l-bg-2 dark:bg-d-bg-2">
                    <div className="p-2.5 rounded-lg bg-primary/10">
                      <Clock className="size-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-l-text-2 dark:text-d-text-2">
                        Member Since
                      </p>
                      <p className="font-medium">
                        {new Date(user.date_joined).toLocaleDateString(
                          'en-US',
                          {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          }
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Personal Information Card */}
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <User className="size-5 text-primary" />
                  Personal Information
                </CardTitle>
                <CardDescription>
                  {isEditingProfile
                    ? 'Edit your personal details'
                    : 'Your personal details'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Name Section */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label
                      htmlFor="first_name"
                      className="text-sm font-medium flex items-center gap-2"
                    >
                      <User className="size-4 text-l-text-3 dark:text-d-text-3" />
                      First Name
                    </Label>
                    {isEditingProfile ? (
                      <Input
                        id="first_name"
                        value={editFormData.first_name}
                        onChange={e =>
                          setEditFormData({
                            ...editFormData,
                            first_name: e.target.value,
                          })
                        }
                        className="h-11"
                        placeholder="Enter first name"
                      />
                    ) : (
                      <p className="h-11 flex items-center px-3 rounded-md bg-l-bg-2 dark:bg-d-bg-2 font-medium">
                        {user.first_name || '—'}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="last_name"
                      className="text-sm font-medium flex items-center gap-2"
                    >
                      <User className="size-4 text-l-text-3 dark:text-d-text-3" />
                      Last Name
                    </Label>
                    {isEditingProfile ? (
                      <Input
                        id="last_name"
                        value={editFormData.last_name}
                        onChange={e =>
                          setEditFormData({
                            ...editFormData,
                            last_name: e.target.value,
                          })
                        }
                        className="h-11"
                        placeholder="Enter last name"
                      />
                    ) : (
                      <p className="h-11 flex items-center px-3 rounded-md bg-l-bg-2 dark:bg-d-bg-2 font-medium">
                        {user.last_name || '—'}
                      </p>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Contact Section */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label
                      htmlFor="email"
                      className="text-sm font-medium flex items-center gap-2"
                    >
                      <Mail className="size-4 text-l-text-3 dark:text-d-text-3" />
                      Email Address
                    </Label>
                    {isEditingProfile ? (
                      <Input
                        id="email"
                        type="email"
                        value={editFormData.email}
                        onChange={e =>
                          setEditFormData({
                            ...editFormData,
                            email: e.target.value,
                          })
                        }
                        className="h-11"
                        placeholder="Enter email"
                      />
                    ) : (
                      <p className="h-11 flex items-center px-3 rounded-md bg-l-bg-2 dark:bg-d-bg-2 font-medium truncate">
                        {user.email}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="phone"
                      className="text-sm font-medium flex items-center gap-2"
                    >
                      <Phone className="size-4 text-l-text-3 dark:text-d-text-3" />
                      Phone Number
                    </Label>
                    {isEditingProfile ? (
                      <Input
                        id="phone"
                        value={editFormData.phone}
                        onChange={e =>
                          setEditFormData({
                            ...editFormData,
                            phone: e.target.value,
                          })
                        }
                        className="h-11"
                        placeholder="+216 XX XXX XXX"
                      />
                    ) : (
                      <p className="h-11 flex items-center px-3 rounded-md bg-l-bg-2 dark:bg-d-bg-2 font-medium">
                        {user.profile?.phone || '—'}
                      </p>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Demographics Section */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label
                      htmlFor="birth_date"
                      className="text-sm font-medium flex items-center gap-2"
                    >
                      <Calendar className="size-4 text-l-text-3 dark:text-d-text-3" />
                      Date of Birth
                    </Label>
                    {isEditingProfile ? (
                      <Input
                        id="birth_date"
                        type="date"
                        value={editFormData.birth_date}
                        onChange={e =>
                          setEditFormData({
                            ...editFormData,
                            birth_date: e.target.value,
                          })
                        }
                        className="h-11"
                      />
                    ) : (
                      <p className="h-11 flex items-center px-3 rounded-md bg-l-bg-2 dark:bg-d-bg-2 font-medium">
                        {user.profile?.birth_date
                          ? new Date(
                              user.profile.birth_date
                            ).toLocaleDateString()
                          : '—'}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="gender" className="text-sm font-medium">
                      Gender
                    </Label>
                    {isEditingProfile ? (
                      <Select
                        value={editFormData.gender}
                        onValueChange={value =>
                          setEditFormData({
                            ...editFormData,
                            gender: value as 'M' | 'F',
                          })
                        }
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="M">Male</SelectItem>
                          <SelectItem value="F">Female</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="h-11 flex items-center px-3 rounded-md bg-l-bg-2 dark:bg-d-bg-2 font-medium">
                        {user.profile?.gender === 'M'
                          ? 'Male'
                          : user.profile?.gender === 'F'
                            ? 'Female'
                            : '—'}
                      </p>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Location Section */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label
                      htmlFor="nationality"
                      className="text-sm font-medium flex items-center gap-2"
                    >
                      <Globe className="size-4 text-l-text-3 dark:text-d-text-3" />
                      Nationality
                    </Label>
                    {isEditingProfile ? (
                      <Input
                        id="nationality"
                        value={editFormData.nationality}
                        onChange={e =>
                          setEditFormData({
                            ...editFormData,
                            nationality: e.target.value,
                          })
                        }
                        className="h-11"
                        placeholder="e.g., Tunisian"
                      />
                    ) : (
                      <p className="h-11 flex items-center px-3 rounded-md bg-l-bg-2 dark:bg-d-bg-2 font-medium">
                        {user.profile?.nationality || '—'}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="city"
                      className="text-sm font-medium flex items-center gap-2"
                    >
                      <MapPin className="size-4 text-l-text-3 dark:text-d-text-3" />
                      City
                    </Label>
                    {isEditingProfile ? (
                      <Select
                        value={editFormData.city}
                        onValueChange={value =>
                          setEditFormData({ ...editFormData, city: value })
                        }
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder="Select city" />
                        </SelectTrigger>
                        <SelectContent>
                          {TUNISIA_CITIES.map(city => (
                            <SelectItem key={city} value={city}>
                              {city}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="h-11 flex items-center px-3 rounded-md bg-l-bg-2 dark:bg-d-bg-2 font-medium">
                        {user.profile?.city || '—'}
                      </p>
                    )}
                  </div>
                </div>

                {/* Address Section */}
                <div className="space-y-2">
                  <Label
                    htmlFor="address"
                    className="text-sm font-medium flex items-center gap-2"
                  >
                    <Home className="size-4 text-l-text-3 dark:text-d-text-3" />
                    Full Address
                  </Label>
                  {isEditingProfile ? (
                    <Input
                      id="address"
                      value={editFormData.address}
                      onChange={e =>
                        setEditFormData({
                          ...editFormData,
                          address: e.target.value,
                        })
                      }
                      className="h-11"
                      placeholder="Enter your full address"
                    />
                  ) : (
                    <p className="h-11 flex items-center px-3 rounded-md bg-l-bg-2 dark:bg-d-bg-2 font-medium">
                      {user.profile?.address || '—'}
                    </p>
                  )}
                </div>

                <Separator />

                {/* Emergency Contact */}
                <div className="space-y-2">
                  <Label
                    htmlFor="emergency_phone"
                    className="text-sm font-medium flex items-center gap-2"
                  >
                    <Phone className="size-4 text-l-text-3 dark:text-d-text-3" />
                    Emergency Contact Phone
                  </Label>
                  {isEditingProfile ? (
                    <Input
                      id="emergency_phone"
                      value={editFormData.emergency_phone}
                      onChange={e =>
                        setEditFormData({
                          ...editFormData,
                          emergency_phone: e.target.value,
                        })
                      }
                      className="h-11"
                      placeholder="+216 XX XXX XXX"
                    />
                  ) : (
                    <p className="h-11 flex items-center px-3 rounded-md bg-l-bg-2 dark:bg-d-bg-2 font-medium">
                      {user.profile?.emergency_phone || '—'}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Identity Documents Card */}
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <CreditCard className="size-5 text-primary" />
                  Identity Documents
                </CardTitle>
                <CardDescription>
                  Your CIN and identity verification documents
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* CIN Number */}
                <div className="space-y-2">
                  <Label
                    htmlFor="cin_number"
                    className="text-sm font-medium flex items-center gap-2"
                  >
                    <CreditCard className="size-4 text-l-text-3 dark:text-d-text-3" />
                    CIN Number
                  </Label>
                  {isEditingProfile ? (
                    <Input
                      id="cin_number"
                      value={editFormData.cin_number}
                      onChange={e =>
                        setEditFormData({
                          ...editFormData,
                          cin_number: e.target.value,
                        })
                      }
                      className="h-11"
                      placeholder="Enter your CIN number"
                    />
                  ) : (
                    <p className="h-11 flex items-center px-3 rounded-md bg-l-bg-2 dark:bg-d-bg-2 font-medium">
                      {user.profile?.cin_number || '—'}
                    </p>
                  )}
                </div>

                {/* CIN Documents */}
                <div className="grid gap-6 sm:grid-cols-2">
                  {/* CIN Front */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <FileText className="size-4 text-l-text-3 dark:text-d-text-3" />
                      CIN Front
                    </Label>
                    {isEditingProfile ? (
                      <div className="space-y-2">
                        {(cinFrontPreview || user.profile?.cin_front) && (
                          <div className="relative group">
                            <img
                              src={
                                cinFrontPreview ||
                                getMediaUrl(user.profile?.cin_front) ||
                                ''
                              }
                              alt="CIN Front"
                              className="w-full h-32 object-cover rounded-lg border"
                            />
                            {cinFrontPreview && (
                              <button
                                type="button"
                                onClick={removeCinFront}
                                className="absolute top-2 right-2 p-1.5 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            )}
                          </div>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => cinFrontInputRef.current?.click()}
                          className="w-full gap-2"
                        >
                          <Upload className="size-4" />
                          {cinFrontPreview || user.profile?.cin_front
                            ? 'Change Image'
                            : 'Upload CIN Front'}
                        </Button>
                        <input
                          ref={cinFrontInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleCinFrontChange}
                          className="hidden"
                        />
                      </div>
                    ) : (
                      <div>
                        {user.profile?.cin_front ? (
                          <a
                            href={getMediaUrl(user.profile.cin_front)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block w-full h-32 rounded-lg border overflow-hidden hover:ring-2 hover:ring-primary transition-all"
                          >
                            <img
                              src={getMediaUrl(user.profile.cin_front)}
                              alt="CIN Front"
                              className="w-full h-full object-cover"
                            />
                          </a>
                        ) : (
                          <div className="flex items-center justify-center h-32 rounded-lg border-2 border-dashed text-l-text-3 dark:text-d-text-3">
                            <p className="text-sm">No document uploaded</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* CIN Back */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <FileText className="size-4 text-l-text-3 dark:text-d-text-3" />
                      CIN Back
                    </Label>
                    {isEditingProfile ? (
                      <div className="space-y-2">
                        {(cinBackPreview || user.profile?.cin_back) && (
                          <div className="relative group">
                            <img
                              src={
                                cinBackPreview ||
                                getMediaUrl(user.profile?.cin_back) ||
                                ''
                              }
                              alt="CIN Back"
                              className="w-full h-32 object-cover rounded-lg border"
                            />
                            {cinBackPreview && (
                              <button
                                type="button"
                                onClick={removeCinBack}
                                className="absolute top-2 right-2 p-1.5 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            )}
                          </div>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => cinBackInputRef.current?.click()}
                          className="w-full gap-2"
                        >
                          <Upload className="size-4" />
                          {cinBackPreview || user.profile?.cin_back
                            ? 'Change Image'
                            : 'Upload CIN Back'}
                        </Button>
                        <input
                          ref={cinBackInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleCinBackChange}
                          className="hidden"
                        />
                      </div>
                    ) : (
                      <div>
                        {user.profile?.cin_back ? (
                          <a
                            href={getMediaUrl(user.profile.cin_back)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block w-full h-32 rounded-lg border overflow-hidden hover:ring-2 hover:ring-primary transition-all"
                          >
                            <img
                              src={getMediaUrl(user.profile.cin_back)}
                              alt="CIN Back"
                              className="w-full h-full object-cover"
                            />
                          </a>
                        ) : (
                          <div className="flex items-center justify-center h-32 rounded-lg border-2 border-dashed text-l-text-3 dark:text-d-text-3">
                            <p className="text-sm">No document uploaded</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Education Card */}
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <GraduationCap className="size-5 text-primary" />
                  Education
                </CardTitle>
                <CardDescription>
                  Your educational background and qualifications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Education Level */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label
                      htmlFor="education_level"
                      className="text-sm font-medium flex items-center gap-2"
                    >
                      <GraduationCap className="size-4 text-l-text-3 dark:text-d-text-3" />
                      Education Level
                    </Label>
                    {isEditingProfile ? (
                      <Select
                        value={editFormData.education_level}
                        onValueChange={value =>
                          setEditFormData({
                            ...editFormData,
                            education_level: value as EducationLevel,
                          })
                        }
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder="Select education level" />
                        </SelectTrigger>
                        <SelectContent>
                          {EDUCATION_LEVELS.map(level => (
                            <SelectItem key={level.value} value={level.value}>
                              {level.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="h-11 flex items-center px-3 rounded-md bg-l-bg-2 dark:bg-d-bg-2 font-medium">
                        {user.profile?.education_level_display ||
                          user.profile?.education_level ||
                          '—'}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="diploma_title"
                      className="text-sm font-medium flex items-center gap-2"
                    >
                      <BookOpen className="size-4 text-l-text-3 dark:text-d-text-3" />
                      Diploma Title
                    </Label>
                    {isEditingProfile ? (
                      <Input
                        id="diploma_title"
                        value={editFormData.diploma_title}
                        onChange={e =>
                          setEditFormData({
                            ...editFormData,
                            diploma_title: e.target.value,
                          })
                        }
                        className="h-11"
                        placeholder="e.g., Bachelor of Computer Science"
                      />
                    ) : (
                      <p className="h-11 flex items-center px-3 rounded-md bg-l-bg-2 dark:bg-d-bg-2 font-medium">
                        {user.profile?.diploma_title || '—'}
                      </p>
                    )}
                  </div>
                </div>

                {/* Diploma File */}
                <div className="space-y-3">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <FileText className="size-4 text-l-text-3 dark:text-d-text-3" />
                    Diploma Document
                  </Label>
                  {isEditingProfile ? (
                    <div className="space-y-2">
                      {(diplomaPreview || user.profile?.diploma_file) && (
                        <div className="relative group p-4 rounded-lg border bg-l-bg-2 dark:bg-d-bg-2">
                          <div className="flex items-center gap-3">
                            <FileText className="size-8 text-primary" />
                            <div className="flex-1">
                              <p className="font-medium text-sm">
                                {diplomaFile?.name || 'Diploma Document'}
                              </p>
                              <p className="text-xs text-l-text-3 dark:text-d-text-3">
                                {diplomaFile
                                  ? `${(diplomaFile.size / 1024).toFixed(1)} KB`
                                  : 'Uploaded document'}
                              </p>
                            </div>
                            {diplomaPreview && (
                              <button
                                type="button"
                                onClick={removeDiploma}
                                className="p-1.5 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => diplomaInputRef.current?.click()}
                        className="w-full gap-2"
                      >
                        <Upload className="size-4" />
                        {diplomaPreview || user.profile?.diploma_file
                          ? 'Change Document'
                          : 'Upload Diploma'}
                      </Button>
                      <input
                        ref={diplomaInputRef}
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={handleDiplomaChange}
                        className="hidden"
                      />
                    </div>
                  ) : (
                    <div>
                      {user.profile?.diploma_file ? (
                        <a
                          href={getMediaUrl(user.profile.diploma_file)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 p-4 rounded-lg border hover:ring-2 hover:ring-primary transition-all bg-l-bg-2 dark:bg-d-bg-2"
                        >
                          <FileText className="size-8 text-primary" />
                          <div className="flex-1">
                            <p className="font-medium text-sm">
                              Diploma Document
                            </p>
                            <p className="text-xs text-l-text-3 dark:text-d-text-3">
                              Click to view
                            </p>
                          </div>
                        </a>
                      ) : (
                        <div className="flex items-center justify-center h-20 rounded-lg border-2 border-dashed text-l-text-3 dark:text-d-text-3">
                          <p className="text-sm">No document uploaded</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Organization Tab */}
          <TabsContent value="organization" className="space-y-6 mt-6">
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Building2 className="size-5 text-primary" />
                  Company & Brands
                </CardTitle>
                <CardDescription>
                  Your organizational assignments
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-l-bg-2 dark:bg-d-bg-2">
                    <div className="p-2.5 rounded-lg bg-primary/10">
                      <Building2 className="size-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-l-text-2 dark:text-d-text-2">
                        Company
                      </p>
                      <p className="font-semibold truncate">
                        {user.company_name || 'Not assigned'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-4 rounded-xl bg-l-bg-2 dark:bg-d-bg-2">
                    <div className="p-2.5 rounded-lg bg-primary/10">
                      <Settings className="size-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-l-text-2 dark:text-d-text-2">
                        Can Switch Brands
                      </p>
                      {user.can_switch_brands ? (
                        <Badge className="mt-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          <CheckCircle2 className="size-3 mr-1" />
                          Yes
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="mt-1">
                          No
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h4 className="font-medium flex items-center gap-2 text-l-text-1 dark:text-d-text-1">
                    <Tag className="size-4" />
                    Allowed Brands
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {user.allowed_brand_names &&
                    user.allowed_brand_names.length > 0 ? (
                      user.allowed_brand_names.map((brand, index) => (
                        <Badge
                          key={index}
                          variant="outline"
                          className="gap-1.5 px-3 py-1.5 text-sm hover:bg-primary/5 transition-colors"
                        >
                          <Tag className="size-3" />
                          {brand}
                        </Badge>
                      ))
                    ) : (
                      <div className="flex items-center gap-2 text-l-text-3 dark:text-d-text-3 py-4">
                        <AlertCircle className="size-4" />
                        <span>No brands assigned to your account</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-6 mt-6">
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Key className="size-5 text-primary" />
                  Security Settings
                </CardTitle>
                <CardDescription>
                  Manage your password and security preferences
                </CardDescription>
              </CardHeader>
              <CardContent>
                <button
                  type="button"
                  onClick={() => setPasswordDialog(true)}
                  className="w-full flex items-center justify-between p-4 sm:p-5 rounded-xl border-2 border-dashed hover:border-primary hover:bg-primary/5 transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                      <Key className="size-6 text-primary" />
                    </div>
                    <div className="text-left">
                      <p className="font-semibold text-l-text-1 dark:text-d-text-1">
                        Change Password
                      </p>
                      <p className="text-sm text-l-text-2 dark:text-d-text-2 mt-0.5">
                        Update your password regularly to keep your account
                        secure
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="size-5 text-l-text-3 dark:text-d-text-3 group-hover:text-primary transition-colors" />
                </button>

                <div className="mt-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
                  <div className="flex gap-3">
                    <Shield className="size-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-amber-800 dark:text-amber-400">
                        Security Tips
                      </p>
                      <ul className="mt-2 text-sm text-amber-700 dark:text-amber-500 space-y-1">
                        <li>
                          • Use a strong password with at least 8 characters
                        </li>
                        <li>
                          • Include numbers, symbols, and mixed case letters
                        </li>
                        <li>• Never share your password with anyone</li>
                        <li>• Change your password regularly</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Change Password Dialog */}
      <Dialog open={passwordDialog} onOpenChange={setPasswordDialog}>
        <DialogContent className="max-w-md mx-4 sm:mx-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Key className="size-5 text-primary" />
              </div>
              Change Password
            </DialogTitle>
            <DialogDescription>
              Enter your current password and choose a new secure password
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {passwordError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <AlertCircle className="size-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-600 dark:text-red-400">
                  {passwordError}
                </p>
              </div>
            )}

            {/* Current Password */}
            <div className="space-y-2">
              <Label htmlFor="old_password" className="text-sm font-medium">
                Current Password
              </Label>
              <div className="relative">
                <Input
                  id="old_password"
                  type={showOldPassword ? 'text' : 'password'}
                  value={oldPassword}
                  onChange={e => setOldPassword(e.target.value)}
                  className="h-11 pr-10"
                  placeholder="Enter current password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 size-8"
                  onClick={() => setShowOldPassword(!showOldPassword)}
                >
                  {showOldPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* New Password */}
            <div className="space-y-2">
              <Label htmlFor="new_password" className="text-sm font-medium">
                New Password
              </Label>
              <div className="relative">
                <Input
                  id="new_password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="h-11 pr-10"
                  placeholder="Enter new password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 size-8"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                >
                  {showNewPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-l-text-3 dark:text-d-text-3">
                Must be at least 8 characters
              </p>
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirm_password" className="text-sm font-medium">
                Confirm New Password
              </Label>
              <div className="relative">
                <Input
                  id="confirm_password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="h-11 pr-10"
                  placeholder="Confirm new password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 size-8"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setPasswordDialog(false);
                  setOldPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setPasswordError(null);
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleChangePassword}
                disabled={isChangingPassword}
                className="flex-1 gap-2"
              >
                {isChangingPassword ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Key className="size-4" />
                )}
                Update Password
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <AlertDialog open={successDialog} onOpenChange={setSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="size-5 text-green-600" />
              </div>
              Success!
            </AlertDialogTitle>
            <AlertDialogDescription>{successMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setSuccessDialog(false)}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Error Dialog */}
      <AlertDialog open={errorDialog} onOpenChange={setErrorDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertCircle className="size-5 text-red-600" />
              </div>
              Error
            </AlertDialogTitle>
            <AlertDialogDescription>{errorMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorDialog(false)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
