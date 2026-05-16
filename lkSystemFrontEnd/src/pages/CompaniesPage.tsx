import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from "react-router-dom";
import { 
  Eye, 
  Pencil, 
  Trash2, 
  Ban, 
  Search, 
  Filter,
  MoreVertical,
  Building2,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Package,
  FileText,
  Landmark,
  CreditCard,
  Hash,
  Briefcase,
  Camera
} from 'lucide-react';

// Tunisia Governorates (Cities)
const TUNISIA_CITIES = [
  'Tunis',
  'Ariana',
  'Ben Arous',
  'Manouba',
  'Nabeul',
  'Zaghouan',
  'Bizerte',
  'Béja',
  'Jendouba',
  'Kef',
  'Siliana',
  'Sousse',
  'Monastir',
  'Mahdia',
  'Sfax',
  'Kairouan',
  'Kasserine',
  'Sidi Bouzid',
  'Gabès',
  'Medenine',
  'Tataouine',
  'Gafsa',
  'Tozeur',
  'Kebili',
] as const;
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
import { useAuthStore } from '@/store/authStore';
import { hasRole } from '@/hooks/useAuth';
import {
  useCompanies,
  useCompany,
  usePartialUpdateCompany,
  useDeleteCompany,
} from '@/hooks/queries';
import type { Company, CompanyListItem, CreateCompanyRequest } from '@/types';
import { getMediaUrl } from '@/utils/helpers';

