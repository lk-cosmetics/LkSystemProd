import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft,
  Save,
  Loader2,
  User,
  Building2,
  Shield,
  Phone,
  Calendar,
  MapPin,
  Globe,
  CreditCard,
  Upload,
  Camera,
  FileText,
  X,
  Eye,
  Store,
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
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { userService } from '@/services/user.service';
import { profileService } from '@/services/profile.service';
import { companyService } from '@/services/company.service';
import { brandService } from '@/services/brand.service';
import { rbacService, type RBACRole } from '@/services/rbac.service';
import { salesChannelService } from '@/services/salesChannel.service';
import type {
  UserDetails,
  CompanyListItem,
  Brand,
  SalesChannel,
  UpdateUserFullRequest,
} from '@/types';
import { toast } from 'sonner';

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

const editUserSchema = z.object({
  // Basic user info
  email: z.string().email('Invalid email address'),
  first_name: z.string().min(2, 'First name must be at least 2 characters'),
  last_name: z.string().min(2, 'Last name must be at least 2 characters'),
  current_company: z.number().nullable().optional(),
  can_switch_brands: z.boolean(),
  is_active: z.boolean(),
  // Profile fields
  phone: z.string().optional(),
  birth_date: z.string().optional(),
  gender: z.enum(['M', 'F', 'O', '']).optional(),
  nationality: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  cin_number: z.string().optional(),
});

type EditUserFormData = z.infer<typeof editUserSchema>;

