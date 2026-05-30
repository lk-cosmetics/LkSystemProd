import { useCallback, useEffect, useState, useMemo, memo } from 'react';
import { 
  Eye, 
  Pencil,
  Trash2, 
  Search, 
  MoreVertical,
  FolderTree,
  Store,
  Calendar,
  Layers,
  ChevronRight,
  Package,
  Hash,
  Plus,
  Type,
  Link2,
  FileText,
  Image as ImageIcon,
  ListOrdered,
  RefreshCw,
  Globe,
  Check,
  Tag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
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
import { Checkbox } from '@/components/ui/checkbox';
import { useAuthStore } from '@/store/authStore';
import { isPlatformAdmin } from '@/hooks/useAuth';
import { 
  useCategories,
  useSalesChannels,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useSyncCategoriesFromWooCommerce,
  usePreviewCategoriesFromWooCommerce,
  useSyncSelectedCategoriesFromWooCommerce,
} from '@/hooks/queries';
import type { CategoryListItem } from '@/types';
import { getMediaUrl } from '@/utils/helpers';

// Memoized Category Row Component to prevent unnecessary re-renders
interface CategoryRowProps {
  category: CategoryListItem;
  isSelected: boolean;
  selectionMode: boolean;
  onToggleSelection: (id: number) => void;
  onView: (category: CategoryListItem) => void;
  onEdit: (category: CategoryListItem) => void;
  onDelete: (category: CategoryListItem) => void;
}

const CategoryRow = memo(function CategoryRow({
  category,
  isSelected,
  selectionMode,
  onToggleSelection,
  onView,
  onEdit,
  onDelete,
}: CategoryRowProps) {
  const handleRowClick = useCallback((e: React.MouseEvent<HTMLTableRowElement>) => {
    // Check if click is on interactive elements
    const target = e.target as HTMLElement;
    const isCheckbox = target.closest('[role="checkbox"]');
    const isButton = target.closest('button');
    const isDropdown = target.closest('[role="menu"]');
    
    // Always ignore clicks on interactive elements
    if (isCheckbox || isButton || isDropdown) return;
    
    // Samsung Gallery-style: In selection mode, toggle selection; otherwise, view details
    if (selectionMode) {
      onToggleSelection(category.id);
    } else {
      onView(category);
    }
  }, [selectionMode, category, onToggleSelection, onView]);

  const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleCheckboxChange = useCallback(() => {
    onToggleSelection(category.id);
  }, [category.id, onToggleSelection]);

  return (
    <TableRow 
      className={`group cursor-pointer hover:bg-l-bg-2/50 dark:hover:bg-d-bg-2/50 transition-all duration-150 ${isSelected ? 'bg-primary/5 hover:bg-primary/10' : ''}`}
      onClick={handleRowClick}
    >
      {/* Checkbox */}
      <TableCell className="w-12" onClick={handleCheckboxClick}>
        <div className="flex items-center justify-center p-1 -m-1 rounded hover:bg-l-bg-3 dark:hover:bg-d-bg-3 transition-colors">
          <Checkbox 
            checked={isSelected}
            onCheckedChange={handleCheckboxChange}
          />
        </div>
      </TableCell>

      {/* Category Info */}
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg overflow-hidden bg-l-bg-2 dark:bg-d-bg-2 flex items-center justify-center border border-l-border dark:border-d-border flex-shrink-0 group-hover:border-primary/30 transition-colors">
            {category.image_url ? (
              <img 
                src={getMediaUrl(category.image_url) || ''}
                alt={category.name}
                className="size-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <FolderTree className={`size-5 text-l-text-3 dark:text-d-text-3 ${category.image_url ? 'hidden' : ''}`} />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate max-w-[200px] group-hover:text-primary transition-colors">{category.name}</p>
            <p className="text-xs text-l-text-3 dark:text-d-text-3 font-mono">{category.slug}</p>
          </div>
        </div>
      </TableCell>

      {/* Channel */}
      <TableCell>
        <div className="flex items-center gap-2 text-sm">
          <Store className="size-4 text-l-text-3 dark:text-d-text-3" />
          <span className="text-l-text-2 dark:text-d-text-2">{category.sales_channel_name}</span>
        </div>
      </TableCell>

      {/* Parent */}
      <TableCell>
        {category.parent_name ? (
          <div className="flex items-center gap-1 text-sm">
            <ChevronRight className="size-3 text-l-text-3 dark:text-d-text-3" />
            <span className="text-l-text-2 dark:text-d-text-2">{category.parent_name}</span>
          </div>
        ) : (
          <Badge variant="outline">Root</Badge>
        )}
      </TableCell>

      {/* Products Count */}
      <TableCell>
        <Badge variant="secondary" className="gap-1">
          <Package className="size-3" />
          {category.products_count}
        </Badge>
      </TableCell>

      {/* Children Count */}
      <TableCell>
        <Badge variant="outline" className="gap-1">
          <Layers className="size-3" />
          {category.children_count}
        </Badge>
      </TableCell>

      {/* Display Order */}
      <TableCell>
        <div className="flex items-center gap-1 text-sm text-l-text-2 dark:text-d-text-2">
          <Hash className="size-3" />
          {category.display_order}
        </div>
      </TableCell>

      {/* Actions */}
      <TableCell className="text-right" onClick={handleCheckboxClick}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onView(category)}>
              <Eye className="size-4 mr-2" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(category)}>
              <Pencil className="size-4 mr-2" />
              Edit Category
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={() => onDelete(category)}
              className="text-red-600 focus:text-red-600"
            >
              <Trash2 className="size-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
});

interface CategoryFormData {
  id?: number;
  name: string;
  slug: string;
  description: string;
  parent: string;
  sales_channel: string;
  display_order: number;
  image_url: string;
}

const initialFormData: CategoryFormData = {
  name: '',
  slug: '',
  description: '',
  parent: '',
  sales_channel: '',
  display_order: 0,
  image_url: '',
};

export default function CategoriesPage() {
  const { user } = useAuthStore();

  // React Query - Fetch data with caching
  const { data: categories = [], isLoading, error: fetchError, refetch } = useCategories();
  const { data: salesChannels = [] } = useSalesChannels();

  // React Query - Mutations
  const createCategoryMutation = useCreateCategory();
  const updateCategoryMutation = useUpdateCategory();
  const deleteCategoryMutation = useDeleteCategory();
  const syncMutation = useSyncCategoriesFromWooCommerce();
  const previewMutation = usePreviewCategoriesFromWooCommerce();
  const syncSelectedMutation = useSyncSelectedCategoriesFromWooCommerce();

  // Local UI state (not server state)
  const [filteredCategories, setFilteredCategories] = useState<CategoryListItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [salesChannelFilter, setSalesChannelFilter] = useState<string>('all');
  const [parentFilter, setParentFilter] = useState<string>('all');

  // Dialog states
  const [selectedCategory, setSelectedCategory] = useState<CategoryListItem | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<CategoryListItem | null>(null);
  const [viewDialog, setViewDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [addDialog, setAddDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [successDialog, setSuccessDialog] = useState(false);
  const [errorDialog, setErrorDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Form state
  const [formData, setFormData] = useState<CategoryFormData>(initialFormData);

  // Sync dialog state
  const [syncDialog, setSyncDialog] = useState(false);
  const [selectedSyncChannel, setSelectedSyncChannel] = useState<string>('');

  // WooCommerce Preview dialog state
  const [previewDialog, setPreviewDialog] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [selectedWcCategories, setSelectedWcCategories] = useState<number[]>([]);

  // Bulk selection state
  const [selectedCategories, setSelectedCategories] = useState<number[]>([]);
  const [bulkDeleteDialog, setBulkDeleteDialog] = useState(false);

  // Selection mode: Samsung Gallery-style (when items are selected, clicking rows toggles selection)
  const selectionMode = useMemo(() => selectedCategories.length > 0, [selectedCategories.length]);

  // Check if user is SuperAdmin
  const isSuperAdmin = isPlatformAdmin(user);

  // Helper function to extract error messages
  const extractErrorMessage = (error: unknown): string => {
    const defaultMsg = 'An error occurred. Please try again.';
    
    if (!error || typeof error !== 'object') {
      return defaultMsg;
    }

    const err = error as { response?: { data?: unknown }; message?: string };
    
    if (err.response?.data) {
      const data = err.response.data;
      
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const fieldErrors = Object.entries(data as Record<string, unknown>)
          .flatMap(([field, messages]) => {
            const fieldName = field.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            if (Array.isArray(messages)) {
              return messages.map(msg => `${fieldName}: ${msg}`);
            }
            return typeof messages === 'string' ? [`${fieldName}: ${messages}`] : [];
          });
        
        if (fieldErrors.length > 0) {
          return 'Validation errors:\n\n' + fieldErrors.join('\n');
        }
        
        const dataObj = data as { detail?: string; message?: string };
        return dataObj.detail ?? dataObj.message ?? defaultMsg;
      }
      
      if (typeof data === 'string') return data;
    }
    
    if (err.message?.includes('Network Error')) return 'Network error. Please check your connection.';
    if (err.message?.includes('timeout')) return 'Request timeout. Please try again.';
    
    return err.message ?? defaultMsg;
  };

  // Fetch categories and related data
  useEffect(() => {
    // React Query handles data fetching automatically
  }, []);

  // Get unique parent categories for filter
  const parentCategories = categories.filter(cat => cat.parent === null);

  // Filter categories
  useEffect(() => {
    let filtered = categories;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (category) =>
          category.name.toLowerCase().includes(query) ||
          category.slug.toLowerCase().includes(query) ||
          category.sales_channel_name.toLowerCase().includes(query) ||
          category.description.toLowerCase().includes(query)
      );
    }

    // Sales channel filter
    if (salesChannelFilter !== 'all') {
      filtered = filtered.filter((category) => category.sales_channel === Number(salesChannelFilter));
    }

    // Parent filter
    if (parentFilter === 'root') {
      filtered = filtered.filter((category) => category.parent === null);
    } else if (parentFilter !== 'all') {
      filtered = filtered.filter((category) => category.parent === Number(parentFilter));
    }

    setFilteredCategories(filtered);
  }, [searchQuery, salesChannelFilter, parentFilter, categories]);

  // Action handlers
  const handleView = useCallback((category: CategoryListItem) => {
    setSelectedCategory(category);
    setViewDialog(true);
  }, []);

  const handleAdd = useCallback(() => {
    setFormData(initialFormData);
    setAddDialog(true);
  }, []);

  const handleEdit = useCallback((category: CategoryListItem) => {
    setFormData({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      parent: category.parent ? String(category.parent) : '',
      sales_channel: String(category.sales_channel),
      display_order: category.display_order,
      image_url: category.image_url || '',
    });
    setEditDialog(true);
  }, []);

  const handleDelete = useCallback((category: CategoryListItem) => {
    setCategoryToDelete(category);
    setDeleteDialog(true);
  }, []);

  const handleFormChange = (field: keyof CategoryFormData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Generate slug from name
  const generateSlug = (name: string) => {
    let slug = name.toLowerCase();
    // Remove non-word characters except spaces and hyphens
    slug = slug.split('').filter(c => /[\w\s-]/.test(c)).join('');
    // Replace spaces and underscores with hyphens
    slug = slug.split(/[\s_]+/).join('-');
    // Remove leading/trailing hyphens
    while (slug.startsWith('-')) slug = slug.slice(1);
    while (slug.endsWith('-')) slug = slug.slice(0, -1);
    // Replace multiple hyphens with single hyphen
    slug = slug.split(/-+/).join('-');
    return slug;
  };

  const handleNameChange = (value: string) => {
    handleFormChange('name', value);
    // Auto-generate slug only when adding new category
    if (!formData.id) {
      handleFormChange('slug', generateSlug(value));
    }
  };

  const handleAddCategory = async () => {
    if (!formData.name.trim() || !formData.sales_channel) {
      setErrorMessage('Please fill in all required fields (Name, Sales Channel).');
      setErrorDialog(true);
      return;
    }

    try {
      await createCategoryMutation.mutateAsync({
        wc_category_id: 0,
        sales_channel: Number(formData.sales_channel),
        name: formData.name.trim(),
        slug: formData.slug || generateSlug(formData.name),
        description: formData.description,
        parent: formData.parent && formData.parent !== 'none' ? Number(formData.parent) : null,
        display_order: formData.display_order,
        image_url: formData.image_url || undefined,
      });
      setSuccessMessage('Category created successfully!');
      setSuccessDialog(true);
      setAddDialog(false);
      setFormData(initialFormData);
    } catch (err) {
      console.error('Error creating category:', err);
      setAddDialog(false);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  const handleSaveEdit = async () => {
    if (!formData.id || !formData.name.trim()) {
      setErrorMessage('Please fill in all required fields.');
      setErrorDialog(true);
      return;
    }

    try {
      await updateCategoryMutation.mutateAsync({
        id: formData.id,
        data: {
          name: formData.name.trim(),
          slug: formData.slug,
          description: formData.description,
          parent: formData.parent && formData.parent !== 'none' ? Number(formData.parent) : null,
          display_order: formData.display_order,
          image_url: formData.image_url || undefined,
        },
      });
      setSuccessMessage('Category updated successfully!');
      setSuccessDialog(true);
      setEditDialog(false);
    } catch (err) {
      console.error('Error updating category:', err);
      setEditDialog(false);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  const confirmDelete = async () => {
    if (!categoryToDelete) return;

    try {
      await deleteCategoryMutation.mutateAsync(categoryToDelete.id);
      setSuccessMessage('Category deleted successfully!');
      setSuccessDialog(true);
      setDeleteDialog(false);
    } catch (err) {
      console.error('Error deleting category:', err);
      setDeleteDialog(false);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  // Bulk selection handlers - optimized with useCallback for memoized row components
  const toggleCategorySelection = useCallback((categoryId: number) => {
    setSelectedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  }, []);

  const selectAllCategories = useCallback(() => {
    setSelectedCategories(filteredCategories.map(c => c.id));
  }, [filteredCategories]);

  const deselectAllCategories = useCallback(() => {
    setSelectedCategories([]);
  }, []);

  // Memoized set of selected category IDs for O(1) lookup
  const selectedCategoriesSet = useMemo(() => new Set(selectedCategories), [selectedCategories]);

  const handleBulkDelete = () => {
    if (selectedCategories.length === 0) return;
    setBulkDeleteDialog(true);
  };

  const confirmBulkDelete = async () => {
    if (selectedCategories.length === 0) return;
    
    try {
      let successCount = 0;
      let errorCount = 0;
      
      for (const categoryId of selectedCategories) {
        try {
          await deleteCategoryMutation.mutateAsync(categoryId);
          successCount++;
        } catch {
          errorCount++;
        }
      }
      
      setBulkDeleteDialog(false);
      setSelectedCategories([]);
      
      if (errorCount > 0) {
        setSuccessMessage(`Deleted ${successCount} categories. ${errorCount} failed.`);
      } else {
        setSuccessMessage(`Successfully deleted ${successCount} categories!`);
      }
      setSuccessDialog(true);
    } catch (err) {
      console.error('Error during bulk delete:', err);
      setBulkDeleteDialog(false);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  // Sync handler
  const handleSync = async () => {
    // Open sync dialog to let user select a channel
    setSyncDialog(true);
  };

  const handleConfirmSync = async () => {
    if (!selectedSyncChannel) {
      setErrorMessage('Please select a sales channel to sync from.');
      setErrorDialog(true);
      return;
    }

    try {
      await syncMutation.mutateAsync(Number(selectedSyncChannel));
      setSuccessMessage('Categories synchronized successfully from WooCommerce!');
      setSuccessDialog(true);
      setSyncDialog(false);
      setSelectedSyncChannel('');
    } catch (err) {
      console.error('Error syncing categories:', err);
      setSyncDialog(false);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  // Preview categories from WooCommerce (without saving)
  const handlePreviewCategories = async () => {
    if (!selectedSyncChannel) {
      setErrorMessage('Please select a sales channel first.');
      setErrorDialog(true);
      return;
    }

    try {
      const data = await previewMutation.mutateAsync(Number(selectedSyncChannel));
      setPreviewData(data);
      setSelectedWcCategories([]);
      setSyncDialog(false);
      setPreviewDialog(true);
    } catch (err) {
      console.error('Error fetching WooCommerce categories:', err);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  // Toggle category selection for sync
  const toggleWcCategorySelection = (wcId: number) => {
    setSelectedWcCategories(prev => 
      prev.includes(wcId) 
        ? prev.filter(id => id !== wcId)
        : [...prev, wcId]
    );
  };

  // Select all categories
  const selectAllWcCategories = () => {
    if (previewData) {
      setSelectedWcCategories(previewData.categories.map((c: any) => c.wc_id));
    }
  };

  // Deselect all categories
  const deselectAllWcCategories = () => {
    setSelectedWcCategories([]);
  };

  // Sync selected categories only
  const handleSyncSelected = async () => {
    if (!previewData || selectedWcCategories.length === 0) {
      setErrorMessage('Please select at least one category to sync.');
      setErrorDialog(true);
      return;
    }

    try {
      const result = await syncSelectedMutation.mutateAsync({
        salesChannelId: previewData.sales_channel,
        wcCategoryIds: selectedWcCategories,
      });
      setSuccessMessage(
        `Sync complete! Created: ${result.created || 0}, Updated: ${result.updated || 0}`
      );
      setSuccessDialog(true);
      setPreviewDialog(false);
      setPreviewData(null);
      setSelectedWcCategories([]);
    } catch (err) {
      console.error('Error syncing selected categories:', err);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  // Sync all categories from preview
  const handleSyncAllFromPreview = async () => {
    if (!previewData) return;

    try {
      await syncMutation.mutateAsync(previewData.sales_channel);
      setSuccessMessage('All categories synchronized successfully!');
      setSuccessDialog(true);
      setPreviewDialog(false);
      setPreviewData(null);
      setSelectedWcCategories([]);
    } catch (err) {
      console.error('Error syncing all categories:', err);
      setErrorMessage(extractErrorMessage(err));
      setErrorDialog(true);
    }
  };

  // Get WooCommerce channels only
  const wooCommerceChannels = salesChannels.filter(ch => ch.channel_type === 'WOOCOMMERCE');

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-l-text-2 dark:text-d-text-2">Loading categories...</p>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="p-8 max-w-md text-center">
          <p className="text-red-500">{fetchError instanceof Error ? fetchError.message : 'Failed to load categories'}</p>
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
            <h1 className="text-3xl font-bold tracking-tight">Categories Manager</h1>
            <p className="text-l-text-2 dark:text-d-text-2 mt-2">
              Manage categories synced from WooCommerce
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleAdd} className="gap-2">
              <Plus className="size-4" />
              Add Category
            </Button>
            <Button onClick={handleSync} variant="outline" className="gap-2">
              <RefreshCw className="size-4" />
              Sync with WooCommerce
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
                placeholder="Search by name, slug, or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Sales Channel Filter */}
            {isSuperAdmin && salesChannels.length > 0 && (
              <Select value={salesChannelFilter} onValueChange={setSalesChannelFilter}>
                <SelectTrigger className="w-full md:w-[200px]">
                  <Store className="size-4 mr-2" />
                  <SelectValue placeholder="Sales Channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Channels</SelectItem>
                  {salesChannels.map((channel) => (
                    <SelectItem key={channel.id} value={String(channel.id)}>
                      {channel.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Parent Filter */}
            <Select value={parentFilter} onValueChange={setParentFilter}>
              <SelectTrigger className="w-full md:w-[180px]">
                <Layers className="size-4 mr-2" />
                <SelectValue placeholder="Hierarchy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="root">Root Categories</SelectItem>
                {parentCategories.map((cat) => (
                  <SelectItem key={cat.id} value={String(cat.id)}>
                    Children of: {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-4 flex items-center gap-2 text-sm text-l-text-2 dark:text-d-text-2">
            <span>Showing {filteredCategories.length} of {categories.length} categories</span>
          </div>
        </Card>

        {/* Bulk Action Bar */}
        {/* Animated Bulk Action Bar */}
        <div className={`overflow-hidden transition-all duration-300 ease-out ${selectedCategories.length > 0 ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0'}`}>
          <Card className="p-4 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-primary/30 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">{selectedCategories.length}</span>
                </div>
                <span className="font-medium">
                  categor{selectedCategories.length > 1 ? 'ies' : 'y'} selected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={deselectAllCategories}
                  className="text-l-text-2 dark:text-d-text-2 hover:text-l-text-1 dark:hover:text-d-text-1"
                >
                  Clear Selection
                </Button>
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={handleBulkDelete}
                  className="gap-2 shadow-sm"
                >
                  <Trash2 className="size-4" />
                  Delete ({selectedCategories.length})
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Categories Table */}
      <Card className="overflow-hidden border-l-border dark:border-d-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-l-bg-2/50 dark:bg-d-bg-2/50 hover:bg-l-bg-2/50 dark:hover:bg-d-bg-2/50">
              <TableHead className="w-12">
                <div className="flex items-center justify-center">
                  <Checkbox 
                    checked={selectedCategories.length === filteredCategories.length && filteredCategories.length > 0}
                    onCheckedChange={(checked) => {
                      if (checked) selectAllCategories();
                      else deselectAllCategories();
                    }}
                  />
                </div>
              </TableHead>
              <TableHead className="font-semibold">Category</TableHead>
              <TableHead className="font-semibold">Channel</TableHead>
              <TableHead className="font-semibold">Parent</TableHead>
              <TableHead className="font-semibold">Products</TableHead>
              <TableHead className="font-semibold">Children</TableHead>
              <TableHead className="font-semibold">Order</TableHead>
              <TableHead className="text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCategories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-l-text-2 dark:text-d-text-2">
                  <div className="flex flex-col items-center gap-3">
                    <FolderTree className="size-10 text-l-text-3 dark:text-d-text-3" />
                    <p>No categories found</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredCategories.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  isSelected={selectedCategoriesSet.has(category.id)}
                  selectionMode={selectionMode}
                  onToggleSelection={toggleCategorySelection}
                  onView={handleView}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* View Category Dialog */}
      <Dialog open={viewDialog} onOpenChange={setViewDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="pb-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <FolderTree className="size-5 text-primary" />
              Category Details
            </DialogTitle>
            <DialogDescription>View complete category information</DialogDescription>
          </DialogHeader>

          {selectedCategory && (
            <div className="flex-1 overflow-y-auto space-y-6 py-4">
              {/* Hero Section */}
              <div className="flex gap-6 p-4 bg-gradient-to-r from-l-bg-2 to-transparent dark:from-d-bg-2 dark:to-transparent rounded-xl">
                <div className="size-24 rounded-xl overflow-hidden bg-white dark:bg-d-bg-3 flex items-center justify-center border-2 border-l-border dark:border-d-border flex-shrink-0 shadow-sm">
                  {selectedCategory.image_url ? (
                    <img 
                      src={getMediaUrl(selectedCategory.image_url) || ''}
                      alt={selectedCategory.name}
                      className="size-full object-cover"
                    />
                  ) : (
                    <FolderTree className="size-10 text-l-text-3 dark:text-d-text-3" />
                  )}
                </div>
                <div className="flex-1 space-y-3">
                  <h3 className="text-xl font-bold leading-tight">{selectedCategory.name}</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono">/{selectedCategory.slug}</Badge>
                    <Badge variant="secondary" className="gap-1">
                      <Store className="size-3" />
                      {selectedCategory.sales_channel_name}
                    </Badge>
                  </div>
                  {selectedCategory.brand_name && (
                    <div className="flex items-center gap-2 text-sm text-l-text-2 dark:text-d-text-2">
                      <Tag className="size-4" />
                      <span>{selectedCategory.brand_name}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              {selectedCategory.description && (
                <div className="space-y-2">
                  <h4 className="font-semibold flex items-center gap-2 text-sm text-l-text-2 dark:text-d-text-2">
                    <FileText className="size-4" />
                    Description
                  </h4>
                  <p className="text-sm text-l-text-2 dark:text-d-text-2 bg-l-bg-2/50 dark:bg-d-bg-2/50 p-3 rounded-lg">
                    {selectedCategory.description}
                  </p>
                </div>
              )}

              {/* Info Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-l-bg-2/50 dark:bg-d-bg-2/50 space-y-1">
                  <p className="text-xs text-l-text-3 dark:text-d-text-3 uppercase tracking-wide">WC ID</p>
                  <p className="font-semibold text-primary">#{selectedCategory.wc_category_id}</p>
                </div>
                <div className="p-3 rounded-lg bg-l-bg-2/50 dark:bg-d-bg-2/50 space-y-1">
                  <p className="text-xs text-l-text-3 dark:text-d-text-3 uppercase tracking-wide">Order</p>
                  <p className="font-semibold">{selectedCategory.display_order}</p>
                </div>
                <div className="p-3 rounded-lg bg-l-bg-2/50 dark:bg-d-bg-2/50 space-y-1">
                  <p className="text-xs text-l-text-3 dark:text-d-text-3 uppercase tracking-wide">Parent</p>
                  <p className="font-medium truncate">{selectedCategory.parent_name || 'Root'}</p>
                </div>
                <div className="p-3 rounded-lg bg-l-bg-2/50 dark:bg-d-bg-2/50 space-y-1">
                  <p className="text-xs text-l-text-3 dark:text-d-text-3 uppercase tracking-wide">Company</p>
                  <p className="font-medium truncate">{selectedCategory.company_name}</p>
                </div>
              </div>

              {/* Statistics Section */}
              <div className="space-y-3">
                <h4 className="font-semibold flex items-center gap-2 text-sm text-l-text-2 dark:text-d-text-2">
                  <Layers className="size-4" />
                  Statistics
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 bg-primary/5 rounded-xl text-center border border-primary/20">
                    <Package className="size-6 text-primary mx-auto mb-2" />
                    <p className="text-xs text-l-text-3 dark:text-d-text-3 mb-1">Products</p>
                    <p className="text-2xl font-bold text-primary">{selectedCategory.products_count}</p>
                  </div>
                  <div className="p-4 bg-l-bg-2 dark:bg-d-bg-2 rounded-xl text-center border border-l-border dark:border-d-border">
                    <FolderTree className="size-6 text-l-text-2 dark:text-d-text-2 mx-auto mb-2" />
                    <p className="text-xs text-l-text-3 dark:text-d-text-3 mb-1">Subcategories</p>
                    <p className="text-2xl font-bold">{selectedCategory.children_count}</p>
                  </div>
                </div>
              </div>

              {/* Timestamps */}
              <div className="flex items-center justify-between text-xs text-l-text-3 dark:text-d-text-3 pt-4 border-t">
                <div className="flex items-center gap-1.5">
                  <Calendar className="size-3.5" />
                  <span>Created: {new Date(selectedCategory.created_at).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Calendar className="size-3.5" />
                  <span>Updated: {new Date(selectedCategory.updated_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          {selectedCategory && (
            <div className="flex gap-3 pt-4 border-t mt-auto">
              <Button onClick={() => { setViewDialog(false); handleEdit(selectedCategory); }} className="flex-1 gap-2">
                <Pencil className="size-4" />
                Edit Category
              </Button>
              <Button variant="outline" onClick={() => setViewDialog(false)} className="flex-1">
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Category Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="pb-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <Plus className="size-5 text-primary" />
              Add New Category
            </DialogTitle>
            <DialogDescription>Create a new category in the system</DialogDescription>
          </DialogHeader>
          <div className="flex-1 space-y-4 max-h-[65vh] overflow-y-auto pr-2 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-name">Category Name *</Label>
              <div className="relative">
                <Type className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                <Input
                  id="add-name"
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="pl-10"
                  placeholder="Enter category name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="add-slug">Slug</Label>
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                <Input
                  id="add-slug"
                  value={formData.slug}
                  onChange={(e) => handleFormChange('slug', e.target.value)}
                  className="pl-10"
                  placeholder="category-slug"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Sales Channel *</Label>
              <Select value={formData.sales_channel} onValueChange={(v) => handleFormChange('sales_channel', v)}>
                <SelectTrigger>
                  <Store className="size-4 mr-2" />
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  {salesChannels.map((ch) => (
                    <SelectItem key={ch.id} value={String(ch.id)}>{ch.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Parent Category</Label>
              <Select value={formData.parent} onValueChange={(v) => handleFormChange('parent', v)}>
                <SelectTrigger>
                  <Layers className="size-4 mr-2" />
                  <SelectValue placeholder="None (Root)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Root)</SelectItem>
                  {categories.filter(c => !formData.id || c.id !== formData.id).map((cat) => (
                    <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="add-order">Display Order</Label>
              <div className="relative">
                <ListOrdered className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                <Input
                  id="add-order"
                  type="number"
                  value={formData.display_order}
                  onChange={(e) => handleFormChange('display_order', Number(e.target.value))}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="add-image">Image URL</Label>
              <div className="relative">
                <ImageIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                <Input
                  id="add-image"
                  value={formData.image_url}
                  onChange={(e) => handleFormChange('image_url', e.target.value)}
                  className="pl-10"
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="add-description">Description</Label>
              <div className="relative">
                <FileText className="absolute left-3 top-3 size-4 text-l-text-3 dark:text-d-text-3" />
                <Textarea
                  id="add-description"
                  value={formData.description}
                  onChange={(e) => handleFormChange('description', e.target.value)}
                  className="pl-10 min-h-[80px]"
                  placeholder="Category description..."
                />
              </div>
            </div>
          </div>
          <div className="flex gap-3 pt-4 border-t">
            <Button onClick={handleAddCategory} disabled={createCategoryMutation.isPending} className="flex-1 gap-2">
              <Plus className="size-4" />
              {createCategoryMutation.isPending ? 'Creating...' : 'Create Category'}
            </Button>
            <Button variant="outline" onClick={() => setAddDialog(false)} className="flex-1">
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Category Dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogDescription>Update category information</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Category Name *</Label>
              <div className="relative">
                <Type className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                <Input
                  id="edit-name"
                  value={formData.name}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                  className="pl-10"
                  placeholder="Enter category name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-slug">Slug</Label>
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                <Input
                  id="edit-slug"
                  value={formData.slug}
                  onChange={(e) => handleFormChange('slug', e.target.value)}
                  className="pl-10"
                  placeholder="category-slug"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Parent Category</Label>
              <Select value={formData.parent} onValueChange={(v) => handleFormChange('parent', v)}>
                <SelectTrigger>
                  <Layers className="size-4 mr-2" />
                  <SelectValue placeholder="None (Root)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Root)</SelectItem>
                  {categories.filter(c => c.id !== formData.id).map((cat) => (
                    <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-order">Display Order</Label>
              <div className="relative">
                <ListOrdered className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                <Input
                  id="edit-order"
                  type="number"
                  value={formData.display_order}
                  onChange={(e) => handleFormChange('display_order', Number(e.target.value))}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-image">Image URL</Label>
              <div className="relative">
                <ImageIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-l-text-3 dark:text-d-text-3" />
                <Input
                  id="edit-image"
                  value={formData.image_url}
                  onChange={(e) => handleFormChange('image_url', e.target.value)}
                  className="pl-10"
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <div className="relative">
                <FileText className="absolute left-3 top-3 size-4 text-l-text-3 dark:text-d-text-3" />
                <Textarea
                  id="edit-description"
                  value={formData.description}
                  onChange={(e) => handleFormChange('description', e.target.value)}
                  className="pl-10 min-h-[80px]"
                  placeholder="Category description..."
                />
              </div>
            </div>
          </div>
          <div className="flex gap-3 pt-4 border-t">
            <Button onClick={handleSaveEdit} disabled={updateCategoryMutation.isPending} className="flex-1 gap-2">
              <Pencil className="size-4" />
              {updateCategoryMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button variant="outline" onClick={() => setEditDialog(false)} className="flex-1">
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="size-5" />
              Delete Category
            </AlertDialogTitle>
            <AlertDialogDescription className="pt-2">
              Are you sure you want to delete <strong className="text-foreground">{categoryToDelete?.name}</strong>?
              <br />
              <span className="text-red-500 text-sm">This action cannot be undone.</span>
              {categoryToDelete && categoryToDelete.children_count > 0 && (
                <span className="block mt-3 p-2 bg-amber-50 dark:bg-amber-950/30 rounded border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm">
                  ⚠️ This category has {categoryToDelete.children_count} subcategories that may be affected.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700 gap-2"
            >
              <Trash2 className="size-4" />
              Delete Category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialog} onOpenChange={setBulkDeleteDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="size-5" />
              Delete {selectedCategories.length} Categories
            </AlertDialogTitle>
            <AlertDialogDescription className="pt-2">
              Are you sure you want to delete <strong className="text-foreground">{selectedCategories.length}</strong> selected categories?
              <br />
              <span className="text-red-500 text-sm">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmBulkDelete} 
              className="bg-red-600 hover:bg-red-700 gap-2"
            >
              <Trash2 className="size-4" />
              Delete ({selectedCategories.length})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Success Dialog */}
      <AlertDialog open={successDialog} onOpenChange={setSuccessDialog}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <div className="mx-auto size-14 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center mb-3">
              <Check className="size-7 text-green-600" />
            </div>
            <AlertDialogTitle className="text-center text-green-600 dark:text-green-500">
              Success!
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              {successMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="justify-center sm:justify-center">
            <AlertDialogAction onClick={() => setSuccessDialog(false)} className="min-w-24">
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

      {/* Sync with WooCommerce Dialog */}
      <Dialog open={syncDialog} onOpenChange={setSyncDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="size-5" />
              Sync Categories from WooCommerce
            </DialogTitle>
            <DialogDescription>
              Select the WooCommerce sales channel to sync categories from
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {wooCommerceChannels.length === 0 ? (
              <div className="text-center py-8">
                <Globe className="size-12 mx-auto text-l-text-3 dark:text-d-text-3 mb-4" />
                <p className="text-l-text-2 dark:text-d-text-2">No WooCommerce channels available</p>
                <p className="text-sm text-l-text-3 dark:text-d-text-3 mt-2">
                  Please create a WooCommerce sales channel first
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Select WooCommerce Store</Label>
                  <Select value={selectedSyncChannel} onValueChange={setSelectedSyncChannel}>
                    <SelectTrigger>
                      <Store className="size-4 mr-2" />
                      <SelectValue placeholder="Select a store to sync from" />
                    </SelectTrigger>
                    <SelectContent>
                      {wooCommerceChannels.map((channel) => (
                        <SelectItem key={channel.id} value={String(channel.id)}>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{channel.name}</span>
                              <Badge variant="outline" className="text-xs">{channel.brand_name}</Badge>
                            </div>
                            {channel.wc_store_url && (
                              <span className="text-xs text-l-text-3 dark:text-d-text-3">
                                {channel.wc_store_url}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedSyncChannel && (
                  <div className="p-4 bg-l-bg-2 dark:bg-d-bg-2 rounded-lg space-y-2">
                    <div className="flex items-center gap-2">
                      <FolderTree className="size-4 text-primary" />
                      <span className="text-sm font-medium">Brand:</span>
                      <Badge>{wooCommerceChannels.find(ch => String(ch.id) === selectedSyncChannel)?.brand_name}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Store className="size-4 text-primary" />
                      <span className="text-sm font-medium">Store:</span>
                      <span className="text-sm">{wooCommerceChannels.find(ch => String(ch.id) === selectedSyncChannel)?.name}</span>
                    </div>
                    {wooCommerceChannels.find(ch => String(ch.id) === selectedSyncChannel)?.wc_store_url && (
                      <div className="flex items-center gap-2">
                        <Globe className="size-4 text-primary" />
                        <span className="text-sm font-medium">URL:</span>
                        <span className="text-xs text-l-text-3 dark:text-d-text-3">
                          {wooCommerceChannels.find(ch => String(ch.id) === selectedSyncChannel)?.wc_store_url}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex flex-col gap-3 pt-2 border-t">
            <div className="flex gap-3">
              <Button 
                onClick={handlePreviewCategories} 
                disabled={previewMutation.isPending || !selectedSyncChannel || wooCommerceChannels.length === 0}
                variant="outline"
                className="flex-1 gap-2"
              >
                <Eye className={`size-4 ${previewMutation.isPending ? 'animate-pulse' : ''}`} />
                {previewMutation.isPending ? 'Loading...' : 'Preview & Select'}
              </Button>
              <Button 
                onClick={handleConfirmSync} 
                disabled={syncMutation.isPending || !selectedSyncChannel || wooCommerceChannels.length === 0}
                className="flex-1 gap-2"
              >
                <RefreshCw className={`size-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                {syncMutation.isPending ? 'Syncing...' : 'Sync All'}
              </Button>
            </div>
            <Button variant="ghost" onClick={() => { setSyncDialog(false); setSelectedSyncChannel(''); }} className="w-full">
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* WooCommerce Categories Preview Dialog */}
      <Dialog open={previewDialog} onOpenChange={setPreviewDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderTree className="size-5" />
              WooCommerce Categories - {previewData?.sales_channel_name}
            </DialogTitle>
            <DialogDescription>
              Select categories to sync from WooCommerce. Categories marked "Exists" will be updated.
            </DialogDescription>
          </DialogHeader>
          
          {previewData && (
            <>
              {/* Stats */}
              <div className="flex gap-4 py-2">
                <Badge variant="outline" className="gap-1">
                  Total: {previewData.total_count}
                </Badge>
                <Badge variant="default" className="gap-1 bg-green-600">
                  New: {previewData.new_count}
                </Badge>
                <Badge variant="secondary" className="gap-1">
                  Existing: {previewData.existing_count}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  Selected: {selectedWcCategories.length}
                </Badge>
              </div>

              {/* Selection controls */}
              <div className="flex gap-2 pb-2">
                <Button variant="outline" size="sm" onClick={selectAllWcCategories}>
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAllWcCategories}>
                  Deselect All
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setSelectedWcCategories(previewData.categories.filter((c: any) => !c.exists_locally).map((c: any) => c.wc_id))}
                >
                  Select New Only
                </Button>
              </div>

              {/* Categories list */}
              <div className="h-[400px] overflow-auto border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox 
                          checked={selectedWcCategories.length === previewData.categories.length}
                          onCheckedChange={(checked) => {
                            if (checked) selectAllWcCategories();
                            else deselectAllWcCategories();
                          }}
                        />
                      </TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Slug</TableHead>
                      <TableHead>Products</TableHead>
                      <TableHead>Parent</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.categories.map((category: any) => (
                      <TableRow 
                        key={category.wc_id}
                        className={selectedWcCategories.includes(category.wc_id) ? 'bg-primary/10' : ''}
                      >
                        <TableCell>
                          <Checkbox 
                            checked={selectedWcCategories.includes(category.wc_id)}
                            onCheckedChange={() => toggleWcCategorySelection(category.wc_id)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {category.image ? (
                              <img 
                                src={getMediaUrl(category.image) || ''}
                                alt={category.name}
                                className="size-10 object-cover rounded"
                              />
                            ) : (
                              <div className="size-10 bg-l-bg-2 dark:bg-d-bg-2 rounded flex items-center justify-center">
                                <FolderTree className="size-5 text-l-text-3 dark:text-d-text-3" />
                              </div>
                            )}
                            <div>
                              <p className="font-medium">{category.name}</p>
                              {category.description && (
                                <p className="text-xs text-l-text-3 dark:text-d-text-3 line-clamp-1">
                                  {/* Strip HTML tags */}
                                  {category.description.split(/<[^>]*>/).join('')}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-l-text-2 dark:text-d-text-2">
                          {category.slug}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{category.count}</Badge>
                        </TableCell>
                        <TableCell>
                          {category.parent_id > 0 ? (
                            <Badge variant="secondary">
                              {previewData.categories.find((c: any) => c.wc_id === category.parent_id)?.name || `#${category.parent_id}`}
                            </Badge>
                          ) : (
                            <span className="text-sm text-l-text-3 dark:text-d-text-3">Root</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {category.exists_locally ? (
                            <Badge variant="secondary" className="text-xs">Exists</Badge>
                          ) : (
                            <Badge variant="default" className="text-xs bg-green-600">New</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button 
                  onClick={handleSyncSelected}
                  disabled={syncSelectedMutation.isPending || selectedWcCategories.length === 0}
                  className="flex-1 gap-2"
                >
                  <RefreshCw className={`size-4 ${syncSelectedMutation.isPending ? 'animate-spin' : ''}`} />
                  {syncSelectedMutation.isPending ? 'Syncing...' : `Sync Selected (${selectedWcCategories.length})`}
                </Button>
                <Button 
                  onClick={handleSyncAllFromPreview}
                  disabled={syncMutation.isPending}
                  variant="outline"
                  className="flex-1 gap-2"
                >
                  <RefreshCw className={`size-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                  Sync All ({previewData.total_count})
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => { setPreviewDialog(false); setPreviewData(null); setSelectedWcCategories([]); }}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
