import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState, useRef } from 'react';
import { User, Mail, Lock, Phone, Shield, Upload, FileText, Download, Users, Camera } from 'lucide-react';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Zod validation schema
const userSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  email: z.string().email(),
  phone: z.string().min(8, 'Phone number must be at least 10 digits'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
  role: z.enum(['admin', 'user', 'manager']),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type UserFormData = z.infer<typeof userSchema>;

interface ImportedUser {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: 'admin' | 'user' | 'manager';
  status: 'pending' | 'success' | 'error';
  error?: string;
}

export default function AddUserPage() {
  const [importedUsers, setImportedUsers] = useState<ImportedUser[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string>('https://api.dicebear.com/7.x/avataaars/svg?seed=default');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [pendingData, setPendingData] = useState<UserFormData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
  });

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setAvatarUrl(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = async (data: UserFormData) => {
    setPendingData(data);
    setShowConfirmDialog(true);
  };

  const confirmAddUser = async () => {
    if (!pendingData) return;
    
    try {
      console.log('User data:', { ...pendingData, avatar: avatarUrl });
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      setShowConfirmDialog(false);
      setShowSuccessDialog(true);
      reset();
      setAvatarUrl('https://api.dicebear.com/7.x/avataaars/svg?seed=default');
      setPendingData(null);
    } catch (error) {
      console.error('Error adding user:', error);
      setShowConfirmDialog(false);
    }
  };

  const parseCSV = (text: string): ImportedUser[] => {
    const lines = text.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim());
      const user: any = {};
      
      headers.forEach((header, index) => {
        user[header] = values[index] || '';
      });

      return {
        firstName: user.firstname || user.first_name || '',
        lastName: user.lastname || user.last_name || '',
        email: user.email || '',
        phone: user.phone || '',
        role: (user.role || 'user') as 'admin' | 'user' | 'manager',
        status: 'pending' as const,
      };
    });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const users = parseCSV(text);
        setImportedUsers(users);
      } catch (error) {
        alert('Error parsing CSV file');
      }
    };
    reader.readAsText(file);
  };

  const processImportedUsers = async () => {
    setIsProcessing(true);
    
    const updatedUsers = await Promise.all(
      importedUsers.map(async (user) => {
        try {
          // Validate user data
          if (!user.email || !user.firstName || !user.lastName) {
            return { ...user, status: 'error' as const, error: 'Missing required fields' };
          }

          // Simulate API call
          await new Promise((resolve) => setTimeout(resolve, 500));
          console.log('Adding user:', user);
          
          return { ...user, status: 'success' as const };
        } catch (error) {
          return { ...user, status: 'error' as const, error: 'Failed to add user' };
        }
      })
    );

    setImportedUsers(updatedUsers);
    setIsProcessing(false);
  };

  const downloadTemplate = () => {
    const template = 'firstName,lastName,email,phone,role\nJohn,Doe,john@example.com,1234567890,user\nJane,Smith,jane@example.com,0987654321,manager';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

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
          <Card className="max-w-3xl mx-auto w-full p-6">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* Avatar Section */}
              <div className="flex flex-col items-center gap-4 pb-6 border-b">
                <Avatar className="size-24">
                  <AvatarImage src={avatarUrl} alt="User avatar" />
                  <AvatarFallback><User className="size-12" /></AvatarFallback>
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
                <p className="text-xs text-l-text-3 dark:text-d-text-3">Default avatar will be used if none uploaded</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                    <Input
                      id="firstName"
                      {...register('firstName')}
                      placeholder="John"
                      className="pl-10"
                    />
                  </div>
                  {errors.firstName && (
                    <p className="text-sm text-red-500">{errors.firstName.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                    <Input
                      id="lastName"
                      {...register('lastName')}
                      placeholder="Doe"
                      className="pl-10"
                    />
                  </div>
                  {errors.lastName && (
                    <p className="text-sm text-red-500">{errors.lastName.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
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
                  <p className="text-sm text-red-500">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                  <Input
                    id="phone"
                    type="tel"
                    {...register('phone')}
                    placeholder="+1 (555) 000-0000"
                    className="pl-10"
                  />
                </div>
                {errors.phone && (
                  <p className="text-sm text-red-500">{errors.phone.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3 z-10" />
                  <Select onValueChange={(value) => setValue('role', value as 'admin' | 'user' | 'manager')}>
                    <SelectTrigger className="pl-10">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {errors.role && (
                  <p className="text-sm text-red-500">{errors.role.message}</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
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
                    <p className="text-sm text-red-500">{errors.password.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                    <Input
                      id="confirmPassword"
                      type="password"
                      {...register('confirmPassword')}
                      placeholder="••••••••"
                      className="pl-10"
                    />
                  </div>
                  {errors.confirmPassword && (
                    <p className="text-sm text-red-500">{errors.confirmPassword.message}</p>
                  )}
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <Button type="submit" disabled={isSubmitting} className="flex-1">
                  {isSubmitting ? 'Adding User...' : 'Add User'}
                </Button>
                <Button type="button" variant="outline" onClick={() => reset()} className="flex-1">
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
                  <h3 className="text-lg font-semibold">Import Users from CSV</h3>
                  <p className="text-sm text-l-text-2 dark:text-d-text-2 mt-1">
                    Upload a CSV file with user information to add multiple users at once
                  </p>
                </div>
                <Button variant="outline" onClick={downloadTemplate} className="gap-2">
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
                  <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
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
                      <Users className="size-4" />
                      {isProcessing ? 'Processing...' : 'Add All Users'}
                    </Button>
                  </div>

                  <div className="border rounded-lg overflow-hidden">
                    <div className="max-h-96 overflow-y-auto">
                      <table className="w-full">
                        <thead className="bg-l-bg-2 dark:bg-d-bg-2 sticky top-0">
                          <tr>
                            <th className="text-left p-3 text-sm font-medium">Name</th>
                            <th className="text-left p-3 text-sm font-medium">Email</th>
                            <th className="text-left p-3 text-sm font-medium">Phone</th>
                            <th className="text-left p-3 text-sm font-medium">Role</th>
                            <th className="text-left p-3 text-sm font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importedUsers.map((user, index) => (
                            <tr key={index} className="border-t">
                              <td className="p-3 text-sm">
                                {user.firstName} {user.lastName}
                              </td>
                              <td className="p-3 text-sm">{user.email}</td>
                              <td className="p-3 text-sm">{user.phone}</td>
                              <td className="p-3 text-sm capitalize">{user.role}</td>
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
                                  <p className="text-xs text-red-500 mt-1">{user.error}</p>
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

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Add User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to add this user? This will create a new account for{' '}
              <strong>{pendingData?.firstName} {pendingData?.lastName}</strong> with email{' '}
              <strong>{pendingData?.email}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAddUser}>
              Confirm & Add User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Success Dialog */}
      <AlertDialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-green-600 dark:text-green-500">
              ✓ User Added Successfully!
            </AlertDialogTitle>
            <AlertDialogDescription>
              The user account has been created successfully. They can now log in with their credentials.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowSuccessDialog(false)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