export default function CompaniesPage() {
  const { user } = useAuthStore();
  const isSuperAdmin = hasRole(user, 'SuperAdmin');

  // React Query - Fetch data with caching
  const { data: companies = [], isLoading, error: fetchError, refetch } = useCompanies();

  // React Query - Mutations
  const updateCompanyMutation = usePartialUpdateCompany();
  const deleteCompanyMutation = useDeleteCompany();

  // ID of company to fetch full details for (View / Edit dialogs)
  const [detailCompanyId, setDetailCompanyId] = useState<number | null>(null);
  const { data: companyDetail, isLoading: isLoadingDetail } = useCompany(detailCompanyId);

  // Local UI state (not server state)
  const [filteredCompanies, setFilteredCompanies] = useState<CompanyListItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Dialog states
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [companyToDelete, setCompanyToDelete] = useState<CompanyListItem | null>(null);
  const [companyToToggle, setCompanyToToggle] = useState<CompanyListItem | null>(null);
  const [editFormData, setEditFormData] = useState<Company | null>(null);

  const [viewDialog, setViewDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [toggleDialog, setToggleDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [successDialog, setSuccessDialog] = useState(false);
  const [errorDialog, setErrorDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [editLogoFile, setEditLogoFile] = useState<File | null>(null);
  const [editLogoPreview, setEditLogoPreview] = useState<string>('');
  const editLogoInputRef = useRef<HTMLInputElement>(null);



  // Type definitions for error handling
  interface ApiError {
    detail?: string;
    message?: string;
    [key: string]: any;
  }

  // Helper function to extract error messages
  const extractErrorMessage = (error: unknown): string => {
    const errorMsg = 'An error occurred. Please try again.';

    const apiError = error as { response?: { data?: unknown }; message?: string };
    const data = apiError.response?.data;

    if (data !== undefined) {
      
      // Handle field-specific errors
      if (typeof data === 'object' && !Array.isArray(data) && data !== null) {
        const fieldErrors: string[] = [];
        
        Object.entries(data as Record<string, unknown>).forEach(([field, messages]) => {
          const fieldName = field.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
          if (Array.isArray(messages)) {
            messages.forEach(msg => fieldErrors.push(`${fieldName}: ${msg}`));
          } else if (typeof messages === 'string') {
            fieldErrors.push(`${fieldName}: ${messages}`);
          }
        });
        
        if (fieldErrors.length > 0) {
          return 'Validation errors:\n\n' + fieldErrors.join('\n');
        }
      }
      // Handle string error
      else if (typeof data === 'string') {
        return data;
      }
      // Handle detail or message
      else if (typeof data === 'object' && data !== null && 'detail' in data) {
        const detail = (data as ApiError).detail;
        if (typeof detail === 'string') return detail;
      } else if (typeof data === 'object' && data !== null && 'message' in data) {
        const msg = (data as ApiError).message;
        if (typeof msg === 'string') return msg;
      }
    }
    // Handle network errors
    else if (typeof apiError === 'object' && apiError !== null && 'message' in apiError) {
      const errMsg = (apiError as { message?: unknown }).message;
      if (typeof errMsg === 'string') {
        if (errMsg.includes('Network Error')) {
          return 'Network error. Please check your connection.';
        } else if (errMsg.includes('timeout')) {
          return 'Request timeout. Please try again.';
        }
        return errMsg;
      }
    }

    return errorMsg;
  };

  // Filter companies (list only has name, abbreviation, city — no email/legal_name)
  useEffect(() => {
    let filtered = companies;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (company) =>
          company.name.toLowerCase().includes(query) ||
          company.abbreviation.toLowerCase().includes(query) ||
          company.city.toLowerCase().includes(query)
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter((company) =>
        statusFilter === 'active' ? company.is_active : !company.is_active
      );
    }

    setFilteredCompanies(filtered);
  }, [searchQuery, statusFilter, companies]);

  // When full company detail loads, populate the dialog that requested it
  useEffect(() => {
    if (!companyDetail) return;

    if (viewDialog) {
      setSelectedCompany(companyDetail);
    }
    if (editDialog && !editFormData) {
      setEditFormData({ ...companyDetail });
      setEditLogoPreview(companyDetail.logo ?? '');
    }
  }, [companyDetail, viewDialog, editDialog, editFormData]);

  // Action handlers — fetch full details on demand
  const handleView = useCallback((company: CompanyListItem) => {
    setSelectedCompany(null); // clear stale data
    setDetailCompanyId(company.id); // trigger detail fetch
    setViewDialog(true);
  }, []);

  const handleEdit = useCallback((company: CompanyListItem) => {
    setEditFormData(null); // clear stale data
    setEditLogoFile(null);
    setEditLogoPreview(company.logo ?? '');
    setDetailCompanyId(company.id); // trigger detail fetch
    setEditDialog(true);
  }, []);

  const handleEditLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setEditLogoFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setEditLogoPreview((e.target?.result as string) ?? '');
    };
    reader.readAsDataURL(file);
  };

  const handleSaveEdit = async () => {
    if (!editFormData) return;

    try {
      const updateData: Partial<CreateCompanyRequest> = {
        name: editFormData.name,
        legal_name: editFormData.legal_name,
        abbreviation: editFormData.abbreviation,
        email: editFormData.email,
        phone: editFormData.phone,
        city: editFormData.city,
        address: editFormData.address,
        matricule_fiscale: editFormData.matricule_fiscale,
        registre_commerce: editFormData.registre_commerce,
        activity_code: editFormData.activity_code,
        bank_name: editFormData.bank_name,
        rib: editFormData.rib,
        is_active: editFormData.is_active,
      };

      if (editLogoFile) {
        updateData.logo = editLogoFile;
      }

      await updateCompanyMutation.mutateAsync({
        id: editFormData.id,
        data: updateData,
      });
      setSuccessMessage('Company updated successfully!');
      setSuccessDialog(true);
      setEditDialog(false);
      setEditLogoFile(null);
      setEditLogoPreview('');
    } catch (err) {
      console.error('Error updating company:', err);
      setEditDialog(false);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  const handleDelete = useCallback((company: CompanyListItem) => {
    setCompanyToDelete(company);
    setDeleteDialog(true);
  }, []);

  const confirmDelete = async () => {
    if (!companyToDelete) return;

    try {
      await deleteCompanyMutation.mutateAsync(companyToDelete.id);
      setSuccessMessage('Company deleted successfully!');
      setSuccessDialog(true);
      setDeleteDialog(false);
    } catch (err) {
      console.error('Error deleting company:', err);
      setDeleteDialog(false);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  const handleToggleStatus = useCallback((company: CompanyListItem) => {
    setCompanyToToggle(company);
    setToggleDialog(true);
  }, []);

  const confirmToggleStatus = async () => {
    if (!companyToToggle) return;

    try {
      await updateCompanyMutation.mutateAsync({
        id: companyToToggle.id,
        data: {
          is_active: !companyToToggle.is_active,
        },
      });
      setSuccessMessage(
        `Company ${companyToToggle.is_active ? 'deactivated' : 'activated'} successfully!`
      );
      setSuccessDialog(true);
      setToggleDialog(false);
    } catch (err) {
      console.error('Error toggling company status:', err);
      setToggleDialog(false);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  // Access denied for non-SuperAdmin users
  if (!isSuperAdmin) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="p-8 max-w-md text-center">
          <Ban className="size-16 mx-auto text-red-500 mb-4" />
          <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
          <p className="text-l-text-2 dark:text-d-text-2">
            You need SuperAdmin privileges to access this page.
          </p>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-l-text-2 dark:text-d-text-2">Loading companies...</p>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="p-8 max-w-md text-center">
          <p className="text-red-500">{fetchError instanceof Error ? fetchError.message : 'Failed to load companies'}</p>
          <Button onClick={() => refetch()} className="mt-4">
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  const handleEditDialogChange = (open: boolean) => {
    setEditDialog(open);
    if (!open) {
      setEditLogoFile(null);
      setEditLogoPreview('');
      setEditFormData(null);
      setDetailCompanyId(null);
    }
  };

  const handleViewDialogChange = (open: boolean) => {
    setViewDialog(open);
    if (!open) {
      setSelectedCompany(null);
      setDetailCompanyId(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Companies Management</h1>
            <p className="text-l-text-2 dark:text-d-text-2 mt-2">
              Manage companies and their information
            </p>
          </div>
          <Button asChild className="gap-2 w-full sm:w-auto">
            <Link to="/dashboard/add-company">
              <Building2 className="size-4" />
              Add New Company
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
                placeholder="Search by name, email, or abbreviation..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={(value: string) => {
              if (value === 'all' || value === 'active' || value === 'inactive') {
                setStatusFilter(value);
              }
            }}>
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
          </div>

          <div className="mt-4 flex items-center gap-2 text-sm text-l-text-2 dark:text-d-text-2">
            <span>Showing {filteredCompanies.length} of {companies.length} companies</span>
          </div>
        </Card>
      </div>

      {/* Companies Table */}
      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Brands</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCompanies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-l-text-2 dark:text-d-text-2">
                  No companies found
                </TableCell>
              </TableRow>
            ) : (
              filteredCompanies.map((company) => (
                <TableRow 
                  key={company.id} 
                  className="cursor-pointer hover:bg-l-bg-2 dark:hover:bg-d-bg-2 transition-colors"
                  onClick={() => handleView(company)}
                >
                  {/* Company Info */}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-full overflow-hidden bg-l-bg-2 dark:bg-d-bg-2 flex items-center justify-center border border-l-border dark:border-d-border flex-shrink-0">
                        {company.logo ? (
                          <img 
                            src={getMediaUrl(company.logo) || ''}
                            alt={company.name}
                            className="size-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              e.currentTarget.nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                        ) : null}
                        <span className={`text-xs font-semibold ${company.logo ? 'hidden' : ''}`}>
                          {company.abbreviation || company.name.substring(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{company.name}</p>
                        <p className="text-sm text-l-text-2 dark:text-d-text-2">
                          {company.abbreviation}
                        </p>
                      </div>
                    </div>
                  </TableCell>

                  {/* Location */}
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm text-l-text-2 dark:text-d-text-2">
                      <MapPin className="size-3" />
                      {company.city}
                    </div>
                  </TableCell>

                  {/* Brands Count */}
                  <TableCell>
                    <Badge variant="secondary" className="gap-1">
                      <Package className="size-3" />
                      {company.brands_count || 0}
                    </Badge>
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <Badge
                      variant={company.is_active ? 'default' : 'destructive'}
                      className="capitalize"
                    >
                      {company.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleView(company)}>
                          <Eye className="size-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleEdit(company)}>
                          <Pencil className="size-4 mr-2" />
                          Edit Company
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleStatus(company)}>
                          <Ban className="size-4 mr-2" />
                          {company.is_active ? 'Deactivate' : 'Activate'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          onClick={() => handleDelete(company)}
                          className="text-red-600 dark:text-red-400"
                        >
                          <Trash2 className="size-4 mr-2" />
                          Delete Company
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

      <div className="grid gap-3 md:hidden">
        {filteredCompanies.length === 0 ? (
          <Card className="p-6 text-center text-l-text-2 dark:text-d-text-2">
            No companies found
          </Card>
        ) : (
          filteredCompanies.map((company) => (
            <Card key={company.id} className="p-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-12 rounded-full overflow-hidden bg-l-bg-2 dark:bg-d-bg-2 flex items-center justify-center border border-l-border dark:border-d-border shrink-0">
                    {company.logo ? (
                      <img
                        src={getMediaUrl(company.logo) || ''}
                        alt={company.name}
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="text-xs font-semibold">
                        {company.abbreviation || company.name.substring(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{company.name}</p>
                    <p className="text-sm text-l-text-2 dark:text-d-text-2 truncate">{company.abbreviation}</p>
                  </div>
                </div>
                <Badge variant={company.is_active ? 'default' : 'destructive'}>
                  {company.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>

              <div className="grid grid-cols-1 gap-2 text-sm">
                <div className="flex items-center gap-2 text-l-text-2 dark:text-d-text-2">
                  <MapPin className="size-3" />
                  <span>{company.city}</span>
                </div>
                <div className="flex items-center gap-2 text-l-text-2 dark:text-d-text-2">
                  <Package className="size-3" />
                  <span>{company.brands_count || 0} brands</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => handleView(company)} className="gap-2">
                  <Eye className="size-4" />
                  View
                </Button>
                <Button onClick={() => handleEdit(company)} className="gap-2">
                  <Pencil className="size-4" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleToggleStatus(company)}
                  className="gap-2"
                >
                  <Ban className="size-4" />
                  {company.is_active ? 'Deactivate' : 'Activate'}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleDelete(company)}
                  className="gap-2"
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* View Company Dialog */}
      <Dialog open={viewDialog} onOpenChange={handleViewDialogChange}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Company Details</DialogTitle>
            <DialogDescription>
              Complete information about the company
            </DialogDescription>
          </DialogHeader>
          
          {isLoadingDetail && !selectedCompany && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3"></div>
                <p className="text-sm text-l-text-2 dark:text-d-text-2">Loading company details...</p>
              </div>
            </div>
          )}

          {selectedCompany && (
            <div className="space-y-6">
              {/* Logo and Name */}
              <div className="flex items-center gap-4 pb-4 border-b">
                <div className="size-20 rounded-full overflow-hidden bg-l-bg-2 dark:bg-d-bg-2 flex items-center justify-center border-2 border-l-border dark:border-d-border">
                  {selectedCompany.logo ? (
                    <img 
                      src={getMediaUrl(selectedCompany.logo) || ''}
                      alt={selectedCompany.name}
                      className="size-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <div className={`flex items-center justify-center size-full text-lg font-semibold ${selectedCompany.logo ? 'hidden' : ''}`}>
                    {selectedCompany.abbreviation || selectedCompany.name.substring(0, 2).toUpperCase()}
                  </div>
                </div>
                <div>
                  <h3 className="text-2xl font-semibold">{selectedCompany.name}</h3>
                  <p className="text-sm text-l-text-2 dark:text-d-text-2 mt-1">
                    {selectedCompany.legal_name}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="secondary">{selectedCompany.abbreviation}</Badge>
                    <Badge
                      variant={selectedCompany.is_active ? 'default' : 'destructive'}
                    >
                      {selectedCompany.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Contact Information */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-l-text-2 dark:text-d-text-2 flex items-center gap-2">
                  <Mail className="size-4" />
                  Contact Information
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">Email</span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <Mail className="size-4 text-accent-1" />
                      <span className="text-sm">{selectedCompany.email}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">Phone</span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <Phone className="size-4 text-accent-1" />
                      <span className="text-sm">{selectedCompany.phone}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">City</span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <MapPin className="size-4 text-accent-1" />
                      <span className="text-sm">{selectedCompany.city}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">Address</span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <Building2 className="size-4 text-accent-1" />
                      <span className="text-sm">{selectedCompany.address}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Legal & Banking Information */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-l-text-2 dark:text-d-text-2 flex items-center gap-2">
                  <FileText className="size-4" />
                  Legal & Banking Information
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">Matricule Fiscale</span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <Hash className="size-4 text-accent-1" />
                      <span className="text-sm font-mono">{selectedCompany.matricule_fiscale}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">Registre Commerce</span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <FileText className="size-4 text-accent-1" />
                      <span className="text-sm font-mono">{selectedCompany.registre_commerce}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">Activity Code</span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <Briefcase className="size-4 text-accent-1" />
                      <span className="text-sm font-mono">{selectedCompany.activity_code}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">Bank Name</span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <Landmark className="size-4 text-accent-1" />
                      <span className="text-sm">{selectedCompany.bank_name}</span>
                    </div>
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">RIB</span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <CreditCard className="size-4 text-accent-1" />
                      <span className="text-sm font-mono">{selectedCompany.rib}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats & Meta */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-l-text-2 dark:text-d-text-2 flex items-center gap-2">
                  <Package className="size-4" />
                  Company Stats
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">Brands</span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <Package className="size-4 text-accent-1" />
                      <span className="text-sm font-semibold">{selectedCompany.brands_count} brands</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">Created</span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <Calendar className="size-4 text-accent-1" />
                      <span className="text-sm">{new Date(selectedCompany.created_at).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">Last Updated</span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <Calendar className="size-4 text-accent-1" />
                      <span className="text-sm">{new Date(selectedCompany.updated_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button onClick={() => {
                  // We already have full detail data, pass it directly to edit
                  setEditFormData({ ...selectedCompany });
                  setEditLogoFile(null);
                  setEditLogoPreview(selectedCompany.logo ?? '');
                  setViewDialog(false);
                  setEditDialog(true);
                }} className="flex-1 gap-2">
                  <Pencil className="size-4" />
                  Edit Company
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    handleViewDialogChange(false);
                    handleToggleStatus(selectedCompany);
                  }}
                  className="flex-1 gap-2"
                >
                  <Ban className="size-4" />
                  {selectedCompany.is_active ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Company Dialog */}
      <Dialog open={editDialog} onOpenChange={handleEditDialogChange}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Company</DialogTitle>
            <DialogDescription>
              Update company information
            </DialogDescription>
          </DialogHeader>

          {isLoadingDetail && !editFormData && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3"></div>
                <p className="text-sm text-l-text-2 dark:text-d-text-2">Loading company details...</p>
              </div>
            </div>
          )}

          {editFormData && (
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-l-text-2 dark:text-d-text-2">Company Logo</h3>
                <div className="flex items-center gap-4">
                  <div className="size-16 rounded-full overflow-hidden bg-l-bg-2 dark:bg-d-bg-2 flex items-center justify-center border border-l-border dark:border-d-border">
                    {editLogoPreview ? (
                      <img src={editLogoPreview} alt="Company logo preview" className="size-full object-cover" />
                    ) : (
                      <span className="text-xs font-semibold">
                        {editFormData.abbreviation || editFormData.name.substring(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <input
                      ref={editLogoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleEditLogoUpload}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      onClick={() => editLogoInputRef.current?.click()}
                    >
                      <Camera className="size-4" />
                      Update Logo
                    </Button>
                    <p className="text-xs text-l-text-3 dark:text-d-text-3">PNG/JPG recommended. New image replaces current logo.</p>
                  </div>
                </div>
              </div>

              {/* Basic Information Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-l-text-2 dark:text-d-text-2 flex items-center gap-2">
                  <Building2 className="size-4" />
                  Basic Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-name">Company Name *</Label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="edit-name"
                        value={editFormData.name}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, name: e.target.value })
                        }
                        className="pl-10"
                        placeholder="Company Inc."
                      />
                    </div>
                    <p className="text-xs text-l-text-3 dark:text-d-text-3">The display name of the company</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-legal-name">Legal Name *</Label>
                    <div className="relative">
                      <FileText className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="edit-legal-name"
                        value={editFormData.legal_name}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, legal_name: e.target.value })
                        }
                        className="pl-10"
                        placeholder="Company Inc. SARL"
                      />
                    </div>
                    <p className="text-xs text-l-text-3 dark:text-d-text-3">Official registered name</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-abbreviation">Abbreviation *</Label>
                    <div className="relative">
                      <Hash className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="edit-abbreviation"
                        value={editFormData.abbreviation}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, abbreviation: e.target.value.toUpperCase() })
                        }
                        className="pl-10 uppercase"
                        placeholder="COMP"
                        maxLength={10}
                      />
                    </div>
                    <p className="text-xs text-l-text-3 dark:text-d-text-3">Short code (max 10 characters)</p>
                  </div>
                </div>
              </div>

              {/* Contact Information Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-l-text-2 dark:text-d-text-2 flex items-center gap-2">
                  <Mail className="size-4" />
                  Contact Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-email">Email *</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="edit-email"
                        type="email"
                        value={editFormData.email}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, email: e.target.value })
                        }
                        className="pl-10"
                        placeholder="contact@company.com"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-phone">Phone *</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="edit-phone"
                        value={editFormData.phone}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, phone: e.target.value })
                        }
                        className="pl-10"
                        placeholder="+216 71 123 456"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-city">City *</Label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3 z-10 pointer-events-none" />
                      <Select
                        value={editFormData.city}
                        onValueChange={(value) =>
                          setEditFormData({ ...editFormData, city: value })
                        }
                      >
                        <SelectTrigger id="edit-city" className="pl-10">
                          <SelectValue placeholder="Select a city" />
                        </SelectTrigger>
                        <SelectContent>
                          {TUNISIA_CITIES.map((city) => (
                            <SelectItem key={city} value={city}>
                              {city}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-l-text-3 dark:text-d-text-3">Select from Tunisia governorates</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-address">Address</Label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="edit-address"
                        value={editFormData.address || ''}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, address: e.target.value })
                        }
                        className="pl-10"
                        placeholder="123 Business Street"
                      />
                    </div>
                    <p className="text-xs text-l-text-3 dark:text-d-text-3">Optional street address</p>
                  </div>
                </div>
              </div>

              {/* Legal & Banking Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-l-text-2 dark:text-d-text-2 flex items-center gap-2">
                  <FileText className="size-4" />
                  Legal & Banking Information (Optional)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-matricule">Matricule Fiscale</Label>
                    <div className="relative">
                      <Hash className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="edit-matricule"
                        value={editFormData.matricule_fiscale || ''}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, matricule_fiscale: e.target.value })
                        }
                        className="pl-10 font-mono"
                        placeholder="1234567ABC"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-registre">Registre Commerce</Label>
                    <div className="relative">
                      <FileText className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="edit-registre"
                        value={editFormData.registre_commerce || ''}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, registre_commerce: e.target.value })
                        }
                        className="pl-10 font-mono"
                        placeholder="B123456789"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-activity-code">Activity Code</Label>
                    <div className="relative">
                      <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="edit-activity-code"
                        value={editFormData.activity_code || ''}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, activity_code: e.target.value })
                        }
                        className="pl-10 font-mono"
                        placeholder="NAF/APE code"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-bank">Bank Name</Label>
                    <div className="relative">
                      <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="edit-bank"
                        value={editFormData.bank_name || ''}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, bank_name: e.target.value })
                        }
                        className="pl-10"
                        placeholder="Bank of Tunisia"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-rib">RIB</Label>
                    <div className="relative">
                      <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                      <Input
                        id="edit-rib"
                        value={editFormData.rib || ''}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, rib: e.target.value })
                        }
                        className="pl-10 font-mono"
                        placeholder="12345678901234567890"
                        maxLength={20}
                      />
                    </div>
                    <p className="text-xs text-l-text-3 dark:text-d-text-3">20-digit bank account number</p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
                <Button onClick={handleSaveEdit} className="flex-1 gap-2">
                  <Pencil className="size-4" />
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleEditDialogChange(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Company</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{companyToDelete?.name}</strong>?
              This action cannot be undone and will permanently remove the company and all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete Company
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Toggle Status Confirmation Dialog */}
      <AlertDialog open={toggleDialog} onOpenChange={setToggleDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {companyToToggle?.is_active ? 'Deactivate' : 'Activate'} Company
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to {companyToToggle?.is_active ? 'deactivate' : 'activate'}{' '}
              <strong>{companyToToggle?.name}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmToggleStatus}>
              {companyToToggle?.is_active ? 'Deactivate' : 'Activate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Success Dialog */}
      <AlertDialog open={successDialog} onOpenChange={setSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-green-600 dark:text-green-500">
              ✓ Success!
            </AlertDialogTitle>
            <AlertDialogDescription>
              {successMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setSuccessDialog(false)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Error Dialog */}
      <AlertDialog open={errorDialog} onOpenChange={setErrorDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600 dark:text-red-500">
              ✗ Error
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {errorMessage}
            </AlertDialogDescription>
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
