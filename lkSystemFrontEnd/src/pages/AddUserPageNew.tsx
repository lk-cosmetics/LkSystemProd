import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User,
  Mail,
  Lock,
  Shield,
  Upload,
  FileText,
  Download,
  Users,
  Camera,
  Building2,
  Loader2,
  Phone,
  Calendar,
  CreditCard,
  Globe,
  MapPin,
  Home,
  GraduationCap,
  BookOpen,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import { rbacService, type RBACRole } from '@/services/rbac.service';
import { companyService } from '@/services/company.service';
import { brandService } from '@/services/brand.service';
import type { CompanyListItem, Brand, EducationLevel } from '@/types';
import { EDUCATION_LEVELS } from '@/types';
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

// Zod validation schema
const userSchema = z
  .object({
    first_name: z.string().min(2, 'First name must be at least 2 characters'),
    last_name: z.string().min(2, 'Last name must be at least 2 characters'),
    email: z.string().email('Invalid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/^(?!\d+$)/, 'Password cannot be entirely numeric'),
    password_confirm: z.string(),
    role: z.number().nullable().optional(),
    current_company: z.number().nullable().optional(),
    // Profile fields
    phone: z.string().optional(),
    emergency_phone: z.string().optional(),
    birth_date: z.string().optional(),
    gender: z.enum(['M', 'F', 'O', '']).optional(),
    cin_number: z.string().optional(),
    nationality: z.string().optional(),
    city: z.string().optional(),
    address: z.string().optional(),
    education_level: z.string().optional(),
    diploma_title: z.string().optional(),
  })
  .refine(data => data.password === data.password_confirm, {
    message: "Passwords don't match",
    path: ['password_confirm'],
  });

type UserFormData = z.infer<typeof userSchema>;

interface ImportedUser {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  status: 'pending' | 'success' | 'error';
  error?: string;
}

export default function AddUserPage() {
  const navigate = useNavigate();

  // Data states
  const [roles, setRoles] = useState<RBACRole[]>([]);
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [filteredBrands, setFilteredBrands] = useState<Brand[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<number[]>([]);

  // UI states
  const [importedUsers, setImportedUsers] = useState<ImportedUser[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [createdUserName, setCreatedUserName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      current_company: null,
    },
  });

  const selectedCompany = watch('current_company');

  // Fetch roles, companies, and brands
  useEffect(() => {
    const fetchData = async () => {
      setIsLoadingData(true);
      try {
        const [rolesData, companiesData, brandsData] = await Promise.all([
          rbacService.getRoles(),
          companyService.getAllCompanies(),
          brandService.getAllBrands(),
        ]);
        setRoles(rolesData);
        setCompanies(companiesData);
        setBrands(brandsData);
        setFilteredBrands(brandsData);
      } catch (error) {
        console.error('Failed to fetch data:', error);
        toast.error('Failed to load form data');
      } finally {
        setIsLoadingData(false);
      }
    };
    fetchData();
  }, []);

  // Filter brands by selected company
  useEffect(() => {
    if (selectedCompany) {
      const filtered = brands.filter(
        brand => brand.company === selectedCompany
      );
      setFilteredBrands(filtered);
      // Clear selected brands that don't belong to the new company
      setSelectedBrands(prev =>
        prev.filter(brandId => filtered.some(b => b.id === brandId))
      );
    } else {
      setFilteredBrands(brands);
    }
  }, [selectedCompany, brands]);

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = e => {
        setAvatarUrl(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleBrand = (brandId: number) => {
    setSelectedBrands(prev =>
      prev.includes(brandId)
        ? prev.filter(id => id !== brandId)
        : [...prev, brandId]
    );
  };

  const onSubmit = async (data: UserFormData) => {
    try {
      await userService.createUser({
        email: data.email,
        password: data.password,
        password_confirm: data.password_confirm,
        first_name: data.first_name,
        last_name: data.last_name,
        current_company: data.current_company || undefined,
        allowed_brands: selectedBrands.length > 0 ? selectedBrands : undefined,
        // Profile fields
        phone: data.phone || undefined,
        emergency_phone: data.emergency_phone || undefined,
        birth_date: data.birth_date || undefined,
        gender: data.gender || undefined,
        cin_number: data.cin_number || undefined,
        nationality: data.nationality || undefined,
        city: data.city || undefined,
        address: data.address || undefined,
        education_level: (data.education_level as EducationLevel) || undefined,
        diploma_title: data.diploma_title || undefined,
      });

      setCreatedUserName(`${data.first_name} ${data.last_name}`);
      setShowSuccessDialog(true);
      reset();
      setAvatarUrl('');
      setSelectedBrands([]);
    } catch (error) {
      console.error('Error adding user:', error);
      // Log detailed error response from server
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as {
          response?: { data?: unknown; status?: number };
        };
        console.error('Server response:', axiosError.response?.data);
        console.error('Status code:', axiosError.response?.status);
      }
      const err = error as Error;
      toast.error(err.message || 'Failed to create user');
    }
  };

  const parseCSV = (text: string): ImportedUser[] => {
    const lines = text.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim());
      const user: Record<string, string> = {};

      headers.forEach((header, index) => {
        user[header] = values[index] || '';
      });

      return {
        first_name: user.first_name || user.firstname || '',
        last_name: user.last_name || user.lastname || '',
        email: user.email || '',
        role: user.role || '',
        status: 'pending' as const,
      };
    });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target?.result as string;
        const users = parseCSV(text);
        setImportedUsers(users);
      } catch {
        toast.error('Error parsing CSV file');
      }
    };
    reader.readAsText(file);
  };

  const processImportedUsers = async () => {
    setIsProcessing(true);

    const updatedUsers = await Promise.all(
      importedUsers.map(async user => {
        try {
          if (!user.email || !user.first_name || !user.last_name) {
            return {
              ...user,
              status: 'error' as const,
              error: 'Missing required fields',
            };
          }

          const tempPassword = 'TempPass123!';
          await userService.createUser({
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            password: tempPassword,
            password_confirm: tempPassword,
          });

          return { ...user, status: 'success' as const };
        } catch (error) {
          const err = error as Error;
          return {
            ...user,
            status: 'error' as const,
            error: err.message || 'Failed to add user',
          };
        }
      })
    );

    setImportedUsers(updatedUsers);
    setIsProcessing(false);

    const successCount = updatedUsers.filter(
      u => u.status === 'success'
    ).length;
    const errorCount = updatedUsers.filter(u => u.status === 'error').length;

    if (successCount > 0) {
      toast.success(`Successfully added ${successCount} user(s)`);
    }
    if (errorCount > 0) {
      toast.error(`Failed to add ${errorCount} user(s)`);
    }
  };

  const downloadTemplate = () => {
    const template =
      'first_name,last_name,email,role\nJohn,Doe,john@example.com,User\nJane,Smith,jane@example.com,Manager';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoadingData) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex items-center gap-2">
          <Loader2 className="size-6 animate-spin" />
          <span>Loading form data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add New Users</h1>
          <p className="text-l-text-2 dark:text-d-text-2 mt-2">
            Create user accounts individually or import multiple users via CSV
          </p>
        </div>
      </div>

      <Tabs defaultValue="single" className="w-full">
        <div className="flex justify-center mb-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="single" className="flex gap-2">
              <User className="size-4" />
              Single User
            </TabsTrigger>
            <TabsTrigger value="bulk" className="flex gap-2">
              <Users className="size-4" />
              Bulk Import
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Single User Form */}
        <TabsContent value="single">
          <Card className="max-w-4xl mx-auto w-full p-6">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* Avatar Section */}
              <div className="flex flex-col items-center gap-4 pb-6 border-b">
                <Avatar className="size-24">
                  <AvatarImage src={avatarUrl} alt="User avatar" />
                  <AvatarFallback>
                    <User className="size-12" />
                  </AvatarFallback>
                </Avatar>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => avatarInputRef.current?.click()}
                  className="gap-2"
                >
                  <Camera className="size-4" />
                  Upload Avatar
                </Button>
              </div>

              {/* Basic Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                    <Input
                      id="email"
                      type="email"
                      {...register('email')}
                      placeholder="john.doe@example.com"
                      className="pl-10"
                    />
                  </div>
                  {errors.email && (
                    <p className="text-sm text-red-500">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="first_name">First Name *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                    <Input
                      id="first_name"
                      {...register('first_name')}
                      placeholder="John"
                      className="pl-10"
                    />
                  </div>
                  {errors.first_name && (
                    <p className="text-sm text-red-500">
                      {errors.first_name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="last_name">Last Name *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                    <Input
                      id="last_name"
                      {...register('last_name')}
                      placeholder="Doe"
                      className="pl-10"
                    />
                  </div>
                  {errors.last_name && (
                    <p className="text-sm text-red-500">
                      {errors.last_name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                    <Input
                      id="phone"
                      {...register('phone')}
                      placeholder="+216 XX XXX XXX"
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>

              {/* Personal Information */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="birth_date">Birth Date</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
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

                <div className="space-y-2">
                  <Label htmlFor="cin_number">CIN Number</Label>
                  <div className="relative">
                    <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                    <Input
                      id="cin_number"
                      {...register('cin_number')}
                      placeholder="12345678"
                      className="pl-10"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    National Identity Card number
                  </p>
                </div>
              </div>

              <Separator />

              {/* Location Information */}
              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <MapPin className="size-4" />
                  Location & Contact
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="nationality">Nationality</Label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="nationality"
                        {...register('nationality')}
                        placeholder="e.g., Tunisian"
                        className="pl-10"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Select onValueChange={value => setValue('city', value)}>
                      <SelectTrigger>
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

                  <div className="space-y-2">
                    <Label htmlFor="emergency_phone">Emergency Phone</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="emergency_phone"
                        {...register('emergency_phone')}
                        placeholder="+216 XX XXX XXX"
                        className="pl-10"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <Label htmlFor="address">Full Address</Label>
                  <div className="relative">
                    <Home className="absolute left-3 top-3 size-4 text-l-text-3 dark:text-d-text-3" />
                    <Input
                      id="address"
                      {...register('address')}
                      placeholder="Enter full address"
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Education Information */}
              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <GraduationCap className="size-4" />
                  Education
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="education_level">Education Level</Label>
                    <Select
                      onValueChange={value =>
                        setValue('education_level', value)
                      }
                    >
                      <SelectTrigger>
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

                  <div className="space-y-2">
                    <Label htmlFor="diploma_title">Diploma Title</Label>
                    <div className="relative">
                      <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="diploma_title"
                        {...register('diploma_title')}
                        placeholder="e.g., Bachelor of Computer Science"
                        className="pl-10"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Role & Company */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <div className="relative">
                    <Shield className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3 z-10" />
                    <Select
                      onValueChange={value =>
                        setValue('role', value ? parseInt(value) : null)
                      }
                    >
                      <SelectTrigger className="pl-10">
                        <SelectValue placeholder="Select a role (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map(role => (
                          <SelectItem key={role.id} value={role.id.toString()}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {errors.role && (
                    <p className="text-sm text-red-500">
                      {errors.role.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company">Company</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3 z-10" />
                    <Select
                      onValueChange={value =>
                        setValue(
                          'current_company',
                          value === 'none' ? null : parseInt(value)
                        )
                      }
                    >
                      <SelectTrigger className="pl-10">
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
                </div>
              </div>

              {/* Brand Access */}
              {filteredBrands.length > 0 && (
                <div className="space-y-3">
                  <Label>Brand Access</Label>
                  <p className="text-sm text-muted-foreground">
                    Select which brands this user can access
                    {selectedCompany && ' (filtered by selected company)'}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredBrands.map(brand => (
                      <div
                        key={brand.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedBrands.includes(brand.id)
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                        onClick={() => toggleBrand(brand.id)}
                      >
                        <div
                          className={`size-4 rounded border-2 flex items-center justify-center ${
                            selectedBrands.includes(brand.id)
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-muted-foreground'
                          }`}
                        >
                          {selectedBrands.includes(brand.id) && (
                            <svg
                              className="size-2.5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="4"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                        <span className="text-sm font-medium">
                          {brand.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Password */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Password *</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                    <Input
                      id="password"
                      type="password"
                      {...register('password')}
                      placeholder="••••••••"
                      className="pl-10"
                    />
                  </div>
                  {errors.password && (
                    <p className="text-sm text-red-500">
                      {errors.password.message}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Min 8 characters, not all numbers
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password_confirm">Confirm Password *</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                    <Input
                      id="password_confirm"
                      type="password"
                      {...register('password_confirm')}
                      placeholder="••••••••"
                      className="pl-10"
                    />
                  </div>
                  {errors.password_confirm && (
                    <p className="text-sm text-red-500">
                      {errors.password_confirm.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Adding User...
                    </>
                  ) : (
                    'Add User'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    reset();
                    setSelectedBrands([]);
                    setAvatarUrl('');
                  }}
                  className="flex-1"
                >
                  Reset Form
                </Button>
              </div>
            </form>
          </Card>
        </TabsContent>

        {/* Bulk Import */}
        <TabsContent value="bulk">
          <Card className="max-w-4xl mx-auto w-full p-6">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-4">
                <div>
                  <h3 className="text-lg font-semibold">
                    Import Users from CSV
                  </h3>
                  <p className="text-sm text-l-text-2 dark:text-d-text-2 mt-1">
                    Upload a CSV file with user information to add multiple
                    users at once
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={downloadTemplate}
                  className="gap-2"
                >
                  <Download className="size-4" />
                  Download Template
                </Button>
              </div>

              <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-accent-1 transition-colors">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <FileText className="size-12 mx-auto mb-4 text-l-text-3 dark:text-d-text-3" />
                <h4 className="text-lg font-medium mb-2">Upload CSV File</h4>
                <p className="text-sm text-l-text-2 dark:text-d-text-2 mb-4">
                  Click to select or drag and drop your CSV file here
                </p>
                <div className="flex justify-center">
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    className="gap-2"
                  >
                    <Upload className="size-4" />
                    Select File
                  </Button>
                </div>
              </div>

              {importedUsers.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-lg font-semibold">
                      Imported Users ({importedUsers.length})
                    </h4>
                    <Button
                      onClick={processImportedUsers}
                      disabled={isProcessing}
                      className="gap-2"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Users className="size-4" />
                          Add All Users
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="border rounded-lg overflow-hidden">
                    <div className="max-h-96 overflow-y-auto">
                      <table className="w-full">
                        <thead className="bg-l-bg-2 dark:bg-d-bg-2 sticky top-0">
                          <tr>
                            <th className="text-left p-3 text-sm font-medium">
                              Name
                            </th>
                            <th className="text-left p-3 text-sm font-medium">
                              Email
                            </th>
                            <th className="text-left p-3 text-sm font-medium">
                              Role
                            </th>
                            <th className="text-left p-3 text-sm font-medium">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {importedUsers.map((user, index) => (
                            <tr key={index} className="border-t">
                              <td className="p-3 text-sm">
                                {user.first_name} {user.last_name}
                              </td>
                              <td className="p-3 text-sm">{user.email}</td>
                              <td className="p-3 text-sm capitalize">
                                {user.role || 'Not specified'}
                              </td>
                              <td className="p-3">
                                <Badge
                                  variant={
                                    user.status === 'success'
                                      ? 'default'
                                      : user.status === 'error'
                                        ? 'destructive'
                                        : 'secondary'
                                  }
                                >
                                  {user.status}
                                </Badge>
                                {user.error && (
                                  <p className="text-xs text-red-500 mt-1">
                                    {user.error}
                                  </p>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Success Dialog */}
      <AlertDialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-green-600 dark:text-green-500">
              ✓ User Created Successfully!
            </AlertDialogTitle>
            <AlertDialogDescription>
              {createdUserName} has been added to the system successfully.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => navigate('/dashboard/users')}>
              View Users
            </AlertDialogAction>
            <AlertDialogAction onClick={() => setShowSuccessDialog(false)}>
              Add Another
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
