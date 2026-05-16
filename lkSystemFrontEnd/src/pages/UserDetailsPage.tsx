import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Mail,
  Phone,
  Shield,
  Calendar,
  Building2,
  MapPin,
  User,
  FileText,
  GraduationCap,
  Pencil,
  Key,
  UserX,
  UserCheck,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { userService } from '@/services/user.service';
import type { UserDetails } from '@/types';
import { EDUCATION_LEVELS } from '@/types';
import { toast } from 'sonner';
import { getMediaUrl } from '@/utils/helpers';

export default function UserDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [user, setUser] = useState<UserDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  useEffect(() => {
    const fetchUserData = async () => {
      if (!id) return;

      setIsLoading(true);
      try {
        const userData = await userService.getUserById(parseInt(id));
        setUser(userData);
      } catch (error) {
        console.error('Failed to fetch user:', error);
        toast.error('Failed to load user details');
        navigate('/dashboard/users');
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserData();
  }, [id, navigate]);

  const handleToggleStatus = async () => {
    if (!user) return;

    try {
      await userService.toggleUserStatus(user.id, user.is_active);
      const action = user.is_active ? 'deactivated' : 'activated';
      toast.success(`User ${action} successfully`);
      // Refresh user data
      const updatedUser = await userService.getUserById(user.id);
      setUser(updatedUser);
    } catch (error) {
      console.error('Failed to toggle user status:', error);
      toast.error('Failed to update user status');
    }
  };

  const getInitials = (fullName: string) => {
    const parts = fullName.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return fullName.substring(0, 2).toUpperCase();
  };

  const getEducationLabel = (level: string | null) => {
    if (!level) return 'Not specified';
    const found = EDUCATION_LEVELS.find(l => l.value === level);
    return found?.label || level;
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Not specified';
    return new Date(dateString).toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex items-center gap-2">
          <Loader2 className="size-6 animate-spin" />
          <span>Loading user details...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center">
          <h2 className="text-xl font-semibold">User not found</h2>
          <p className="text-muted-foreground mt-2">
            The user you're looking for doesn't exist.
          </p>
          <Button asChild className="mt-4">
            <Link to="/dashboard/users">Back to Users</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/dashboard/users')}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">User Details</h1>
          <p className="text-muted-foreground mt-1">
            View complete user information
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPasswordDialogOpen(true)}>
            <Key className="size-4 mr-2" />
            Reset Password
          </Button>
          <Button variant="outline" onClick={handleToggleStatus}>
            {user.is_active ? (
              <>
                <UserX className="size-4 mr-2" />
                Deactivate
              </>
            ) : (
              <>
                <UserCheck className="size-4 mr-2" />
                Activate
              </>
            )}
          </Button>
          <Button asChild>
            <Link to={`/dashboard/users/${user.id}/edit`}>
              <Pencil className="size-4 mr-2" />
              Edit User
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile Card */}
        <Card className="lg:col-span-1">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center">
              <Avatar className="size-24">
                <AvatarImage
                  src={getMediaUrl(user.profile?.avatar) || undefined}
                  alt={user.full_name}
                />
                <AvatarFallback className="text-2xl">
                  {getInitials(user.full_name)}
                </AvatarFallback>
              </Avatar>
              <h3 className="text-xl font-semibold mt-4">{user.full_name}</h3>
              <p className="text-sm text-muted-foreground">{user.matricule}</p>

              <div className="flex gap-2 mt-4">
                <Badge
                  variant={
                    (user.role_name || '').toLowerCase().includes('admin')
                      ? 'default'
                      : 'secondary'
                  }
                >
                  <Shield className="size-3 mr-1" />
                  {user.role_name || 'No role'}
                </Badge>
                <Badge variant={user.is_active ? 'default' : 'destructive'}>
                  {user.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>

              {/* Profile Completion */}
              {user.profile && (
                <div className="w-full mt-6">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span>Profile Completion</span>
                    <span className="font-medium">
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

            <Separator className="my-6" />

            {/* Quick Info */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Mail className="size-4 text-muted-foreground" />
                <span className="text-sm">{user.email}</span>
              </div>
              {user.profile?.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="size-4 text-muted-foreground" />
                  <span className="text-sm">{user.profile.phone}</span>
                </div>
              )}
              {user.company_name && (
                <div className="flex items-center gap-3">
                  <Building2 className="size-4 text-muted-foreground" />
                  <span className="text-sm">{user.company_name}</span>
                </div>
              )}
              {user.profile?.city && (
                <div className="flex items-center gap-3">
                  <MapPin className="size-4 text-muted-foreground" />
                  <span className="text-sm">{user.profile.city}</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Calendar className="size-4 text-muted-foreground" />
                <span className="text-sm">
                  Joined {formatDate(user.date_joined)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Details Cards */}
        <div className="lg:col-span-2 space-y-6">
          {/* Account Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="size-5" />
                Account Information
              </CardTitle>
              <CardDescription>
                Basic account and access details
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    First Name
                  </label>
                  <p className="mt-1">{user.first_name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Last Name
                  </label>
                  <p className="mt-1">{user.last_name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Email
                  </label>
                  <p className="mt-1">{user.email}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Matricule
                  </label>
                  <p className="mt-1">
                    <code className="bg-muted px-2 py-1 rounded">
                      {user.matricule}
                    </code>
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Role
                  </label>
                  <p className="mt-1">{user.role_name || 'No role'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Can Switch Brands
                  </label>
                  <p className="mt-1">
                    {user.can_switch_brands ? (
                      <CheckCircle2 className="size-5 text-green-600 inline" />
                    ) : (
                      <XCircle className="size-5 text-muted-foreground inline" />
                    )}
                  </p>
                </div>
              </div>

              {/* Brands Access */}
              {(user.allowed_brand_names?.length ?? 0) > 0 && (
                <div className="mt-4">
                  <label className="text-sm font-medium text-muted-foreground">
                    Allowed Brands
                  </label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {user.allowed_brand_names?.map((brand, index) => (
                      <Badge key={index} variant="outline">
                        {brand}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Personal Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="size-5" />
                Personal Information
              </CardTitle>
              <CardDescription>
                Personal details and contact information
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Email
                  </label>
                  <p className="mt-1">{user.email}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Phone
                  </label>
                  <p className="mt-1">
                    {user.profile?.phone || 'Not specified'}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Emergency Phone
                  </label>
                  <p className="mt-1">
                    {user.profile?.emergency_phone || 'Not specified'}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Birth Date
                  </label>
                  <p className="mt-1">
                    {user.profile?.birth_date
                      ? formatDate(user.profile.birth_date)
                      : 'Not specified'}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Gender
                  </label>
                  <p className="mt-1">
                    {user.profile?.gender_display ||
                      (user.profile?.gender === 'M'
                        ? 'Male'
                        : user.profile?.gender === 'F'
                          ? 'Female'
                          : 'Not specified')}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Nationality
                  </label>
                  <p className="mt-1">
                    {user.profile?.nationality || 'Not specified'}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    City
                  </label>
                  <p className="mt-1">
                    {user.profile?.city || 'Not specified'}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Address
                  </label>
                  <p className="mt-1">
                    {user.profile?.address || 'Not specified'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-5" />
                Documents
              </CardTitle>
              <CardDescription>Identity documents and files</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    CIN Number
                  </label>
                  <p className="mt-1">
                    {user.profile?.cin_number || 'Not provided'}
                  </p>
                  {user.profile?.cin_front && (
                    <a
                      href={user.profile.cin_front}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      View CIN Front
                    </a>
                  )}
                  {user.profile?.cin_back && (
                    <a
                      href={user.profile.cin_back}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline ml-2"
                    >
                      View CIN Back
                    </a>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Passport Number
                  </label>
                  <p className="mt-1">
                    {user.profile?.passport_number || 'Not provided'}
                  </p>
                  {user.profile?.passport_image && (
                    <a
                      href={user.profile.passport_image}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      View Passport
                    </a>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Education */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="size-5" />
                Education
              </CardTitle>
              <CardDescription>Educational background</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Education Level
                  </label>
                  <p className="mt-1">
                    {user.profile?.education_level_display ||
                      getEducationLabel(user.profile?.education_level ?? null)}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Diploma Title
                  </label>
                  <p className="mt-1">
                    {user.profile?.diploma_title || 'Not specified'}
                  </p>
                  {user.profile?.diploma_file && (
                    <a
                      href={user.profile.diploma_file}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      View Diploma
                    </a>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Change Password Modal */}
      <ChangePasswordModal
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
        userId={user.id}
        userName={user.full_name}
        isAdminReset={true}
        onSuccess={() => {
          toast.success(`Password updated successfully for ${user.full_name}`, {
            description:
              'The user will need to use the new password on their next login.',
            duration: 5000,
          });
        }}
      />
    </div>
  );
}
