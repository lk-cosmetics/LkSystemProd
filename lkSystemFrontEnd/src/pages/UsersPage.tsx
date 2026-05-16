import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Eye,
  Pencil,
  Trash2,
  Ban,
  Search,
  Filter,
  MoreVertical,
  UserCheck,
  Mail,
  Phone,
  Shield,
  Calendar,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDialogs, useUserFilters, useUserActions } from '@/hooks';
import { getMediaUrl } from '@/utils/helpers';

type UserRole = 'admin' | 'user' | 'manager';
type UserStatus = 'active' | 'blocked';

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  avatar: string;
  createdAt: string;
}

// Mock data
const mockUsers: User[] = [
  {
    id: '1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    phone: '+1 (555) 123-4567',
    role: 'admin',
    status: 'active',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=John',
    createdAt: '2024-01-15',
  },
  {
    id: '2',
    firstName: 'Jane',
    lastName: 'Smith',
    email: 'jane.smith@example.com',
    phone: '+1 (555) 234-5678',
    role: 'manager',
    status: 'active',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Jane',
    createdAt: '2024-02-20',
  },
  {
    id: '3',
    firstName: 'Mike',
    lastName: 'Johnson',
    email: 'mike.j@example.com',
    phone: '+1 (555) 345-6789',
    role: 'user',
    status: 'active',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Mike',
    createdAt: '2024-03-10',
  },
  {
    id: '4',
    firstName: 'Sarah',
    lastName: 'Williams',
    email: 'sarah.w@example.com',
    phone: '+1 (555) 456-7890',
    role: 'user',
    status: 'blocked',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah',
    createdAt: '2024-04-05',
  },
  {
    id: '5',
    firstName: 'David',
    lastName: 'Brown',
    email: 'david.b@example.com',
    phone: '+1 (555) 567-8901',
    role: 'manager',
    status: 'active',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=David',
    createdAt: '2024-05-12',
  },
];

