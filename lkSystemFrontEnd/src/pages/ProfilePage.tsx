import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Camera,
  Upload,
  FileText,
  GraduationCap,
  Loader2,
  Check,
  Phone,
  Home,
  Calendar,
  Save,
  X,
  MapPin,
  Globe,
  Key,
  Shield,
  User,
  Building2,
  Mail,
  BadgeCheck,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { profileService } from '@/services/profile.service';
import type { UserProfileFull, EducationLevel } from '@/types';
import { EDUCATION_LEVELS } from '@/types';
import { useAuthStore } from '@/store/authStore';
import { toast } from 'sonner';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { getMediaUrl } from '@/utils/helpers';

const profileSchema = z.object({
  phone: z.string().optional(),
  emergency_phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  nationality: z.string().optional(),
  birth_date: z.string().optional(),
  gender: z.enum(['M', 'F', 'O']).optional().nullable(),
  education_level: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export default function ProfilePage() {
  const { user: currentUser } = useAuthStore();
  const [profile, setProfile] = useState<UserProfileFull | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState<string | null>(
    null
  );
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('personal');

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const cinInputRef = useRef<HTMLInputElement>(null);
  const passportInputRef = useRef<HTMLInputElement>(null);
  const diplomaInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
  });

  const watchedEducationLevel = watch('education_level');
  const watchedGender = watch('gender');

  // Fetch profile
  const fetchProfile = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await profileService.getMyProfile();
      setProfile(data);

      // Populate form
      setValue('phone', data.phone || '');
      setValue('emergency_phone', data.emergency_phone || '');
      setValue('address', data.address || '');
      setValue('city', data.city || '');
      setValue('nationality', data.nationality || '');
      setValue('birth_date', data.birth_date || '');
      setValue('gender', data.gender);
      setValue('education_level', data.education_level || '');
    } catch (error) {
      console.error('Failed to fetch profile:', error);
      toast.error('Failed to load profile');
    } finally {
      setIsLoading(false);
    }
  }, [setValue]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Calculate profile completion
  const calculateCompletion = (): number => {
    if (!profile) return 0;

    const fields = [
      profile.phone,
      profile.address,
      profile.city,
      profile.birth_date,
      profile.education_level,
      profile.avatar,
      profile.cin_front,
      profile.passport_image,
    ];

    const filledFields = fields.filter(f => f && f !== '').length;
    return Math.round((filledFields / fields.length) * 100);
  };

  // Handle avatar upload
  const handleAvatarClick = () => {
    avatarInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB');
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const updatedProfile = await profileService.uploadAvatar(
        profile.id,
        file
      );
      setProfile(updatedProfile);
      toast.success('Avatar updated successfully');
    } catch (error) {
      console.error('Failed to upload avatar:', error);
      toast.error('Failed to upload avatar');
    } finally {
      setIsUploadingAvatar(false);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = '';
      }
    }
  };

  // Handle document uploads
  const handleCINUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File must be less than 10MB');
      return;
    }

    setUploadingDocument('cin');
    try {
      // Upload with CIN number (use existing or empty)
      const cinNumber = profile.cin_number || 'CIN';
      const updatedProfile = await profileService.uploadCIN(
        profile.id,
        cinNumber,
        file
      );
      setProfile(updatedProfile);
      toast.success('CIN document uploaded successfully');
    } catch (error) {
      console.error('Failed to upload CIN:', error);
      toast.error('Failed to upload CIN document');
    } finally {
      setUploadingDocument(null);
      if (cinInputRef.current) cinInputRef.current.value = '';
    }
  };

  const handlePassportUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File must be less than 10MB');
      return;
    }

    setUploadingDocument('passport');
    try {
      const passportNumber = profile.passport_number || 'PASSPORT';
      const updatedProfile = await profileService.uploadPassport(
        profile.id,
        passportNumber,
        file
      );
      setProfile(updatedProfile);
      toast.success('Passport document uploaded successfully');
    } catch (error) {
      console.error('Failed to upload passport:', error);
      toast.error('Failed to upload passport document');
    } finally {
      setUploadingDocument(null);
      if (passportInputRef.current) passportInputRef.current.value = '';
    }
  };

  const handleDiplomaUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File must be less than 10MB');
      return;
    }

    setUploadingDocument('diploma');
    try {
      const educationLevel = profile.education_level || 'OTHER';
      const diplomaTitle = profile.diploma_title || 'Diploma';
      const updatedProfile = await profileService.uploadDiploma(
        profile.id,
        educationLevel,
        diplomaTitle,
        file
      );
      setProfile(updatedProfile);
      toast.success('Diploma document uploaded successfully');
    } catch (error) {
      console.error('Failed to upload diploma:', error);
      toast.error('Failed to upload diploma document');
    } finally {
      setUploadingDocument(null);
      if (diplomaInputRef.current) diplomaInputRef.current.value = '';
    }
  };

  // Handle form submit
  const onSubmit = async (data: ProfileFormData) => {
    if (!profile) return;

    setIsSaving(true);
    try {
      const updatedProfile = await profileService.updateProfile(profile.id, {
        phone: data.phone || undefined,
        emergency_phone: data.emergency_phone || undefined,
        address: data.address || undefined,
        city: data.city || undefined,
        nationality: data.nationality || undefined,
        birth_date: data.birth_date || undefined,
        gender: data.gender || undefined,
        education_level: (data.education_level as EducationLevel) || undefined,
      });
      setProfile(updatedProfile);
      setSuccessDialogOpen(true);
    } catch (error) {
      console.error('Failed to update profile:', error);
      toast.error('Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-l-text-2 dark:text-d-text-2">
          Failed to load profile
        </p>
      </div>
    );
  }

  const completion = calculateCompletion();

  // Get initials for avatar
  const getInitials = () => {
    if (currentUser?.full_name) {
      const names = currentUser.full_name.split(' ');
      return names
        .map(n => n.charAt(0))
        .slice(0, 2)
        .join('')
        .toUpperCase();
    }
    return currentUser?.email?.charAt(0).toUpperCase() || 'U';
  };

  return (
    <div className="flex flex-1 flex-col min-h-screen bg-gradient-to-b from-l-bg-1 to-l-bg-2 dark:from-d-bg-1 dark:to-d-bg-2">
      {/* Hero Header Section */}
      <div className="relative overflow-hidden bg-gradient-to-r from-primary/10 via-primary/5 to-transparent dark:from-primary/20 dark:via-primary/10">
        <div className="absolute inset-0 bg-grid-pattern opacity-5" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
            {/* Avatar with Upload */}
            <div className="relative group">
              <Avatar className="size-24 sm:size-32 ring-4 ring-background shadow-xl">
                <AvatarImage
                  src={getMediaUrl(profile.avatar) || undefined}
                  className="object-cover"
                />
                <AvatarFallback className="text-2xl sm:text-3xl font-semibold bg-primary/10 text-primary">
                  {getInitials()}
                </AvatarFallback>
              </Avatar>
              <Button
                size="icon"
                variant="secondary"
                className="absolute bottom-0 right-0 size-8 sm:size-10 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={handleAvatarClick}
                disabled={isUploadingAvatar}
              >
                {isUploadingAvatar ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Camera className="size-4" />
                )}
              </Button>
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
                  {currentUser?.full_name || 'User'}
                </h1>
                <Badge variant="secondary" className="w-fit">
                  <Shield className="size-3 mr-1" />
                  {currentUser?.role || 'User'}
                </Badge>
              </div>
              <p className="text-l-text-2 dark:text-d-text-2 mt-1 truncate">
                {currentUser?.email}
              </p>

              {/* Profile Completion Progress */}
              <div className="mt-4 max-w-xs">
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-l-text-2 dark:text-d-text-2">
                    Profile completion
                  </span>
                  <span className="font-semibold text-primary">
                    {completion}%
                  </span>
                </div>
                <Progress value={completion} className="h-2" />
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap gap-2 sm:gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChangePasswordOpen(true)}
                className="gap-2"
              >
                <Key className="size-4" />
                <span className="hidden sm:inline">Change Password</span>
                <span className="sm:hidden">Password</span>
              </Button>
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
          <TabsList className="w-full sm:w-auto grid grid-cols-3 sm:inline-flex h-auto p-1 bg-l-bg-2 dark:bg-d-bg-2">
            <TabsTrigger
              value="personal"
              className="gap-2 px-3 sm:px-4 py-2.5 data-[state=active]:bg-background"
            >
              <User className="size-4" />
              <span className="hidden sm:inline">Personal</span>
            </TabsTrigger>
            <TabsTrigger
              value="documents"
              className="gap-2 px-3 sm:px-4 py-2.5 data-[state=active]:bg-background"
            >
              <FileText className="size-4" />
              <span className="hidden sm:inline">Documents</span>
            </TabsTrigger>
            <TabsTrigger
              value="account"
              className="gap-2 px-3 sm:px-4 py-2.5 data-[state=active]:bg-background"
            >
              <Shield className="size-4" />
              <span className="hidden sm:inline">Account</span>
            </TabsTrigger>
          </TabsList>

          {/* Personal Information Tab */}
          <TabsContent value="personal" className="space-y-6 mt-6">
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <User className="size-5 text-primary" />
                  Personal Information
                </CardTitle>
                <CardDescription>
                  Update your personal details and contact information
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                  {/* Contact Information */}
                  <div className="space-y-4">
                    <h3 className="font-medium text-sm text-l-text-2 dark:text-d-text-2 uppercase tracking-wider">
                      Contact Information
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label
                          htmlFor="phone"
                          className="flex items-center gap-2 text-sm"
                        >
                          <Phone className="size-4 text-l-text-3 dark:text-d-text-3" />
                          Phone Number
                        </Label>
                        <Input
                          id="phone"
                          {...register('phone')}
                          placeholder="+216 XX XXX XXX"
                          className="h-11"
                        />
                        {errors.phone && (
                          <p className="text-sm text-red-500">
                            {errors.phone.message}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label
                          htmlFor="emergency_phone"
                          className="flex items-center gap-2 text-sm"
                        >
                          <Phone className="size-4 text-l-text-3 dark:text-d-text-3" />
                          Emergency Contact
                        </Label>
                        <Input
                          id="emergency_phone"
                          {...register('emergency_phone')}
                          placeholder="+216 XX XXX XXX"
                          className="h-11"
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Personal Details */}
                  <div className="space-y-4">
                    <h3 className="font-medium text-sm text-l-text-2 dark:text-d-text-2 uppercase tracking-wider">
                      Personal Details
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label
                          htmlFor="birth_date"
                          className="flex items-center gap-2 text-sm"
                        >
                          <Calendar className="size-4 text-l-text-3 dark:text-d-text-3" />
                          Date of Birth
                        </Label>
                        <Input
                          id="birth_date"
                          type="date"
                          {...register('birth_date')}
                          className="h-11"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="gender" className="text-sm">
                          Gender
                        </Label>
                        <Select
                          value={watchedGender || ''}
                          onValueChange={value =>
                            setValue('gender', value as 'M' | 'F' | 'O', {
                              shouldDirty: true,
                            })
                          }
                        >
                          <SelectTrigger className="h-11">
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="M">Male</SelectItem>
                            <SelectItem value="F">Female</SelectItem>
                            <SelectItem value="O">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Address */}
                  <div className="space-y-4">
                    <h3 className="font-medium text-sm text-l-text-2 dark:text-d-text-2 uppercase tracking-wider">
                      Address
                    </h3>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label
                          htmlFor="address"
                          className="flex items-center gap-2 text-sm"
                        >
                          <Home className="size-4 text-l-text-3 dark:text-d-text-3" />
                          Street Address
                        </Label>
                        <Input
                          id="address"
                          {...register('address')}
                          placeholder="Enter your street address"
                          className="h-11"
                        />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label
                            htmlFor="city"
                            className="flex items-center gap-2 text-sm"
                          >
                            <MapPin className="size-4 text-l-text-3 dark:text-d-text-3" />
                            City
                          </Label>
                          <Input
                            id="city"
                            {...register('city')}
                            placeholder="Enter your city"
                            className="h-11"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label
                            htmlFor="nationality"
                            className="flex items-center gap-2 text-sm"
                          >
                            <Globe className="size-4 text-l-text-3 dark:text-d-text-3" />
                            Nationality
                          </Label>
                          <Input
                            id="nationality"
                            {...register('nationality')}
                            placeholder="Enter your nationality"
                            className="h-11"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Education */}
                  <div className="space-y-4">
                    <h3 className="font-medium text-sm text-l-text-2 dark:text-d-text-2 uppercase tracking-wider">
                      Education
                    </h3>
                    <div className="space-y-2">
                      <Label
                        htmlFor="education_level"
                        className="flex items-center gap-2 text-sm"
                      >
                        <GraduationCap className="size-4 text-l-text-3 dark:text-d-text-3" />
                        Education Level
                      </Label>
                      <Select
                        value={watchedEducationLevel || ''}
                        onValueChange={value =>
                          setValue('education_level', value, {
                            shouldDirty: true,
                          })
                        }
                      >
                        <SelectTrigger className="h-11 max-w-md">
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
                    </div>
                  </div>

                  {/* Form Actions */}
                  <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fetchProfile()}
                      disabled={!isDirty}
                      className="w-full sm:w-auto"
                    >
                      <X className="size-4 mr-2" />
                      Discard Changes
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSaving || !isDirty}
                      className="w-full sm:w-auto"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="size-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="size-4 mr-2" />
                          Save Changes
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="space-y-6 mt-6">
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <FileText className="size-5 text-primary" />
                  Identity Documents
                </CardTitle>
                <CardDescription>
                  Upload your identification and educational documents
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {/* CIN Document */}
                  <button
                    type="button"
                    className="group relative flex flex-col items-center gap-4 rounded-xl border-2 border-dashed p-6 transition-all hover:border-primary hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    onClick={() => cinInputRef.current?.click()}
                    disabled={uploadingDocument === 'cin'}
                  >
                    <input
                      ref={cinInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={handleCINUpload}
                      className="hidden"
                    />
                    <div
                      className={`relative p-4 rounded-full transition-colors ${
                        profile.cin_front
                          ? 'bg-green-100 dark:bg-green-900/30'
                          : 'bg-l-bg-2 dark:bg-d-bg-2 group-hover:bg-primary/10'
                      }`}
                    >
                      {uploadingDocument === 'cin' ? (
                        <Loader2 className="size-8 animate-spin text-primary" />
                      ) : profile.cin_front ? (
                        <BadgeCheck className="size-8 text-green-600" />
                      ) : (
                        <FileText className="size-8 text-l-text-2 dark:text-d-text-2 group-hover:text-primary transition-colors" />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="font-semibold">CIN / National ID</p>
                      <p className="text-sm text-l-text-3 dark:text-d-text-3 mt-1">
                        Government-issued ID card
                      </p>
                    </div>
                    {profile.cin_front ? (
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-100">
                        <Check className="size-3 mr-1" />
                        Uploaded
                      </Badge>
                    ) : (
                      <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
                        <Upload className="size-4" />
                        Click to upload
                      </div>
                    )}
                  </button>

                  {/* Passport Document */}
                  <button
                    type="button"
                    className="group relative flex flex-col items-center gap-4 rounded-xl border-2 border-dashed p-6 transition-all hover:border-primary hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    onClick={() => passportInputRef.current?.click()}
                    disabled={uploadingDocument === 'passport'}
                  >
                    <input
                      ref={passportInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={handlePassportUpload}
                      className="hidden"
                    />
                    <div
                      className={`relative p-4 rounded-full transition-colors ${
                        profile.passport_image
                          ? 'bg-green-100 dark:bg-green-900/30'
                          : 'bg-l-bg-2 dark:bg-d-bg-2 group-hover:bg-primary/10'
                      }`}
                    >
                      {uploadingDocument === 'passport' ? (
                        <Loader2 className="size-8 animate-spin text-primary" />
                      ) : profile.passport_image ? (
                        <BadgeCheck className="size-8 text-green-600" />
                      ) : (
                        <FileText className="size-8 text-l-text-2 dark:text-d-text-2 group-hover:text-primary transition-colors" />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="font-semibold">Passport</p>
                      <p className="text-sm text-l-text-3 dark:text-d-text-3 mt-1">
                        International travel document
                      </p>
                    </div>
                    {profile.passport_image ? (
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-100">
                        <Check className="size-3 mr-1" />
                        Uploaded
                      </Badge>
                    ) : (
                      <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
                        <Upload className="size-4" />
                        Click to upload
                      </div>
                    )}
                  </button>

                  {/* Diploma Document */}
                  <button
                    type="button"
                    className="group relative flex flex-col items-center gap-4 rounded-xl border-2 border-dashed p-6 transition-all hover:border-primary hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    onClick={() => diplomaInputRef.current?.click()}
                    disabled={uploadingDocument === 'diploma'}
                  >
                    <input
                      ref={diplomaInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={handleDiplomaUpload}
                      className="hidden"
                    />
                    <div
                      className={`relative p-4 rounded-full transition-colors ${
                        profile.diploma_file
                          ? 'bg-green-100 dark:bg-green-900/30'
                          : 'bg-l-bg-2 dark:bg-d-bg-2 group-hover:bg-primary/10'
                      }`}
                    >
                      {uploadingDocument === 'diploma' ? (
                        <Loader2 className="size-8 animate-spin text-primary" />
                      ) : profile.diploma_file ? (
                        <BadgeCheck className="size-8 text-green-600" />
                      ) : (
                        <GraduationCap className="size-8 text-l-text-2 dark:text-d-text-2 group-hover:text-primary transition-colors" />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="font-semibold">Diploma / Certificate</p>
                      <p className="text-sm text-l-text-3 dark:text-d-text-3 mt-1">
                        Educational qualification
                      </p>
                    </div>
                    {profile.diploma_file ? (
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-100">
                        <Check className="size-3 mr-1" />
                        Uploaded
                      </Badge>
                    ) : (
                      <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
                        <Upload className="size-4" />
                        Click to upload
                      </div>
                    )}
                  </button>
                </div>

                <div className="mt-6 p-4 rounded-lg bg-l-bg-2 dark:bg-d-bg-2">
                  <p className="text-sm text-l-text-2 dark:text-d-text-2">
                    <span className="font-medium">Accepted formats:</span> PDF,
                    JPG, PNG
                    <span className="mx-2">•</span>
                    <span className="font-medium">Max size:</span> 10MB per file
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Account Tab */}
          <TabsContent value="account" className="space-y-6 mt-6">
            {/* Account Information */}
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Shield className="size-5 text-primary" />
                  Account Information
                </CardTitle>
                <CardDescription>
                  Your account details are managed by the administrator
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="flex items-start gap-3 p-4 rounded-lg bg-l-bg-2 dark:bg-d-bg-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Mail className="size-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-l-text-2 dark:text-d-text-2">
                        Email Address
                      </p>
                      <p className="font-medium truncate">
                        {currentUser?.email || '—'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-4 rounded-lg bg-l-bg-2 dark:bg-d-bg-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <BadgeCheck className="size-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-l-text-2 dark:text-d-text-2">
                        Matricule
                      </p>
                      <p className="font-medium font-mono">
                        {currentUser?.matricule || '—'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-4 rounded-lg bg-l-bg-2 dark:bg-d-bg-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Shield className="size-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-l-text-2 dark:text-d-text-2">
                        Role
                      </p>
                      <Badge variant="secondary" className="mt-1">
                        {currentUser?.role || '—'}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-4 rounded-lg bg-l-bg-2 dark:bg-d-bg-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Building2 className="size-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-l-text-2 dark:text-d-text-2">
                        Company
                      </p>
                      <p className="font-medium">
                        {currentUser?.company_id
                          ? `Company #${currentUser.company_id}`
                          : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Security Settings */}
            <Card className="border-0 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Key className="size-5 text-primary" />
                  Security
                </CardTitle>
                <CardDescription>
                  Manage your password and security settings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <button
                  type="button"
                  onClick={() => setChangePasswordOpen(true)}
                  className="w-full flex items-center justify-between p-4 rounded-lg border hover:bg-l-bg-2 dark:hover:bg-d-bg-2 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Key className="size-5 text-primary" />
                    </div>
                    <div className="text-left">
                      <p className="font-medium">Change Password</p>
                      <p className="text-sm text-l-text-2 dark:text-d-text-2">
                        Update your password regularly to keep your account
                        secure
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="size-5 text-l-text-3 dark:text-d-text-3 group-hover:text-primary transition-colors" />
                </button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Change Password Modal */}
      <ChangePasswordModal
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
        userId={
          typeof currentUser?.id === 'string'
            ? Number.parseInt(currentUser.id, 10)
            : currentUser?.id || 0
        }
        userName={currentUser?.full_name || 'User'}
        isAdminReset={false}
        onSuccess={() => {
          toast.success('Password changed successfully');
        }}
      />

      {/* Success Dialog */}
      <AlertDialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/30">
                <Check className="size-5 text-green-600" />
              </div>
              Profile Updated Successfully
            </AlertDialogTitle>
            <AlertDialogDescription>
              Your personal information has been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setSuccessDialogOpen(false)}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