export default function EditUserPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [user, setUser] = useState<UserDetails | null>(null);
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [filteredBrands, setFilteredBrands] = useState<Brand[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<number[]>([]);
  const [roles, setRoles] = useState<RBACRole[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [initialRoleId, setInitialRoleId] = useState<string>('');
  // Sales point (channel) for operational roles (Employee / Cashier).
  const [salesChannels, setSalesChannels] = useState<SalesChannel[]>([]);
  const [selectedSalesChannelId, setSelectedSalesChannelId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');

  // File states
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>('');
  const [cinFrontFile, setCinFrontFile] = useState<File | null>(null);
  const [cinFrontPreview, setCinFrontPreview] = useState<string>('');
  const [cinBackFile, setCinBackFile] = useState<File | null>(null);
  const [cinBackPreview, setCinBackPreview] = useState<string>('');

  // File input refs
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const cinFrontInputRef = useRef<HTMLInputElement>(null);
  const cinBackInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = useForm<EditUserFormData>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      is_active: true,
      can_switch_brands: false,
    },
  });

  const selectedCompany = watch('current_company');

  // Load the roles the logged-in user is allowed to assign for the selected
  // company (backend filters by the caller's permission ceiling).
  useEffect(() => {
    if (!selectedCompany) { setRoles([]); return; }
    rbacService
      .getRoles({ company: selectedCompany, assignable: true })
      .then(setRoles)
      .catch(() => setRoles([]));
  }, [selectedCompany]);

  // Initialise the role dropdown from the user's current role once both load.
  useEffect(() => {
    if (!user || roles.length === 0 || initialRoleId) return;
    const current = roles.find(r => r.name === user.role_name);
    if (current) {
      setInitialRoleId(String(current.id));
      setSelectedRoleId(String(current.id));
    }
  }, [user, roles, initialRoleId]);

  // Operational roles (Employee / Cashier) must be pinned to one sales point.
  const selectedRole = roles.find(r => String(r.id) === selectedRoleId);
  const requiresSalesPoint = !!selectedRole?.requires_sales_point;

  // Load the sales channels the user can be pinned to (those of their brands),
  // mirroring the Add-User dialog so the sales point can be set here too.
  useEffect(() => {
    if (selectedBrands.length === 0) {
      setSalesChannels([]);
      setSelectedSalesChannelId('');
      return;
    }
    salesChannelService
      .getAllChannels()
      .then(all => {
        const forBrands = all.filter(ch => selectedBrands.includes(ch.brand));
        setSalesChannels(forBrands);
        // Drop a stale selection that no longer belongs to the user's brands
        // (e.g. after a brand/company change) so an invalid id is never sent.
        setSelectedSalesChannelId(prev =>
          prev && forBrands.some(ch => String(ch.id) === prev) ? prev : ''
        );
      })
      .catch(() => setSalesChannels([]));
  }, [selectedBrands]);

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;

      setIsLoading(true);
      try {
        const [userData, companiesData, brandsData] =
          await Promise.all([
            userService.getUserById(Number.parseInt(id)),
            companyService.getAllCompanies(),
            brandService.getAllBrands(),
          ]);

        setUser(userData);
        setCompanies(companiesData);
        setBrands(brandsData);
        setSelectedBrands(userData.allowed_brands);
        if (userData.assigned_sales_channel) {
          setSelectedSalesChannelId(String(userData.assigned_sales_channel));
        }

        // Set avatar preview from existing data
        if (userData.profile?.avatar) {
          setAvatarPreview(userData.profile.avatar);
        }
        if (userData.profile?.cin_front) {
          setCinFrontPreview(userData.profile.cin_front);
        }
        if (userData.profile?.cin_back) {
          setCinBackPreview(userData.profile.cin_back);
        }

        // Set form values
        reset({
          email: userData.email,
          first_name: userData.first_name,
          last_name: userData.last_name,
          current_company: userData.current_company,
          can_switch_brands: userData.can_switch_brands,
          is_active: userData.is_active,
          // Profile fields
          phone: userData.profile?.phone || '',
          birth_date: userData.profile?.birth_date || '',
          gender: (userData.profile?.gender as 'M' | 'F' | 'O' | '') || '',
          nationality: userData.profile?.nationality || '',
          city: userData.profile?.city || '',
          address: userData.profile?.address || '',
          cin_number: userData.profile?.cin_number || '',
        });
      } catch (error) {
        console.error('Failed to fetch data:', error);
        toast.error('Failed to load user data');
        navigate('/dashboard/users');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [id, navigate, reset]);

  // Filter brands by selected company
  useEffect(() => {
    if (selectedCompany) {
      const filtered = brands.filter(
        brand => brand.company === selectedCompany
      );
      setFilteredBrands(filtered);
      setSelectedBrands(prev =>
        prev.filter(brandId => filtered.some(b => b.id === brandId))
      );
    } else {
      setFilteredBrands(brands);
    }
  }, [selectedCompany, brands]);

  const toggleBrand = (brandId: number) => {
    setSelectedBrands(prev =>
      prev.includes(brandId)
        ? prev.filter(bId => bId !== brandId)
        : [...prev, brandId]
    );
  };

  // File handlers
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
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setCinFrontPreview(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setCinFrontPreview(file.name);
      }
    }
  };

  const handleCinBackChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCinBackFile(file);
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setCinBackPreview(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setCinBackPreview(file.name);
      }
    }
  };

  const removeAvatar = () => {
    setAvatarFile(null);
    setAvatarPreview('');
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const removeCinFront = () => {
    setCinFrontFile(null);
    setCinFrontPreview('');
    if (cinFrontInputRef.current) cinFrontInputRef.current.value = '';
  };

  const removeCinBack = () => {
    setCinBackFile(null);
    setCinBackPreview('');
    if (cinBackInputRef.current) cinBackInputRef.current.value = '';
  };

  const onSubmit = async (data: EditUserFormData) => {
    if (!user) return;

    // Operational roles (Employee / Cashier) must be pinned to a sales point.
    if (requiresSalesPoint && !selectedSalesChannelId) {
      toast.error(
        salesChannels.length === 0
          ? 'This role works at a single sales point — give the user brand access, then pick a sales point.'
          : 'This role works at a single sales point — pick a sales point.'
      );
      return;
    }

    setIsSaving(true);
    try {
      // Update user basic info. Only PIN the sales point for an operational
      // role with a valid selection; never send null on an ordinary save —
      // set-role clears it server-side when switching to a non-operational
      // role, so an unrelated edit can't wipe an operational user's sales point.
      const payload: UpdateUserFullRequest = {
        email: data.email,
        first_name: data.first_name,
        last_name: data.last_name,
        current_company: data.current_company,
        allowed_brands: selectedBrands,
        can_switch_brands: data.can_switch_brands,
        is_active: data.is_active,
      };
      if (requiresSalesPoint && selectedSalesChannelId) {
        payload.assigned_sales_channel = Number(selectedSalesChannelId);
      }
      await userService.updateUserFull(user.id, payload);

      // Update profile with files if user has a profile
      if (user.profile?.id) {
        const profileData = {
          phone: data.phone,
          birth_date: data.birth_date || undefined,
          gender: data.gender || undefined,
          nationality: data.nationality,
          city: data.city,
          address: data.address,
          cin_number: data.cin_number,
        };

        const files: {
          avatar?: File;
          cin_front?: File;
          cin_back?: File;
        } = {};

        if (avatarFile) files.avatar = avatarFile;
        if (cinFrontFile) files.cin_front = cinFrontFile;
        if (cinBackFile) files.cin_back = cinBackFile;

        // Use file upload method if there are files, otherwise regular update
        if (Object.keys(files).length > 0) {
          await profileService.updateProfileWithFiles(
            user.profile.id,
            profileData,
            files
          );
        } else {
          await profileService.updateProfile(user.profile.id, profileData);
        }
      }

      // Apply a role change (if any) through the guarded RBAC endpoint, which
      // replaces the user's role at the scope it implies. Done last so the
      // basic-info save isn't blocked by a role-specific validation error.
      if (selectedRoleId && selectedRoleId !== initialRoleId) {
        await rbacService.setRole({
          user_id: Number(user.id),
          role_id: Number(selectedRoleId),
        });
        setInitialRoleId(selectedRoleId);
      }

      toast.success('User updated successfully');
      navigate(`/dashboard/users/${user.id}`);
    } catch (error) {
      console.error('Failed to update user:', error);
      const detail = (error as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Failed to update user');
    } finally {
      setIsSaving(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex items-center gap-2">
          <Loader2 className="size-6 animate-spin" />
          <span>Loading user data...</span>
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
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <Avatar className="size-12">
              <AvatarImage src={avatarPreview} alt={user.full_name} />
              <AvatarFallback>{getInitials(user.full_name)}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Edit User</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-muted-foreground">{user.full_name}</span>
                <Badge variant="outline">{user.matricule}</Badge>
                {user.is_active ? (
                  <Badge className="bg-green-500/10 text-green-600">
                    Active
                  </Badge>
                ) : (
                  <Badge variant="destructive">Inactive</Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="access">Access</TabsTrigger>
          </TabsList>

          {/* Basic Information Tab */}
          <TabsContent value="basic" className="space-y-6 mt-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Avatar Section */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Camera className="size-5" />
                    Profile Picture
                  </CardTitle>
                  <CardDescription>
                    Upload a profile picture for this user
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <Avatar className="size-32">
                      <AvatarImage src={avatarPreview} alt={user.full_name} />
                      <AvatarFallback className="text-2xl">
                        {getInitials(user.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    {avatarPreview && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute -top-2 -right-2 size-6"
                        onClick={removeAvatar}
                      >
                        <X className="size-3" />
                      </Button>
                    )}
                  </div>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarChange}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => avatarInputRef.current?.click()}
                    className="gap-2"
                  >
                    <Upload className="size-4" />
                    {avatarPreview ? 'Change Picture' : 'Upload Picture'}
                  </Button>
                </CardContent>
              </Card>

              {/* Basic Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="size-5" />
                    Basic Information
                  </CardTitle>
                  <CardDescription>User account details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="first_name">First Name *</Label>
                      <Input
                        id="first_name"
                        {...register('first_name')}
                        placeholder="First name"
                      />
                      {errors.first_name && (
                        <p className="text-sm text-red-500">
                          {errors.first_name.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="last_name">Last Name *</Label>
                      <Input
                        id="last_name"
                        {...register('last_name')}
                        placeholder="Last name"
                      />
                      {errors.last_name && (
                        <p className="text-sm text-red-500">
                          {errors.last_name.message}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      {...register('email')}
                      placeholder="Email address"
                    />
                    {errors.email && (
                      <p className="text-sm text-red-500">
                        {errors.email.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Matricule</Label>
                    <Input
                      value={user.matricule}
                      disabled
                      className="bg-muted"
                    />
                    <p className="text-xs text-muted-foreground">
                      Matricule cannot be changed
                    </p>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Account Status</Label>
                      <p className="text-sm text-muted-foreground">
                        {watch('is_active')
                          ? 'User can access the system'
                          : 'User is deactivated'}
                      </p>
                    </div>
                    <Switch
                      checked={watch('is_active')}
                      onCheckedChange={checked =>
                        setValue('is_active', checked)
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-6 mt-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Personal Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="size-5" />
                    Personal Information
                  </CardTitle>
                  <CardDescription>
                    Contact and personal details
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        id="phone"
                        {...register('phone')}
                        placeholder="+216 XX XXX XXX"
                        className="pl-10"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="birth_date">Birth Date</Label>
                      <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <Input
                          id="birth_date"
                          type="date"
                          {...register('birth_date')}
                          className="pl-10"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="gender">Gender</Label>
                      <Select
                        value={watch('gender') || ''}
                        onValueChange={value =>
                          setValue('gender', value as 'M' | 'F' | 'O' | '')
                        }
                      >
                        <SelectTrigger>
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

                  <div className="space-y-2">
                    <Label htmlFor="nationality">Nationality</Label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        id="nationality"
                        {...register('nationality')}
                        placeholder="Tunisian"
                        className="pl-10"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground z-10" />
                      <Select
                        value={watch('city') || ''}
                        onValueChange={value => setValue('city', value)}
                      >
                        <SelectTrigger className="pl-10">
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
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Input
                      id="address"
                      {...register('address')}
                      placeholder="Street address"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Identity Documents */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="size-5" />
                    Identity Documents
                  </CardTitle>
                  <CardDescription>
                    CIN and identification documents
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="cin_number">CIN Number</Label>
                    <div className="relative">
                      <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        id="cin_number"
                        {...register('cin_number')}
                        placeholder="12345678"
                        className="pl-10"
                      />
                    </div>
                  </div>

                  {/* CIN Front */}
                  <div className="space-y-2">
                    <Label>CIN Front</Label>
                    <input
                      ref={cinFrontInputRef}
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={handleCinFrontChange}
                    />
                    {cinFrontPreview ? (
                      <div className="relative border rounded-lg p-3">
                        <div className="flex items-center gap-3">
                          {cinFrontPreview.startsWith('http') ||
                          cinFrontPreview.startsWith('data:image') ? (
                            <img
                              src={cinFrontPreview}
                              alt="CIN Front"
                              className="size-16 object-cover rounded"
                            />
                          ) : (
                            <div className="size-16 bg-muted rounded flex items-center justify-center">
                              <FileText className="size-8 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1">
                            <p className="text-sm font-medium">
                              CIN Front Document
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {cinFrontFile
                                ? cinFrontFile.name
                                : 'Existing document'}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            {cinFrontPreview.startsWith('http') && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  globalThis.open(cinFrontPreview, '_blank')
                                }
                              >
                                <Eye className="size-4" />
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={removeCinFront}
                            >
                              <X className="size-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-20 border-dashed gap-2"
                        onClick={() => cinFrontInputRef.current?.click()}
                      >
                        <Upload className="size-5" />
                        Upload CIN Front
                      </Button>
                    )}
                  </div>

                  {/* CIN Back */}
                  <div className="space-y-2">
                    <Label>CIN Back</Label>
                    <input
                      ref={cinBackInputRef}
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={handleCinBackChange}
                    />
                    {cinBackPreview ? (
                      <div className="relative border rounded-lg p-3">
                        <div className="flex items-center gap-3">
                          {cinBackPreview.startsWith('http') ||
                          cinBackPreview.startsWith('data:image') ? (
                            <img
                              src={cinBackPreview}
                              alt="CIN Back"
                              className="size-16 object-cover rounded"
                            />
                          ) : (
                            <div className="size-16 bg-muted rounded flex items-center justify-center">
                              <FileText className="size-8 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1">
                            <p className="text-sm font-medium">
                              CIN Back Document
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {cinBackFile
                                ? cinBackFile.name
                                : 'Existing document'}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            {cinBackPreview.startsWith('http') && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  globalThis.open(cinBackPreview, '_blank')
                                }
                              >
                                <Eye className="size-4" />
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={removeCinBack}
                            >
                              <X className="size-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-20 border-dashed gap-2"
                        onClick={() => cinBackInputRef.current?.click()}
                      >
                        <Upload className="size-5" />
                        Upload CIN Back
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Access Tab */}
          <TabsContent value="access" className="space-y-6 mt-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Role & Company */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="size-5" />
                    Role & Access
                  </CardTitle>
                  <CardDescription>
                    Permissions and access level
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Select
                      value={selectedRoleId}
                      onValueChange={setSelectedRoleId}
                      disabled={!selectedCompany || roles.length === 0}
                    >
                      <SelectTrigger>
                        <Shield className="size-4 mr-2" />
                        <SelectValue
                          placeholder={
                            selectedCompany ? 'Select a role' : 'Select a company first'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map(r => (
                          <SelectItem key={r.id} value={String(r.id)}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-l-text-3 dark:text-d-text-3">
                      Only roles you are allowed to assign are shown. The role is
                      applied at the scope it implies (company / brand / sales point).
                    </p>
                  </div>

                  {/* Sales point — required for operational roles (Employee / Cashier) */}
                  {requiresSalesPoint && (
                    <div className="space-y-2">
                      <Label htmlFor="sales-point">Sales Point *</Label>
                      <Select
                        value={selectedSalesChannelId}
                        onValueChange={setSelectedSalesChannelId}
                        disabled={salesChannels.length === 0}
                      >
                        <SelectTrigger>
                          <Store className="size-4 mr-2" />
                          <SelectValue
                            placeholder={
                              salesChannels.length === 0
                                ? 'Give the user brand access first'
                                : 'Select a sales point'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {salesChannels.map(ch => (
                            <SelectItem key={ch.id} value={String(ch.id)}>
                              {ch.name} ({ch.brand_name})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-l-text-3 dark:text-d-text-3">
                        {selectedRole?.name} works at a single sales point — their
                        orders and POS are confined to it.
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="company">Company</Label>
                    <Select
                      value={watch('current_company')?.toString() || 'none'}
                      onValueChange={value =>
                        setValue(
                          'current_company',
                          value === 'none' ? null : Number.parseInt(value)
                        )
                      }
                    >
                      <SelectTrigger>
                        <Building2 className="size-4 mr-2" />
                        <SelectValue placeholder="Select a company" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Company</SelectItem>
                        {companies.map(company => (
                          <SelectItem
                            key={company.id}
                            value={company.id.toString()}
                          >
                            {company.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Can Switch Brands</Label>
                      <p className="text-sm text-muted-foreground">
                        {watch('can_switch_brands')
                          ? 'User can switch between assigned brands'
                          : 'User cannot switch brands'}
                      </p>
                    </div>
                    <Switch
                      checked={watch('can_switch_brands')}
                      onCheckedChange={checked =>
                        setValue('can_switch_brands', checked)
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Brand Access */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="size-5" />
                    Brand Access
                  </CardTitle>
                  <CardDescription>
                    Select which brands this user can access
                    {selectedCompany && ' (filtered by selected company)'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {filteredBrands.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {selectedCompany
                        ? 'No brands available for the selected company'
                        : 'No brands available'}
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {filteredBrands.map(brand => (
                        <button
                          key={brand.id}
                          type="button"
                          className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                            selectedBrands.includes(brand.id)
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-primary/50'
                          }`}
                          onClick={() => toggleBrand(brand.id)}
                        >
                          <div
                            className={`size-5 rounded border-2 flex items-center justify-center ${
                              selectedBrands.includes(brand.id)
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-muted-foreground'
                            }`}
                          >
                            {selectedBrands.includes(brand.id) && (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="size-3"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{brand.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {brand.company_name}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end sticky bottom-4 bg-background py-4 border-t">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving}>
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
    </div>
  );
}
