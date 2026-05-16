import { useCallback, useEffect, useState } from 'react';
import {
  Eye,
  Pencil,
  Trash2,
  Search,
  Filter,
  MoreVertical,
  Building2,
  Tag,
  Calendar,
  Store,
  Plus,
  Upload,
  X,
} from 'lucide-react';
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
  useBrands,
  useCompanies,
  useCreateBrand,
  usePartialUpdateBrand,
  useDeleteBrand,
} from '@/hooks/queries';
import type { Brand } from '@/types';
import { getMediaUrl } from '@/utils/helpers';

export default function BrandsPage() {
  const { user } = useAuthStore();
  const isSuperAdmin = hasRole(user, 'SuperAdmin');

  // React Query - Fetch data with caching
  const {
    data: brands = [],
    isLoading,
    error: fetchError,
    refetch,
  } = useBrands();
  const { data: companies = [] } = useCompanies();

  // React Query - Mutations
  const createBrandMutation = useCreateBrand();
  const updateBrandMutation = usePartialUpdateBrand();
  const deleteBrandMutation = useDeleteBrand();

  // Local UI state (not server state)
  const [filteredBrands, setFilteredBrands] = useState<Brand[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('all');

  // Dialog states
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const [brandToDelete, setBrandToDelete] = useState<Brand | null>(null);
  const [editFormData, setEditFormData] = useState<{
    id: number;
    name: string;
    company: number;
  } | null>(null);

  const [viewDialog, setViewDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [addDialog, setAddDialog] = useState(false);
  const [successDialog, setSuccessDialog] = useState(false);
  const [errorDialog, setErrorDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Add brand form state
  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandCompany, setNewBrandCompany] = useState<string>('');
  const [newBrandLogo, setNewBrandLogo] = useState<File | null>(null);
  const [newBrandLogoPreview, setNewBrandLogoPreview] = useState<string | null>(
    null
  );

  // Edit brand logo state
  const [editBrandLogo, setEditBrandLogo] = useState<File | null>(null);
  const [editBrandLogoPreview, setEditBrandLogoPreview] = useState<
    string | null
  >(null);

  // Helper function to extract error messages
  const extractErrorMessage = (error: unknown): string => {
    const defaultMsg = 'An error occurred. Please try again.';

    if (!error || typeof error !== 'object') {
      return defaultMsg;
    }

    const err = error as { response?: { data?: unknown }; message?: string };

    // Handle API response errors
    if (err.response?.data) {
      const data = err.response.data;

      // Handle field validation errors
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const fieldErrors = Object.entries(
          data as Record<string, unknown>
        ).flatMap(([field, messages]) => {
          const fieldName = field
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
          if (Array.isArray(messages)) {
            return messages.map(msg => `${fieldName}: ${msg}`);
          }
          return typeof messages === 'string'
            ? [`${fieldName}: ${messages}`]
            : [];
        });

        if (fieldErrors.length > 0) {
          return 'Validation errors:\n\n' + fieldErrors.join('\n');
        }

        const dataObj = data as { detail?: string; message?: string };
        return dataObj.detail ?? dataObj.message ?? defaultMsg;
      }

      if (typeof data === 'string') return data;
    }

    // Handle network/timeout errors
    if (err.message?.includes('Network Error'))
      return 'Network error. Please check your connection.';
    if (err.message?.includes('timeout'))
      return 'Request timeout. Please try again.';

    return err.message ?? defaultMsg;
  };

  // Filter brands
  useEffect(() => {
    let filtered = brands;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        brand =>
          brand.name.toLowerCase().includes(query) ||
          brand.company_name.toLowerCase().includes(query)
      );
    }

    // Company filter
    if (companyFilter !== 'all') {
      filtered = filtered.filter(
        brand => brand.company === Number(companyFilter)
      );
    }

    setFilteredBrands(filtered);
  }, [searchQuery, companyFilter, brands]);

  // Action handlers
  const handleView = useCallback((brand: Brand) => {
    setSelectedBrand(brand);
    setViewDialog(true);
  }, []);

  const handleEdit = useCallback((brand: Brand) => {
    setEditFormData({ id: brand.id, name: brand.name, company: brand.company });
    setEditBrandLogo(null);
    setEditBrandLogoPreview(brand.logo || null);
    setEditDialog(true);
  }, []);

  const handleSaveEdit = async () => {
    if (!editFormData) return;

    try {
      const updateData: { name: string; company: number; logo?: File } = {
        name: editFormData.name,
        company: editFormData.company,
      };
      if (editBrandLogo) {
        updateData.logo = editBrandLogo;
      }
      await updateBrandMutation.mutateAsync({
        id: editFormData.id,
        data: updateData,
      });
      setSuccessMessage('Brand updated successfully!');
      setSuccessDialog(true);
      setEditDialog(false);
      setEditBrandLogo(null);
      setEditBrandLogoPreview(null);
    } catch (err) {
      console.error('Error updating brand:', err);
      setEditDialog(false);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  const handleDelete = useCallback((brand: Brand) => {
    setBrandToDelete(brand);
    setDeleteDialog(true);
  }, []);

  const confirmDelete = async () => {
    if (!brandToDelete) return;

    try {
      await deleteBrandMutation.mutateAsync(brandToDelete.id);
      setSuccessMessage('Brand deleted successfully!');
      setSuccessDialog(true);
      setDeleteDialog(false);
    } catch (err) {
      console.error('Error deleting brand:', err);
      setDeleteDialog(false);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  const handleAddBrand = async () => {
    if (!newBrandName.trim() || !newBrandCompany) {
      setErrorMessage('Please fill in all required fields.');
      setErrorDialog(true);
      return;
    }

    try {
      const createData: { name: string; company: number; logo?: File } = {
        name: newBrandName.trim(),
        company: Number(newBrandCompany),
      };
      if (newBrandLogo) {
        createData.logo = newBrandLogo;
      }
      await createBrandMutation.mutateAsync(createData);
      setSuccessMessage('Brand created successfully!');
      setSuccessDialog(true);
      setAddDialog(false);
      setNewBrandName('');
      setNewBrandCompany('');
      setNewBrandLogo(null);
      setNewBrandLogoPreview(null);
    } catch (err) {
      console.error('Error creating brand:', err);
      setAddDialog(false);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  // Logo file handlers
  const handleNewLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setNewBrandLogo(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewBrandLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleEditLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setEditBrandLogo(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditBrandLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearNewLogo = () => {
    setNewBrandLogo(null);
    setNewBrandLogoPreview(null);
  };

  const clearEditLogo = () => {
    setEditBrandLogo(null);
    setEditBrandLogoPreview(null);
  };

  const getChannelTypeBadgeVariant = (
    type: string
  ): 'default' | 'secondary' => {
    return type === 'WOOCOMMERCE' ? 'default' : 'secondary';
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-l-text-2 dark:text-d-text-2">Loading brands...</p>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="p-8 max-w-md text-center">
          <p className="text-red-500">
            {fetchError instanceof Error
              ? fetchError.message
              : 'Failed to load brands'}
          </p>
          <Button onClick={() => refetch()} className="mt-4">
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Brands Management
            </h1>
            <p className="text-l-text-2 dark:text-d-text-2 mt-2">
              Manage brands and their sales channels
            </p>
          </div>
          <Button onClick={() => setAddDialog(true)} className="gap-2">
            <Plus className="size-4" />
            Add New Brand
          </Button>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
              <Input
                placeholder="Search by brand name or company..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Company Filter */}
            {isSuperAdmin && companies.length > 0 && (
              <Select value={companyFilter} onValueChange={setCompanyFilter}>
                <SelectTrigger className="w-full md:w-[220px]">
                  <Filter className="size-4 mr-2" />
                  <SelectValue placeholder="Filter by company" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Companies</SelectItem>
                  {companies.map(company => (
                    <SelectItem key={company.id} value={String(company.id)}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2 text-sm text-l-text-2 dark:text-d-text-2">
            <span>
              Showing {filteredBrands.length} of {brands.length} brands
            </span>
          </div>
        </Card>
      </div>

      {/* Brands Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brand</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Sales Channels</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredBrands.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-8 text-l-text-2 dark:text-d-text-2"
                >
                  No brands found
                </TableCell>
              </TableRow>
            ) : (
              filteredBrands.map(brand => (
                <TableRow
                  key={brand.id}
                  className="cursor-pointer hover:bg-l-bg-2 dark:hover:bg-d-bg-2 transition-colors"
                  onClick={() => handleView(brand)}
                >
                  {/* Brand Info */}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-full overflow-hidden bg-l-bg-2 dark:bg-d-bg-2 flex items-center justify-center border border-l-border dark:border-d-border flex-shrink-0">
                        {brand.logo ? (
                          <img
                            src={getMediaUrl(brand.logo) || ''}
                            alt={brand.name}
                            className="size-full object-cover"
                            onError={e => {
                              e.currentTarget.style.display = 'none';
                              e.currentTarget.nextElementSibling?.classList.remove(
                                'hidden'
                              );
                            }}
                          />
                        ) : null}
                        <span
                          className={`text-xs font-semibold ${brand.logo ? 'hidden' : ''}`}
                        >
                          {brand.name.substring(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{brand.name}</p>
                      </div>
                    </div>
                  </TableCell>

                  {/* Company */}
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      <Building2 className="size-4 text-l-text-3 dark:text-d-text-3" />
                      <span className="text-l-text-2 dark:text-d-text-2">
                        {brand.company_name}
                      </span>
                    </div>
                  </TableCell>

                  {/* Sales Channels */}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="gap-1">
                        <Store className="size-3" />
                        {brand.channels_count}
                      </Badge>
                      {brand.sales_channels?.slice(0, 2).map(channel => (
                        <Badge
                          key={channel.id}
                          variant={getChannelTypeBadgeVariant(
                            channel.channel_type
                          )}
                          className="text-xs"
                        >
                          {channel.channel_type}
                        </Badge>
                      ))}
                      {brand.sales_channels &&
                        brand.sales_channels.length > 2 && (
                          <Badge variant="outline" className="text-xs">
                            +{brand.sales_channels.length - 2}
                          </Badge>
                        )}
                    </div>
                  </TableCell>

                  {/* Created Date */}
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm text-l-text-2 dark:text-d-text-2">
                      <Calendar className="size-3" />
                      {new Date(brand.created_at).toLocaleDateString()}
                    </div>
                  </TableCell>

                  {/* Actions */}
                  <TableCell
                    className="text-right"
                    onClick={e => e.stopPropagation()}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleView(brand)}>
                          <Eye className="size-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleEdit(brand)}>
                          <Pencil className="size-4 mr-2" />
                          Edit Brand
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleDelete(brand)}
                          className="text-red-600 dark:text-red-400"
                        >
                          <Trash2 className="size-4 mr-2" />
                          Delete Brand
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

      {/* View Brand Dialog */}
      <Dialog open={viewDialog} onOpenChange={setViewDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Brand Details</DialogTitle>
            <DialogDescription>
              Complete information about the brand
            </DialogDescription>
          </DialogHeader>

          {selectedBrand && (
            <div className="space-y-6">
              {/* Logo and Name */}
              <div className="flex items-center gap-4 pb-4 border-b">
                <div className="size-16 rounded-full overflow-hidden bg-l-bg-2 dark:bg-d-bg-2 flex items-center justify-center border-2 border-l-border dark:border-d-border">
                  {selectedBrand.logo ? (
                    <img
                      src={getMediaUrl(selectedBrand.logo) || ''}
                      alt={selectedBrand.name}
                      className="size-full object-cover"
                      onError={e => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove(
                          'hidden'
                        );
                      }}
                    />
                  ) : null}
                  <div
                    className={`flex items-center justify-center size-full text-lg font-semibold ${selectedBrand.logo ? 'hidden' : ''}`}
                  >
                    {selectedBrand.name.substring(0, 2).toUpperCase()}
                  </div>
                </div>
                <div>
                  <h3 className="text-2xl font-semibold">
                    {selectedBrand.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-2 text-sm text-l-text-2 dark:text-d-text-2">
                    <Building2 className="size-4" />
                    {selectedBrand.company_name}
                  </div>
                </div>
              </div>

              {/* Brand Information */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-l-text-2 dark:text-d-text-2 flex items-center gap-2">
                  <Tag className="size-4" />
                  Brand Information
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">
                      Brand ID
                    </span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <span className="text-sm font-mono">
                        {selectedBrand.id}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">
                      Company
                    </span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <Building2 className="size-4 text-accent-1" />
                      <span className="text-sm">
                        {selectedBrand.company_name}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">
                      Channels Count
                    </span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <Store className="size-4 text-accent-1" />
                      <span className="text-sm font-semibold">
                        {selectedBrand.channels_count} channels
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">
                      Created
                    </span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <Calendar className="size-4 text-accent-1" />
                      <span className="text-sm">
                        {new Date(selectedBrand.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-l-text-3 dark:text-d-text-3">
                      Last Updated
                    </span>
                    <div className="flex items-center gap-2 p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg">
                      <Calendar className="size-4 text-accent-1" />
                      <span className="text-sm">
                        {new Date(selectedBrand.updated_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sales Channels */}
              {selectedBrand.sales_channels &&
                selectedBrand.sales_channels.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-l-text-2 dark:text-d-text-2 flex items-center gap-2">
                      <Store className="size-4" />
                      Sales Channels
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {selectedBrand.sales_channels.map(channel => (
                        <div
                          key={channel.id}
                          className="flex items-center justify-between p-3 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg"
                        >
                          <span className="text-sm font-medium">
                            {channel.name}
                          </span>
                          <Badge
                            variant={getChannelTypeBadgeVariant(
                              channel.channel_type
                            )}
                          >
                            {channel.channel_type}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  onClick={() => {
                    setViewDialog(false);
                    handleEdit(selectedBrand);
                  }}
                  className="flex-1 gap-2"
                >
                  <Pencil className="size-4" />
                  Edit Brand
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setViewDialog(false)}
                  className="flex-1"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Brand Dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Brand</DialogTitle>
            <DialogDescription>Update brand information</DialogDescription>
          </DialogHeader>

          {editFormData && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Brand Name *</Label>
                <div className="relative">
                  <Tag className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                  <Input
                    id="edit-name"
                    value={editFormData.name}
                    onChange={e =>
                      setEditFormData({ ...editFormData, name: e.target.value })
                    }
                    className="pl-10"
                    placeholder="Brand name"
                  />
                </div>
              </div>

              {isSuperAdmin && companies.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="edit-company">Company *</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3 z-10 pointer-events-none" />
                    <Select
                      value={String(editFormData.company)}
                      onValueChange={value =>
                        setEditFormData({
                          ...editFormData,
                          company: Number(value),
                        })
                      }
                    >
                      <SelectTrigger id="edit-company" className="pl-10">
                        <SelectValue placeholder="Select a company" />
                      </SelectTrigger>
                      <SelectContent>
                        {companies.map(company => (
                          <SelectItem
                            key={company.id}
                            value={String(company.id)}
                          >
                            {company.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Logo Upload */}
              <div className="space-y-2">
                <Label>Brand Logo</Label>
                <div className="flex items-center gap-4">
                  {editBrandLogoPreview ? (
                    <div className="relative">
                      <div className="size-16 rounded-lg overflow-hidden bg-l-bg-2 dark:bg-d-bg-2 border border-l-border dark:border-d-border">
                        <img
                          src={editBrandLogoPreview}
                          alt="Logo preview"
                          className="size-full object-cover"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={clearEditLogo}
                        className="absolute -top-2 -right-2 size-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="size-16 rounded-lg bg-l-bg-2 dark:bg-d-bg-2 border border-dashed border-l-border dark:border-d-border flex items-center justify-center">
                      <Upload className="size-6 text-l-text-3 dark:text-d-text-3" />
                    </div>
                  )}
                  <div className="flex-1">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={handleEditLogoChange}
                      className="cursor-pointer"
                    />
                    <p className="text-xs text-l-text-3 dark:text-d-text-3 mt-1">
                      PNG, JPG up to 2MB
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button onClick={handleSaveEdit} className="flex-1 gap-2">
                  <Pencil className="size-4" />
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditDialog(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Brand Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Brand</DialogTitle>
            <DialogDescription>
              Create a new brand for a company
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-name">Brand Name *</Label>
              <div className="relative">
                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                <Input
                  id="new-name"
                  value={newBrandName}
                  onChange={e => setNewBrandName(e.target.value)}
                  className="pl-10"
                  placeholder="Enter brand name"
                />
              </div>
            </div>

            {companies.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="new-company">Company *</Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3 z-10 pointer-events-none" />
                  <Select
                    value={newBrandCompany}
                    onValueChange={setNewBrandCompany}
                  >
                    <SelectTrigger id="new-company" className="pl-10">
                      <SelectValue placeholder="Select a company" />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map(company => (
                        <SelectItem key={company.id} value={String(company.id)}>
                          {company.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Logo Upload */}
            <div className="space-y-2">
              <Label>Brand Logo</Label>
              <div className="flex items-center gap-4">
                {newBrandLogoPreview ? (
                  <div className="relative">
                    <div className="size-16 rounded-lg overflow-hidden bg-l-bg-2 dark:bg-d-bg-2 border border-l-border dark:border-d-border">
                      <img
                        src={newBrandLogoPreview}
                        alt="Logo preview"
                        className="size-full object-cover"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={clearNewLogo}
                      className="absolute -top-2 -right-2 size-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ) : (
                  <div className="size-16 rounded-lg bg-l-bg-2 dark:bg-d-bg-2 border border-dashed border-l-border dark:border-d-border flex items-center justify-center">
                    <Upload className="size-6 text-l-text-3 dark:text-d-text-3" />
                  </div>
                )}
                <div className="flex-1">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleNewLogoChange}
                    className="cursor-pointer"
                  />
                  <p className="text-xs text-l-text-3 dark:text-d-text-3 mt-1">
                    PNG, JPG up to 2MB
                  </p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t">
              <Button onClick={handleAddBrand} className="flex-1 gap-2">
                <Plus className="size-4" />
                Create Brand
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setAddDialog(false);
                  setNewBrandName('');
                  setNewBrandCompany('');
                  setNewBrandLogo(null);
                  setNewBrandLogoPreview(null);
                }}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Brand</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <strong>{brandToDelete?.name}</strong>? This action cannot be
              undone and will permanently remove the brand and all associated
              data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete Brand
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
            <AlertDialogDescription>{successMessage}</AlertDialogDescription>
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
