import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Eye,
  Pencil,
  Trash2,
  Search,
  Filter,
  MoreVertical,
  UserCheck,
  UserX,
  UserPlus,
  Mail,
  Shield,
  Calendar,
  Building2,
  ChevronLeft,
  ChevronRight,
  Key,
  Loader2,
  Send,
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
  DialogFooter,
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
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { userService, type UserFilters } from '@/services/user.service';
import { rbacService, type RBACRole } from '@/services/rbac.service';
import { companyService } from '@/services/company.service';
import { brandService } from '@/services/brand.service';
import { salesChannelService } from '@/services/salesChannel.service';
import type { UserListItem, CompanyListItem, Brand, SalesChannel, PaginatedResponse } from '@/types';
import { Checkbox } from '@/components/ui/checkbox';
import { useDebounce } from '@/hooks';
import { toast } from 'sonner';
import { getMediaUrl } from '@/utils/helpers';

export default function UsersPage() {
  const navigate = useNavigate();

  // Data states
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [roles, setRoles] = useState<RBACRole[]>([]);
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [pagination, setPagination] = useState({
    count: 0,
    page: 1,
    hasNext: false,
    hasPrevious: false,
  });

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');

  const debouncedSearch = useDebounce(searchQuery, 300);

  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isActioning, setIsActioning] = useState(false);

  // Dialog states
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  // Invite dialog states
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState<string>('');
  const [inviteCompanyId, setInviteCompanyId] = useState<string>('');
  const [inviteBrandIds, setInviteBrandIds] = useState<number[]>([]);
  const [inviteSalesChannelId, setInviteSalesChannelId] = useState<string>('');
  const [inviteBrands, setInviteBrands] = useState<Brand[]>([]);
  const [inviteChannels, setInviteChannels] = useState<SalesChannel[]>([]);
  const [isInviting, setIsInviting] = useState(false);

  // Selected user states
  const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserListItem | null>(null);
  const [userToToggle, setUserToToggle] = useState<UserListItem | null>(null);
  const [userForPassword, setUserForPassword] = useState<UserListItem | null>(
    null
  );

  // Fetch users with filters
  const fetchUsers = useCallback(
    async (page = 1) => {
      setIsLoading(true);
      try {
        const filters: UserFilters = { page };

        if (debouncedSearch) filters.search = debouncedSearch;
        if (statusFilter !== 'all')
          filters.is_active = statusFilter === 'active';
        if (companyFilter !== 'all')
          filters.current_company = parseInt(companyFilter);

        const response: PaginatedResponse<UserListItem> =
          await userService.getUsers(filters);

        setUsers(response.results ?? []);
        setPagination({
          count: response.count ?? 0,
          page,
          hasNext: !!response.next,
          hasPrevious: !!response.previous,
        });
      } catch (error) {
        console.error('Failed to fetch users:', error);
        toast.error('Failed to load users');
        setUsers([]);
      } finally {
        setIsLoading(false);
      }
    },
    [debouncedSearch, statusFilter, companyFilter]
  );

  // Fetch roles and companies for filters
  useEffect(() => {
    const fetchFiltersData = async () => {
      try {
        const [rolesData, companiesData] = await Promise.all([
          // Only roles the logged-in user may actually assign (invite dialog).
          rbacService.getRoles({ assignable: true }),
          companyService.getAllCompanies(),
        ]);
        setRoles(rolesData);
        setCompanies(companiesData);
      } catch (error) {
        console.error('Failed to fetch filter data:', error);
      }
    };
    fetchFiltersData();
  }, []);

  // Fetch users when filters change
  useEffect(() => {
    fetchUsers(1);
  }, [fetchUsers]);

  // Action handlers
  const handleView = (user: UserListItem) => {
    setSelectedUser(user);
    setViewDialogOpen(true);
  };

  const handleEdit = (user: UserListItem) => {
    navigate(`/dashboard/users/${user.id}/edit`);
  };

  const handleViewDetails = (user: UserListItem) => {
    navigate(`/dashboard/users/${user.id}`);
  };

  const handleDelete = (user: UserListItem) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;

    setIsActioning(true);
    try {
      await userService.deleteUser(userToDelete.id);
      toast.success(`User ${userToDelete.full_name} deleted successfully`);
      fetchUsers(pagination.page);
    } catch (error) {
      console.error('Failed to delete user:', error);
      toast.error('Failed to delete user');
    } finally {
      setIsActioning(false);
      setDeleteDialogOpen(false);
      setUserToDelete(null);
    }
  };

  const handleToggleStatus = (user: UserListItem) => {
    setUserToToggle(user);
    setStatusDialogOpen(true);
  };

  const confirmToggleStatus = async () => {
    if (!userToToggle) return;

    setIsActioning(true);
    try {
      await userService.toggleUserStatus(
        userToToggle.id,
        userToToggle.is_active
      );
      const action = userToToggle.is_active ? 'deactivated' : 'activated';
      toast.success(`User ${userToToggle.full_name} ${action} successfully`);
      fetchUsers(pagination.page);
    } catch (error) {
      console.error('Failed to toggle user status:', error);
      toast.error('Failed to update user status');
    } finally {
      setIsActioning(false);
      setStatusDialogOpen(false);
      setUserToToggle(null);
    }
  };

  const handleChangePassword = (user: UserListItem) => {
    setUserForPassword(user);
    setPasswordDialogOpen(true);
  };

  // Invite dialog handlers
  const openInviteDialog = () => {
    setInviteEmail('');
    setInviteRoleId('');
    setInviteCompanyId('');
    setInviteBrandIds([]);
    setInviteSalesChannelId('');
    setInviteBrands([]);
    setInviteChannels([]);
    setInviteDialogOpen(true);
  };

  const handleInviteCompanyChange = async (companyId: string) => {
    setInviteCompanyId(companyId);
    setInviteBrandIds([]);
    setInviteSalesChannelId('');
    setInviteChannels([]);
    if (companyId) {
      try {
        const brands = await brandService.getBrandsByCompany(parseInt(companyId));
        setInviteBrands(brands);
      } catch {
        setInviteBrands([]);
      }
    } else {
      setInviteBrands([]);
    }
  };

  const handleInviteBrandToggle = async (brandId: number) => {
    const updated = inviteBrandIds.includes(brandId)
      ? inviteBrandIds.filter(id => id !== brandId)
      : [...inviteBrandIds, brandId];
    setInviteBrandIds(updated);
    setInviteSalesChannelId('');

    // Load sales channels for selected brands
    if (updated.length > 0) {
      try {
        const allChannels = await salesChannelService.getAllChannels();
        setInviteChannels(allChannels.filter(ch => updated.includes(ch.brand)));
      } catch {
        setInviteChannels([]);
      }
    } else {
      setInviteChannels([]);
    }
  };

  const handleSendInvite = async () => {
    if (!inviteEmail || !inviteRoleId || !inviteCompanyId) {
      toast.error('Please fill in email, role, and company');
      return;
    }

    setIsInviting(true);
    try {
      await userService.inviteEmployee({
        email: inviteEmail,
        role_id: parseInt(inviteRoleId),
        company_id: parseInt(inviteCompanyId),
        brand_ids: inviteBrandIds.length > 0 ? inviteBrandIds : undefined,
        sales_channel_id: inviteSalesChannelId ? parseInt(inviteSalesChannelId) : undefined,
      });
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteDialogOpen(false);
    } catch (error: any) {
      const detail = error?.response?.data;
      if (detail && typeof detail === 'object') {
        const messages = Object.entries(detail)
          .map(([key, val]) => `${key}: ${Array.isArray(val) ? val.join(', ') : val}`)
          .join('\n');
        toast.error(messages || 'Failed to send invitation');
      } else {
        toast.error('Failed to send invitation');
      }
    } finally {
      setIsInviting(false);
    }
  };

  const getRoleBadgeVariant = (roleName: string | null) => {
    const name = (roleName || '').toLowerCase();
    if (name.includes('admin') || name.includes('super')) return 'default';
    if (name.includes('manager')) return 'secondary';
    return 'outline';
  };

  const getInitials = (fullName: string) => {
    const parts = fullName.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return fullName.substring(0, 2).toUpperCase();
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
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={openInviteDialog}>
              <Send className="size-4" />
              Invite User
            </Button>
            <Button asChild className="gap-2">
              <Link to="/dashboard/add-user">
                <UserPlus className="size-4" />
                Add User
              </Link>
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
              <Input
                placeholder="Search by name, email, or matricule..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Role Filter */}
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full md:w-[180px]">
                <Filter className="size-4 mr-2" />
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {roles.map(role => (
                  <SelectItem key={role.id} value={role.id.toString()}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-[180px]">
                <Filter className="size-4 mr-2" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>

            {/* Company Filter */}
            <Select value={companyFilter} onValueChange={setCompanyFilter}>
              <SelectTrigger className="w-full md:w-[180px]">
                <Building2 className="size-4 mr-2" />
                <SelectValue placeholder="Filter by company" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {companies.map(company => (
                  <SelectItem key={company.id} value={company.id.toString()}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-4 flex items-center gap-2 text-sm text-l-text-2 dark:text-d-text-2">
            <span>
              Showing {users.length} of {pagination.count} users
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
              <TableHead>Matricule</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="size-5 animate-spin" />
                    <span>Loading users...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-8 text-l-text-2 dark:text-d-text-2"
                >
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              users.map(user => (
                <TableRow key={user.id}>
                  {/* User Info */}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-10">
                        <AvatarImage
                          src={getMediaUrl(user.avatar) || undefined}
                          alt={user.full_name}
                        />
                        <AvatarFallback>
                          {getInitials(user.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{user.full_name}</p>
                        <p className="text-sm text-l-text-2 dark:text-d-text-2">
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>

                  {/* Matricule */}
                  <TableCell>
                    <code className="text-sm bg-l-bg-2 dark:bg-d-bg-2 px-2 py-1 rounded">
                      {user.matricule}
                    </code>
                  </TableCell>

                  {/* Role */}
                  <TableCell>
                    <Badge
                      variant={getRoleBadgeVariant(user.role_name)}
                      className="capitalize"
                    >
                      <Shield className="size-3 mr-1" />
                      {user.role_name || 'No role'}
                    </Badge>
                  </TableCell>

                  {/* Company */}
                  <TableCell>
                    {user.company_name ? (
                      <div className="flex items-center gap-2 text-sm">
                        <Building2 className="size-3 text-l-text-3 dark:text-d-text-3" />
                        <span>{user.company_name}</span>
                      </div>
                    ) : (
                      <span className="text-l-text-3 dark:text-d-text-3">
                        —
                      </span>
                    )}
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <Badge variant={user.is_active ? 'default' : 'destructive'}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>

                  {/* Joined Date */}
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm text-l-text-2 dark:text-d-text-2">
                      <Calendar className="size-3" />
                      {new Date(user.date_joined).toLocaleDateString()}
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
                          Quick View
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleViewDetails(user)}
                        >
                          <Eye className="size-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleEdit(user)}>
                          <Pencil className="size-4 mr-2" />
                          Edit User
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleChangePassword(user)}
                        >
                          <Key className="size-4 mr-2" />
                          Reset Password
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleToggleStatus(user)}
                        >
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

        {/* Pagination */}
        {!isLoading && pagination.count > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <p className="text-sm text-l-text-2 dark:text-d-text-2">
              Page {pagination.page} of {Math.ceil(pagination.count / 10)}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchUsers(pagination.page - 1)}
                disabled={!pagination.hasPrevious}
              >
                <ChevronLeft className="size-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchUsers(pagination.page + 1)}
                disabled={!pagination.hasNext}
              >
                Next
                <ChevronRight className="size-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Quick View Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
            <DialogDescription>
              Quick overview of user information
            </DialogDescription>
          </DialogHeader>

          {selectedUser && (
            <div className="space-y-6">
              {/* Avatar and Name */}
              <div className="flex items-center gap-4 pb-4 border-b">
                <Avatar className="size-20">
                  <AvatarImage
                    src={getMediaUrl(selectedUser.avatar) || undefined}
                    alt={selectedUser.full_name}
                  />
                  <AvatarFallback className="text-lg">
                    {getInitials(selectedUser.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-2xl font-semibold">
                    {selectedUser.full_name}
                  </h3>
                  <p className="text-sm text-l-text-2 dark:text-d-text-2">
                    {selectedUser.matricule}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge
                      variant={getRoleBadgeVariant(selectedUser.role_name)}
                    >
                      {selectedUser.role_name || 'No role'}
                    </Badge>
                    <Badge
                      variant={
                        selectedUser.is_active ? 'default' : 'destructive'
                      }
                    >
                      {selectedUser.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* User Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-l-text-2 dark:text-d-text-2">
                    Email
                  </Label>
                  <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                    <Mail className="size-4 text-l-text-3 dark:text-d-text-3" />
                    <span className="text-sm">{selectedUser.email}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-l-text-2 dark:text-d-text-2">
                    Company
                  </Label>
                  <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                    <Building2 className="size-4 text-l-text-3 dark:text-d-text-3" />
                    <span className="text-sm">
                      {selectedUser.company_name || 'Not assigned'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-l-text-2 dark:text-d-text-2">
                    Brands Access
                  </Label>
                  <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                    <span className="text-sm">
                      {(selectedUser.allowed_brand_names?.length ?? 0) > 0
                        ? selectedUser.allowed_brand_names.join(', ')
                        : 'No brands assigned'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-l-text-2 dark:text-d-text-2">
                    Joined Date
                  </Label>
                  <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                    <Calendar className="size-4 text-l-text-3 dark:text-d-text-3" />
                    <span className="text-sm">
                      {new Date(selectedUser.date_joined).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  onClick={() => handleViewDetails(selectedUser)}
                  className="flex-1 gap-2"
                >
                  <Eye className="size-4" />
                  View Full Details
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleEdit(selectedUser)}
                  className="flex-1 gap-2"
                >
                  <Pencil className="size-4" />
                  Edit User
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <strong>{userToDelete?.full_name}</strong>? This action cannot be
              undone and will permanently remove the user account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActioning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isActioning}
              className="bg-red-600 hover:bg-red-700"
            >
              {isActioning ? 'Deleting...' : 'Delete User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Status Toggle Confirmation Dialog */}
      <AlertDialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {userToToggle?.is_active ? 'Deactivate' : 'Activate'} User
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to{' '}
              {userToToggle?.is_active ? 'deactivate' : 'activate'}{' '}
              <strong>{userToToggle?.full_name}</strong>?
              {userToToggle?.is_active
                ? ' This will prevent them from accessing their account.'
                : ' This will restore their account access.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActioning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmToggleStatus}
              disabled={isActioning}
            >
              {isActioning
                ? 'Updating...'
                : userToToggle?.is_active
                  ? 'Deactivate'
                  : 'Activate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Change Password Modal */}
      {userForPassword && (
        <ChangePasswordModal
          open={passwordDialogOpen}
          onOpenChange={setPasswordDialogOpen}
          userId={userForPassword.id}
          userName={userForPassword.full_name}
          isAdminReset={true}
          onSuccess={() => {
            toast.success(
              `Password updated successfully for ${userForPassword.full_name}`,
              {
                description:
                  'The user will need to use the new password on their next login.',
                duration: 5000,
              }
            );
          }}
        />
      )}

      {/* Invite User Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="size-5" />
              Invite Employee
            </DialogTitle>
            <DialogDescription>
              Send an invitation email. The user will complete their registration via the link.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email *</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="employee@example.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
              />
            </div>

            {/* Role */}
            <div className="space-y-2">
              <Label>Role *</Label>
              <Select value={inviteRoleId} onValueChange={setInviteRoleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
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

            {/* Company */}
            <div className="space-y-2">
              <Label>Company *</Label>
              <Select value={inviteCompanyId} onValueChange={handleInviteCompanyChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map(company => (
                    <SelectItem key={company.id} value={company.id.toString()}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Brands (shown after company is selected) */}
            {inviteBrands.length > 0 && (
              <div className="space-y-2">
                <Label>Brands</Label>
                <div className="border rounded-md p-3 space-y-2 max-h-[140px] overflow-y-auto">
                  {inviteBrands.map(brand => (
                    <div key={brand.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`brand-${brand.id}`}
                        checked={inviteBrandIds.includes(brand.id)}
                        onCheckedChange={() => handleInviteBrandToggle(brand.id)}
                      />
                      <Label htmlFor={`brand-${brand.id}`} className="cursor-pointer font-normal">
                        {brand.name}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sales Channel (shown after brands are selected) */}
            {inviteChannels.length > 0 && (
              <div className="space-y-2">
                <Label>Sales Channel</Label>
                <Select value={inviteSalesChannelId} onValueChange={setInviteSalesChannelId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a sales channel (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {inviteChannels.map(ch => (
                      <SelectItem key={ch.id} value={ch.id.toString()}>
                        {ch.name} ({ch.brand_name})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)} disabled={isInviting}>
              Cancel
            </Button>
            <Button onClick={handleSendInvite} disabled={isInviting} className="gap-2">
              {isInviting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {isInviting ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