export default function UsersPage() {
  // Custom hooks for state management
  const { dialogs, data, openDialog, closeDialog, setEditFormData } =
    useDialogs<User>();

  const { users, updateUser, deleteUser, toggleUserStatus } =
    useUserActions<User>({
      initialUsers: mockUsers,
      getUserId: user => user.id,
      onSuccess: message => openDialog('success', undefined, message),
      onError: error => console.error('User action failed:', error),
    });

  const {
    filters,
    filteredUsers,
    setSearchQuery,
    setRoleFilter,
    setStatusFilter,
  } = useUserFilters<User>({
    users,
    getSearchableFields: user => [user.firstName, user.lastName, user.email],
    getRoleField: user => user.role,
    getStatusField: user => user.status,
  });

  // Action handlers with callbacks
  const handleView = useCallback(
    (user: User) => {
      openDialog('view', user);
    },
    [openDialog]
  );

  const handleEdit = useCallback(
    (user: User) => {
      openDialog('edit', user);
    },
    [openDialog]
  );

  const handleSaveEdit = useCallback(async () => {
    if (!data.editFormData) return;

    await updateUser(data.editFormData);
    closeDialog('edit');
  }, [data.editFormData, updateUser, closeDialog]);

  const handleDelete = useCallback(
    (user: User) => {
      openDialog('delete', user);
    },
    [openDialog]
  );

  const confirmDelete = useCallback(async () => {
    if (!data.userToDelete) return;

    await deleteUser(data.userToDelete.id);
    closeDialog('delete');
  }, [data.userToDelete, deleteUser, closeDialog]);

  const handleBlock = useCallback(
    (user: User) => {
      openDialog('block', user);
    },
    [openDialog]
  );

  const confirmBlock = useCallback(async () => {
    if (!data.userToBlock) return;

    await toggleUserStatus(data.userToBlock.id, data.userToBlock.status);
    closeDialog('block');
  }, [data.userToBlock, toggleUserStatus, closeDialog]);

  const getRoleBadgeVariant = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return 'default';
      case 'manager':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Users Management
            </h1>
            <p className="text-l-text-2 dark:text-d-text-2 mt-2">
              Manage user accounts, roles, and permissions
            </p>
          </div>
          <Button asChild className="gap-2">
            <Link to="/dashboard/add-user">
              <UserCheck className="size-4" />
              Add New User
            </Link>
          </Button>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
              <Input
                placeholder="Search by name or email..."
                value={filters.searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Role Filter */}
            <Select value={filters.roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full md:w-[180px]">
                <Filter className="size-4 mr-2" />
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select
              value={filters.statusFilter}
              onValueChange={setStatusFilter}
            >
              <SelectTrigger className="w-full md:w-[180px]">
                <Filter className="size-4 mr-2" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-4 flex items-center gap-2 text-sm text-l-text-2 dark:text-d-text-2">
            <span>
              Showing {filteredUsers.length} of {users.length} users
            </span>
          </div>
        </Card>
      </div>

      {/* Users Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-8 text-l-text-2 dark:text-d-text-2"
                >
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map(user => (
                <TableRow key={user.id}>
                  {/* User Info */}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-10">
                        <AvatarImage
                          src={getMediaUrl(user.avatar) || ''}
                          alt={`${user.firstName} ${user.lastName}`}
                        />
                        <AvatarFallback>
                          {user.firstName[0]}
                          {user.lastName[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">
                          {user.firstName} {user.lastName}
                        </p>
                        <p className="text-sm text-l-text-2 dark:text-d-text-2">
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>

                  {/* Contact */}
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="size-3 text-l-text-3 dark:text-d-text-3" />
                        <span className="text-l-text-2 dark:text-d-text-2">
                          {user.email}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="size-3 text-l-text-3 dark:text-d-text-3" />
                        <span className="text-l-text-2 dark:text-d-text-2">
                          {user.phone}
                        </span>
                      </div>
                    </div>
                  </TableCell>

                  {/* Role */}
                  <TableCell>
                    <Badge
                      variant={getRoleBadgeVariant(user.role)}
                      className="capitalize"
                    >
                      <Shield className="size-3 mr-1" />
                      {user.role}
                    </Badge>
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <Badge
                      variant={
                        user.status === 'active' ? 'default' : 'destructive'
                      }
                      className="capitalize"
                    >
                      {user.status}
                    </Badge>
                  </TableCell>

                  {/* Joined Date */}
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm text-l-text-2 dark:text-d-text-2">
                      <Calendar className="size-3" />
                      {new Date(user.createdAt).toLocaleDateString()}
                    </div>
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleView(user)}>
                          <Eye className="size-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleEdit(user)}>
                          <Pencil className="size-4 mr-2" />
                          Edit User
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleBlock(user)}>
                          <Ban className="size-4 mr-2" />
                          {user.status === 'active' ? 'Block' : 'Unblock'} User
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleDelete(user)}
                          className="text-red-600 dark:text-red-400"
                        >
                          <Trash2 className="size-4 mr-2" />
                          Delete User
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* View User Dialog */}
      <Dialog open={dialogs.view} onOpenChange={() => closeDialog('view')}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
            <DialogDescription>
              Complete information about the user account
            </DialogDescription>
          </DialogHeader>

          {data.selectedUser && (
            <div className="space-y-6">
              {/* Avatar and Name */}
              <div className="flex items-center gap-4 pb-4 border-b">
                <Avatar className="size-20">
                  <AvatarImage
                    src={getMediaUrl(data.selectedUser.avatar) || ''}
                    alt={`${data.selectedUser.firstName} ${data.selectedUser.lastName}`}
                  />
                  <AvatarFallback className="text-lg">
                    {data.selectedUser.firstName[0]}
                    {data.selectedUser.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-2xl font-semibold">
                    {data.selectedUser.firstName} {data.selectedUser.lastName}
                  </h3>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge
                      variant={getRoleBadgeVariant(data.selectedUser.role)}
                      className="capitalize"
                    >
                      {data.selectedUser.role}
                    </Badge>
                    <Badge
                      variant={
                        data.selectedUser.status === 'active'
                          ? 'default'
                          : 'destructive'
                      }
                      className="capitalize"
                    >
                      {data.selectedUser.status}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* User Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-l-text-2 dark:text-d-text-2">
                    Email
                  </label>
                  <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                    <Mail className="size-4 text-l-text-3 dark:text-d-text-3" />
                    <span className="text-sm">{data.selectedUser.email}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-l-text-2 dark:text-d-text-2">
                    Phone
                  </label>
                  <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                    <Phone className="size-4 text-l-text-3 dark:text-d-text-3" />
                    <span className="text-sm">{data.selectedUser.phone}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-l-text-2 dark:text-d-text-2">
                    Role
                  </label>
                  <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                    <Shield className="size-4 text-l-text-3 dark:text-d-text-3" />
                    <span className="text-sm capitalize">
                      {data.selectedUser.role}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-l-text-2 dark:text-d-text-2">
                    Joined Date
                  </label>
                  <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                    <Calendar className="size-4 text-l-text-3 dark:text-d-text-3" />
                    <span className="text-sm">
                      {new Date(
                        data.selectedUser.createdAt
                      ).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  onClick={() => handleEdit(data.selectedUser!)}
                  className="flex-1 gap-2"
                >
                  <Pencil className="size-4" />
                  Edit User
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    handleBlock(data.selectedUser!);
                    closeDialog('view');
                  }}
                  className="flex-1 gap-2"
                >
                  <Ban className="size-4" />
                  {data.selectedUser.status === 'active' ? 'Block' : 'Unblock'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={dialogs.delete}
        onOpenChange={() => closeDialog('delete')}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <strong>
                {data.userToDelete?.firstName} {data.userToDelete?.lastName}
              </strong>
              ? This action cannot be undone and will permanently remove the
              user account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Block/Unblock Confirmation Dialog */}
      <AlertDialog
        open={dialogs.block}
        onOpenChange={() => closeDialog('block')}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {data.userToBlock?.status === 'active' ? 'Block' : 'Unblock'} User
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to{' '}
              {data.userToBlock?.status === 'active' ? 'block' : 'unblock'}{' '}
              <strong>
                {data.userToBlock?.firstName} {data.userToBlock?.lastName}
              </strong>
              ?
              {data.userToBlock?.status === 'active'
                ? ' This will prevent them from accessing their account.'
                : ' This will restore their account access.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBlock}>
              {data.userToBlock?.status === 'active' ? 'Block' : 'Unblock'} User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit User Dialog */}
      <Dialog open={dialogs.edit} onOpenChange={() => closeDialog('edit')}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user information and settings
            </DialogDescription>
          </DialogHeader>

          {data.editFormData && (
            <div className="space-y-6">
              {/* Avatar Preview */}
              <div className="flex items-center gap-4 pb-4 border-b">
                <Avatar className="size-16">
                  <AvatarImage
                    src={getMediaUrl(data.editFormData.avatar) || ''}
                    alt={`${data.editFormData.firstName} ${data.editFormData.lastName}`}
                  />
                  <AvatarFallback>
                    {data.editFormData.firstName[0]}
                    {data.editFormData.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm text-l-text-2 dark:text-d-text-2">
                    User ID: {data.editFormData.id}
                  </p>
                  <p className="text-xs text-l-text-3 dark:text-d-text-3">
                    Joined:{' '}
                    {new Date(data.editFormData.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {/* Edit Form */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-firstName">First Name</Label>
                  <Input
                    id="edit-firstName"
                    value={data.editFormData.firstName}
                    onChange={e =>
                      setEditFormData({
                        ...data.editFormData!,
                        firstName: e.target.value,
                      })
                    }
                    placeholder="First name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-lastName">Last Name</Label>
                  <Input
                    id="edit-lastName"
                    value={data.editFormData.lastName}
                    onChange={e =>
                      setEditFormData({
                        ...data.editFormData!,
                        lastName: e.target.value,
                      })
                    }
                    placeholder="Last name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={data.editFormData.email}
                    onChange={e =>
                      setEditFormData({
                        ...data.editFormData!,
                        email: e.target.value,
                      })
                    }
                    placeholder="Email address"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-phone">Phone</Label>
                  <Input
                    id="edit-phone"
                    type="tel"
                    value={data.editFormData.phone}
                    onChange={e =>
                      setEditFormData({
                        ...data.editFormData!,
                        phone: e.target.value,
                      })
                    }
                    placeholder="Phone number"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-role">Role</Label>
                  <Select
                    value={data.editFormData.role}
                    onValueChange={(value: UserRole) =>
                      setEditFormData({ ...data.editFormData!, role: value })
                    }
                  >
                    <SelectTrigger id="edit-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-status">Status</Label>
                  <Select
                    value={data.editFormData.status}
                    onValueChange={(value: UserStatus) =>
                      setEditFormData({ ...data.editFormData!, status: value })
                    }
                  >
                    <SelectTrigger id="edit-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="blocked">Blocked</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button onClick={handleSaveEdit} className="flex-1">
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => closeDialog('edit')}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <AlertDialog
        open={dialogs.success}
        onOpenChange={() => closeDialog('success')}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-green-600 dark:text-green-500">
              ✓ Success!
            </AlertDialogTitle>
            <AlertDialogDescription>
              {data.successMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => closeDialog('success')}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
