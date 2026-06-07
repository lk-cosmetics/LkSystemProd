// Common TypeScript type definitions

// API Response Types
export interface ApiResponse<T = unknown> {
  data: T;
  message?: string;
  status: 'success' | 'error';
  timestamp?: string;
}

export interface ApiError {
  message: string;
  code: string | number;
  details?: Record<string, unknown>;
}

// Common UI Props
export interface BaseComponentProps {
  className?: string;
  children?: React.ReactNode;
  id?: string;
  'data-testid'?: string;
}

// Theme Types
export type Theme = 'light' | 'dark' | 'system';

// Form Types
export interface FormFieldError {
  message: string;
  type: string;
}

export interface FormState {
  isSubmitting: boolean;
  isValid: boolean;
  errors: Record<string, FormFieldError>;
}

// Navigation Types
export interface NavItem {
  label: string;
  href: string;
  icon?: React.ComponentType;
  isActive?: boolean;
  isExternal?: boolean;
}

// Toast Types
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

// Storage Types
export interface StorageError {
  message: string;
  key: string;
  operation: 'read' | 'write' | 'delete';
}

export type StorageHookReturn<T> = [
  value: T,
  setValue: (value: T | ((prevValue: T) => T)) => void,
  removeValue: () => void,
];

export type SecureStorageHookReturn = [
  value: string,
  setValue: (value: string) => Promise<void>,
  removeValue: () => void,
  isLoading: boolean,
  error: Error | null,
];

// Generic utility types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Authentication Types
export interface User {
  id: number | string;
  matricule: string;
  email: string;
  full_name: string;
  role: string;
  roles: string[];
  can_switch_brands?: boolean;
  company_id?: number;
  /** Name of the active company, for the workspace indicator in the UI. */
  company_name?: string | null;
  /** Active company logo (media URL); drives the dynamic sidebar logo. */
  company_logo?: string | null;
  /** Active brand workspace; null/undefined means whole-company focus. */
  current_brand_id?: number | null;
  allowed_brand_ids?: number[];
  /** RBAC permission codenames (e.g. 'view_products', 'create_orders', 'use_pos'). */
  permissions: string[];
  /** True only for the Django superuser (platform owner). Single root bypass. */
  is_superuser?: boolean;
  // Computed properties for backwards compatibility
  firstName?: string;
  lastName?: string;
}

// User Profile Types
export interface UserProfile {
  id?: number;
  phone: string | null;
  birth_date: string | null;
  gender: 'M' | 'F' | null;
  gender_display?: string | null;
  nationality: string | null;
  city: string | null;
  address?: string | null;
  cin_number?: string | null;
  cin_front?: string | null;
  cin_back?: string | null;
  passport_number?: string | null;
  passport_image?: string | null;
  emergency_phone?: string | null;
  avatar?: string | null;
  education_level?: string | null;
  education_level_display?: string | null;
  diploma_title?: string | null;
  diploma_file?: string | null;
  is_complete: boolean;
  completion_percentage: number;
}

export interface UserDetails {
  id: number;
  matricule: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role_name: string | null;
  can_switch_brands: boolean;
  current_company: number | null;
  company_name: string | null;
  allowed_brands: number[];
  allowed_brand_names: string[];
  assigned_sales_channel?: number | null;
  assigned_sales_channel_name?: string | null;
  is_active: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
  profile: UserProfile | null;
  date_joined: string;
  last_login?: string | null;
}

export interface UpdateUserRequest {
  email?: string;
  first_name?: string;
  last_name?: string;
  profile?: Partial<{
    phone: string;
    birth_date: string;
    gender: 'M' | 'F';
    nationality: string;
    city: string;
  }>;
}

export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
  new_password_confirm: string;
}

export interface ChangePasswordResponse {
  detail: string;
  changed_by: 'self' | 'superadmin' | 'ceo' | 'manager';
  email_notification_sent: boolean;
}

export interface LoginRequest {
  matricule: string;
  password: string;
}

// Password Reset Types
export interface ForgotPasswordRequest {
  email: string;
}

export interface ForgotPasswordResponse {
  message: string;
  detail?: string;
}

export interface ValidateResetTokenRequest {
  token: string;
  email: string;
}

export interface ValidateResetTokenResponse {
  valid: boolean;
  email?: string;
  message?: string;
}

export interface ResetPasswordRequest {
  token: string;
  email: string;
  new_password: string;
  new_password_confirm: string;
}

export interface ResetPasswordResponse {
  message: string;
  detail?: string;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: User;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  switchWorkspace: (companyId: number | null, brandId: number | null) => Promise<void>;
  /** Re-fetch the caller's identity (fresh roles/permissions) without re-login. */
  refreshUser: () => Promise<void>;
  clearError: () => void;
}

export interface TokenRefreshResponse {
  access: string;
  refresh?: string; // Some backends return new refresh token with each refresh
}

// Company Types
/**
 * Lightweight company data returned by the list endpoint
 * (GET /api/v1/company/) via CompanyListSerializer.
 */
export interface CompanyListItem {
  id: number;
  name: string;
  abbreviation: string;
  logo: string | null;
  city: string;
  is_active: boolean;
  brands_count?: number;
}

/**
 * Full company data returned by detail/create/update endpoints
 * (GET /api/v1/company/{id}/) via CompanyDetailSerializer.
 */
export interface Company extends CompanyListItem {
  legal_name: string;
  email: string;
  phone: string;
  address?: string;
  matricule_fiscale?: string;
  registre_commerce?: string;
  activity_code?: string;
  bank_name?: string;
  rib?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCompanyRequest {
  name: string;
  legal_name: string;
  abbreviation: string;
  email: string;
  phone: string;
  address?: string;
  city: string;
  matricule_fiscale?: string;
  registre_commerce?: string;
  activity_code?: string;
  bank_name?: string;
  rib?: string;
  is_active?: boolean;
  logo?: File | null;
}

// Paginated Response Type (Django REST Framework)
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// Sales Channel Types
export type ChannelType = 'WOOCOMMERCE' | 'POS' | 'WEB';

export interface SalesChannel {
  id: number;
  brand: number;
  brand_name: string;
  brand_logo: string | null;
  company_id: number;
  company_name: string;
  name: string;
  code: string | null;
  channel_type: ChannelType;
  channel_type_display: string;
  store_type: StoreType;
  store_type_display?: string;
  is_active: boolean;
  is_default: boolean;
  address: string;
  city: string;
  state: string;
  delivery_api_key: string;
  phone: string;
  email: string;
  wc_store_url: string;
  wc_consumer_key: string;
  wc_consumer_secret: string;
  wc_webhook_token: string;
  wc_push_status_enabled: boolean;
  created_at: string;
  updated_at: string;
}

// Simplified SalesChannel for Brand response
export interface BrandSalesChannel {
  id: number;
  name: string;
  channel_type: ChannelType;
}

export interface CreateSalesChannelRequest {
  brand: number;
  name: string;
  code?: string | null;
  channel_type: ChannelType;
  store_type?: StoreType;
  is_active?: boolean;
  is_default?: boolean;
  address?: string;
  city?: string;
  state?: string;
  delivery_api_key?: string;
  phone?: string;
  email?: string;
  wc_store_url?: string;
  wc_consumer_key?: string;
  wc_consumer_secret?: string;
  wc_push_status_enabled?: boolean;
}

export interface GenerateCredentialsResponse {
  message: string;
  webhook_token: string;
  channel_id: number;
  channel_name: string;
  usage_hint?: string;
}

// Brand Types
export interface Brand {
  id: number;
  company: number;
  company_name: string;
  name: string;
  logo: string | null;
  channels_count: number;
  sales_channels: BrandSalesChannel[];
  created_at: string;
  updated_at: string;
}

export interface CreateBrandRequest {
  company: number;
  name: string;
  logo?: File | null;
}

// Extended User Profile Types
export interface UserProfileFull {
  id: number;
  user: number;
  phone: string | null;
  emergency_phone: string | null;
  birth_date: string | null;
  gender: 'M' | 'F' | 'O' | null;
  nationality: string | null;
  address: string | null;
  city: string | null;
  cin_number: string | null;
  cin_front: string | null;
  cin_back: string | null;
  passport_number: string | null;
  passport_image: string | null;
  avatar: string | null;
  education_level: EducationLevel | null;
  diploma_title: string | null;
  diploma_file: string | null;
  is_complete: boolean;
  completion_percentage: number;
  created_at: string;
  updated_at: string;
}

export type EducationLevel =
  | 'NONE'
  | 'PRIMARY'
  | 'SECONDARY'
  | 'BAC'
  | 'LICENSE'
  | 'MASTER'
  | 'DOCTORATE'
  | 'OTHER';

export const EDUCATION_LEVELS: { value: EducationLevel; label: string }[] = [
  { value: 'NONE', label: 'No Formal Education' },
  { value: 'PRIMARY', label: 'Primary School' },
  { value: 'SECONDARY', label: 'Secondary School' },
  { value: 'BAC', label: 'Baccalaureate' },
  { value: 'LICENSE', label: 'License (Bachelor)' },
  { value: 'MASTER', label: "Master's Degree" },
  { value: 'DOCTORATE', label: 'Doctorate (PhD)' },
  { value: 'OTHER', label: 'Other' },
];

export interface UpdateProfileRequest {
  phone?: string;
  emergency_phone?: string;
  birth_date?: string;
  gender?: 'M' | 'F' | 'O';
  nationality?: string;
  address?: string;
  city?: string;
  cin_number?: string;
  passport_number?: string;
  education_level?: EducationLevel;
  diploma_title?: string;
}

// User with full details for listing/management
export interface UserListItem {
  id: number;
  matricule: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role_name: string | null;
  can_switch_brands: boolean;
  current_company: number | null;
  company_name: string | null;
  allowed_brands: number[];
  allowed_brand_names: string[];
  is_active: boolean;
  avatar: string | null;
  date_joined: string;
}

export interface CreateUserRequest {
  email: string;
  password: string;
  password_confirm: string;
  first_name: string;
  last_name: string;
  // Optional fields
  current_company?: number;
  allowed_brands?: number[];
  // Profile fields
  cin_number?: string;
  phone?: string;
  emergency_phone?: string;
  birth_date?: string;
  gender?: 'M' | 'F' | 'O';
  nationality?: string;
  city?: string;
  address?: string;
  education_level?: EducationLevel;
  diploma_title?: string;
}

export interface UpdateUserFullRequest {
  email?: string;
  first_name?: string;
  last_name?: string;
  current_company?: number | null;
  allowed_brands?: number[];
  /** Sales point for operational roles (Employee / Cashier); null to clear. */
  assigned_sales_channel?: number | null;
  can_switch_brands?: boolean;
  is_active?: boolean;
}

export interface AdminChangePasswordRequest {
  new_password: string;
  new_password_confirm: string;
}

// =============================================================================
// PRODUCT TYPES
// =============================================================================

// Canonical product/item taxonomy (kept in sync with the backend
// ``Product.ProductType`` enum):
//   resell_product  – normal product bought & resold (perfume, cosmetic, any WC product)
//   pack            – bundle/pack sold to customers (promo pack, gift pack)
//   component       – used only in BOM/manufacturing (bottle, cap, label, liquid, raw material)
//   packaging_item  – used only during order prep/delivery (shipping box, bag, thank-you card)
// ``resell_product`` and ``pack`` are the only sellable types (may appear on an order).
export type ProductType =
  | 'resell_product'
  | 'pack'
  | 'component'
  | 'packaging_item';

/** Product types that may appear on a customer order (WooCommerce / POS sale lines). */
export const SELLABLE_PRODUCT_TYPES: readonly ProductType[] = ['resell_product', 'pack'];
export type ProductStatus = 'publish' | 'draft' | 'pending' | 'private';

export interface PackItem {
  product_id: number;
  quantity: number;
}

export interface PackItemDetail {
  product_id: number;
  quantity: number;
  product_name: string;
  product_image: string;
  product_barcode: string;
}

export interface PackStockEntry {
  sales_channel_id: number;
  sales_channel_name: string;
  available_quantity: number;
}

export interface ProductListItem {
  id: number;
  wc_product_id: number | null;
  brand: number | null;
  brand_name: string | null;
  stock_total?: number;
  name: string;
  image_url: string;
  /** Locally-uploaded image URL (server media). Falls back to image_url when absent. */
  image?: string | null;
  product_link: string;
  barcode: string;
  product_type: ProductType;
  status: ProductStatus;
  purchase_price: string;
  sales_price: string;
  is_pack: boolean;
  pack_items: PackItem[] | null;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  deleted_at: string | null;
}

export interface Product extends ProductListItem {
  profit_margin: number | null;
  pack_items_detail: PackItemDetail[] | null;
  categories?: number[];
  category_names?: string[];
  stock_total?: number;
  stock_by_channel?: Array<{
    sales_channel_id: number;
    sales_channel_name: string;
    sales_channel_type: ChannelType | string;
    quantity: number;
    reserved_quantity: number;
    available_quantity: number;
    minimum_quantity: number;
    bin_location: string;
    updated_at: string | null;
  }>;
  last_synced_at: string | null;
  wc_date_created: string | null;
  wc_date_modified: string | null;
}

export interface POSProductStockSnapshot {
  inventory_id: number | null;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  updated_at: string | null;
}

export interface POSProductCacheItem extends ProductListItem {
  stock: POSProductStockSnapshot;
}

export interface POSProductCacheResponse {
  sales_channel: number;
  sales_channel_name: string;
  brand: number | null;
  brand_name: string | null;
  last_sync: string;
  products: POSProductCacheItem[];
}

export interface CreateProductRequest {
  name: string;
  barcode?: string;
  product_type?: ProductType;
  status?: ProductStatus;
  brand?: number;
  purchase_price?: string;
  sales_price?: string;
  image_url?: string;
  product_link?: string;
  is_pack?: boolean;
  pack_items?: PackItem[] | null;
}

export interface UpdateProductRequest {
  name?: string;
  barcode?: string;
  product_type?: ProductType;
  status?: ProductStatus;
  brand?: number | null;
  purchase_price?: string;
  sales_price?: string;
  image_url?: string;
  product_link?: string;
  is_pack?: boolean;
  pack_items?: PackItem[] | null;
}

// =============================================================================
// CATEGORY TYPES
// =============================================================================

export interface CategoryListItem {
  id: number;
  wc_category_id: number;
  sales_channel: number;
  sales_channel_name: string;
  brand_name: string;
  company_name: string;
  name: string;
  slug: string;
  description: string;
  parent: number | null;
  parent_name: string | null;
  image_url: string;
  display_order: number;
  children_count: number;
  products_count: number;
  created_at: string;
  updated_at: string;
}

export interface Category extends CategoryListItem {
  wc_parent_id: number | null;
  last_synced_at: string;
  created_by: number | null;
  updated_by: number | null;
}

export interface CategoryTree extends CategoryListItem {
  children: CategoryTree[];
}

export interface CreateCategoryRequest {
  wc_category_id: number;
  sales_channel: number;
  name: string;
  slug?: string;
  description?: string;
  parent?: number | null;
  wc_parent_id?: number | null;
  image_url?: string;
  display_order?: number;
}

export interface UpdateCategoryRequest {
  name?: string;
  slug?: string;
  description?: string;
  parent?: number | null;
  image_url?: string;
  display_order?: number;
}

// =============================================================================
// PROMOTION TYPES
// =============================================================================

export type PromotionStatus =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'expired'
  | 'cancelled';
export type DiscountType = 'percentage' | 'fixed';

export interface PromotionChannelRule {
  id: number;
  sales_channel: number;
  sales_channel_name: string;
  sales_channel_type: string;
  discount_value: string;
  is_enabled: boolean;
  channel_priority: number;
  channel_max_usage: number | null;
  channel_current_usage: number;
  created_at: string;
  updated_at: string;
}

export interface PromotionChannelRuleInput {
  sales_channel: number;
  discount_value: number | string;
  is_enabled?: boolean;
  channel_priority?: number;
  channel_max_usage?: number | null;
}

export interface PromotionListItem {
  id: number;
  name: string;
  code: string | null;
  product: number;
  product_name: string;
  product_image: string | null;
  brand: number | null;
  brand_name: string | null;
  company_id: number | null;
  company_name: string | null;
  discount_type: DiscountType;
  discount_type_display: string;
  default_discount_value: string;
  start_date: string;
  /** ISO timestamp. ``null`` means the promotion runs indefinitely. */
  end_date: string | null;
  status: PromotionStatus;
  status_display: string;
  is_active: boolean;
  is_currently_active: boolean;
  channel_count: number;
  priority: number;
  current_usage: number;
  max_usage: number | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Promotion extends PromotionListItem {
  description: string;
  product_sales_price: string;
  is_within_usage_limit: boolean;
  is_stackable: boolean;
  channel_rules: PromotionChannelRule[];
  updated_by: number | null;
  updated_by_name: string | null;
  // company_id / company_name already inherited from PromotionListItem
}

export interface CreatePromotionRequest {
  name: string;
  description?: string;
  code?: string | null;
  product: number;
  brand?: number | null;
  discount_type: DiscountType;
  default_discount_value: number | string;
  start_date?: string;
  end_date?: string | null;
  status?: PromotionStatus;
  is_active?: boolean;
  max_usage?: number | null;
  priority?: number;
  is_stackable?: boolean;
  channel_rules: PromotionChannelRuleInput[];
}

export interface UpdatePromotionRequest {
  name?: string;
  description?: string;
  code?: string | null;
  product?: number;
  brand?: number | null;
  discount_type?: DiscountType;
  default_discount_value?: number | string;
  start_date?: string;
  end_date?: string | null;
  status?: PromotionStatus;
  is_active?: boolean;
  max_usage?: number | null;
  priority?: number;
  is_stackable?: boolean;
  channel_rules?: PromotionChannelRuleInput[];
}

// ─────────────────────────────────────────────────────────────────────
// Promotion GROUP types — wizard-created siblings share a UUID and are
// surfaced as one row in the campaign list.
// ─────────────────────────────────────────────────────────────────────

export interface PromotionGroupMember {
  id: number;
  product: number;
  product_name: string;
  product_image: string | null;
  product_barcode: string | null;
  discount_type: DiscountType;
  discount_value: string;
  is_active: boolean;
  current_usage: number;
}

export interface PromotionGroupListItem {
  group_id: string;
  name: string;
  code: string | null;
  description: string;
  brand: number | null;
  brand_name: string | null;
  company_id: number | null;
  company_name: string | null;
  start_date: string;
  end_date: string | null;
  status: PromotionStatus;
  is_active: boolean;
  is_currently_active: boolean;
  is_stackable: boolean;
  priority: number;
  max_usage: number | null;
  product_count: number;
  channel_count: number;
  total_usage: number;
  discount_min: string | null;
  discount_max: string | null;
  discount_types: DiscountType[];
  created_at: string;
  updated_at: string;
}

export interface PromotionGroupChannel {
  id: number;
  name: string;
}

export interface PromotionGroupDetail extends Omit<PromotionGroupListItem,
  'product_count' | 'channel_count' | 'discount_min' | 'discount_max' | 'discount_types'
> {
  members: PromotionGroupMember[];
  sales_channel_ids: number[];
  /** Same channels as `sales_channel_ids` but with display names. */
  sales_channels: PromotionGroupChannel[];
}

export interface UpdatePromotionGroupItem {
  member_id?: number | null;
  product: number;
  discount_type: DiscountType;
  discount_value: number | string;
}

export interface UpdatePromotionGroupRequest {
  name: string;
  description?: string;
  code?: string | null;
  start_date: string;
  end_date?: string | null;
  status?: PromotionStatus;
  is_active?: boolean;
  is_stackable?: boolean;
  priority?: number;
  max_usage?: number | null;
  sales_channels: number[];
  items: UpdatePromotionGroupItem[];
}

export interface DiscountCalculationRequest {
  product_id: number;
  sales_channel_id: number;
  original_price?: number | string;
}

export interface DiscountCalculationResult {
  product_id: number;
  product_name: string;
  sales_channel_id: number;
  sales_channel_name: string;
  original_price: string;
  discount_value: string;
  discount_type: string;
  discounted_price: string;
  savings: string;
  promotion_id: number;
  promotion_name: string;
}

export interface PromotionAnalytics {
  total_promotions: number;
  active_promotions: number;
  draft_promotions: number;
  expired_promotions: number;
  scheduled_promotions: number;
  total_usage: number;
  by_discount_type: Array<{ discount_type: DiscountType; count: number }>;
  by_status: Array<{ status: PromotionStatus; count: number }>;
}

// =============================================================================
// INVENTORY TYPES
// =============================================================================

// Sales Channel Store Type (Warehouse/Retail Location)
export type StoreType = 'WAREHOUSE' | 'RETAIL' | 'DISTRIBUTION';

// Sales Channel Inventory
export interface SalesChannelInventory {
  id: number;
  sales_channel: number;
  sales_channel_name: string;
  sales_channel_code: string | null;
  product: number;
  product_name: string;
  product_barcode: string;
  product_image: string | null;
  company_id: number;
  company_name: string;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  minimum_quantity: number;
  maximum_quantity: number | null;
  bin_location: string;
  is_low_stock: boolean;
  is_out_of_stock: boolean;
  last_counted_at: string | null;
  created_at: string;
  updated_at: string;
  recent_movements?: InventoryMovement[];
}

export interface CreateSalesChannelInventoryRequest {
  sales_channel: number;
  product: number;
  quantity?: number;
  reserved_quantity?: number;
  minimum_quantity?: number;
  maximum_quantity?: number | null;
  bin_location?: string;
}

export interface UpdateSalesChannelInventoryRequest {
  quantity?: number;
  reserved_quantity?: number;
  minimum_quantity?: number;
  maximum_quantity?: number | null;
  bin_location?: string;
}

export interface AdjustSalesChannelInventoryRequest {
  quantity_change: number;
  movement_type?: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';
  notes?: string;
}

// Inventory Movement
export type MovementType =
  | 'PURCHASE'
  | 'RETURN_IN'
  | 'TRANSFER_IN'
  | 'ADJUSTMENT_IN'
  | 'INITIAL'
  | 'SALE'
  | 'RETURN_OUT'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT_OUT'
  | 'DAMAGE'
  | 'SENT_TO_FACTORY'
  | 'PRODUCTION_IN'
  | 'RESERVATION'
  | 'RELEASE';

export type MovementStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';

export interface InventoryMovement {
  id: number;
  reference_number: string;
  sales_channel: number;
  sales_channel_name: string;
  sales_channel_code: string | null;
  product: number;
  product_name: string;
  product_barcode: string;
  movement_type: MovementType;
  movement_type_display: string;
  status: MovementStatus;
  status_display: string;
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  unit_cost: string | null;
  total_cost: string | null;
  destination_channel: number | null;
  destination_channel_name: string | null;
  external_reference: string;
  notes: string;
  is_stock_in: boolean;
  is_stock_out: boolean;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  completed_at: string | null;
  related_movement_ref?: string | null;
}

export interface CreateInventoryMovementRequest {
  sales_channel: number;
  product: number;
  movement_type: MovementType;
  quantity: number;
  unit_cost?: number | string;
  destination_channel?: number;
  external_reference?: string;
  notes?: string;
}

export interface CreateTransferRequest {
  source_channel: number;
  destination_channel: number;
  product: number;
  quantity: number;
  notes?: string;
}

export interface ProductInventorySummary {
  product_id: number;
  product_name: string;
  product_barcode: string;
  total_quantity: number;
  total_reserved: number;
  total_available: number;
  channels_count: number;
  channel_breakdown: SalesChannelInventory[];
}

export interface MovementSummary {
  total_movements: number;
  by_type: Array<{
    movement_type: MovementType;
    count: number;
    total_quantity: number;
  }>;
}

export interface BillOfMaterialsItem {
  id: number;
  component: number;
  component_name: string;
  component_barcode: string;
  quantity_per_unit: string;
  waste_percent: string;
  notes: string;
}

export interface BillOfMaterials {
  id: number;
  finished_product: number;
  finished_product_name: string;
  finished_product_barcode: string;
  company_id: number;
  name: string;
  version: number;
  is_active: boolean;
  items_count: number;
  notes: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  items?: BillOfMaterialsItem[];
}

export interface CreateBillOfMaterialsRequest {
  finished_product: number;
  name?: string;
  version?: number;
  is_active?: boolean;
  notes?: string;
  items: Array<{
    component: number;
    quantity_per_unit: number | string;
    waste_percent?: number | string;
    notes?: string;
  }>;
}

export type UpdateBillOfMaterialsRequest = Partial<CreateBillOfMaterialsRequest>;

export type ProductionBatchStatus =
  | 'DRAFT'
  | 'SENT_TO_FACTORY'
  | 'PARTIALLY_RECEIVED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface ProductionBatchComponent {
  id: number;
  component: number;
  component_name: string;
  component_barcode: string;
  quantity_sent: number;
  quantity_consumed: number;
  in_factory_quantity: number;
  sent_movement: number | null;
  sent_movement_reference: string | null;
}

export interface ProductionBatch {
  id: number;
  batch_number: string;
  sales_channel: number;
  sales_channel_name: string;
  finished_product: number;
  finished_product_name: string;
  bom: number;
  company_id: number;
  status: ProductionBatchStatus;
  status_display: string;
  planned_quantity: number;
  received_quantity: number;
  in_factory_quantity: number;
  sent_at: string | null;
  completed_at: string | null;
  notes: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  components?: ProductionBatchComponent[];
}

export interface SendToFactoryRequest {
  sales_channel: number;
  finished_product: number;
  planned_quantity: number;
  notes?: string;
}

export interface ReceiveFromFactoryRequest {
  received_quantity: number;
  reason?: 'PRODUCTION_RETURNED' | 'LAB_RECEIVED' | 'PARTIAL_PRODUCTION_RETURNED' | 'OTHER';
  notes?: string;
}

export interface InFactorySummary {
  component_id: number;
  component_name: string;
  component_barcode: string;
  quantity_sent: number;
  quantity_consumed: number;
  in_factory_quantity: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// CLIENT TYPES
// ═════════════════════════════════════════════════════════════════════════════

export interface Client {
  id: number;
  company: number | null;
  company_name: string | null;
  brand: number | null;
  brand_name: string | null;
  reseller: number | null;
  reseller_name: string | null;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string | null;
  phone_normalized: string;
  client_type: 'PERSON' | 'COMPANY';
  date_of_birth: string | null;
  address: string;
  city: string;
  governorate?: string;
  state: string;
  postcode: string;
  country: string;
  source: 'WOOCOMMERCE' | 'POS' | 'MANUAL';
  sales_channel: number | null;
  sales_channel_name: string | null;
  wc_customer_id: number | null;
  points: number;
  number_of_orders: number;
  number_of_returns: number;
  is_blocked: boolean;
  notes: string;
  is_active: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateClientRequest {
  company?: number | null;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  client_type?: 'PERSON' | 'COMPANY';
  date_of_birth?: string | null;
  address?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  source?: 'WOOCOMMERCE' | 'POS' | 'MANUAL';
  brand?: number | null;
  reseller?: number | null;
  sales_channel?: number | null;
  wc_customer_id?: number | null;
  notes?: string;
  points?: number;
  number_of_orders?: number;
  number_of_returns?: number;
  is_blocked?: boolean;
}

// ═════════════════════════════════════════════════════════════════════════════
// ORDER TYPES
// ═════════════════════════════════════════════════════════════════════════════

export type OrderStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'ON_HOLD'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'FAILED';

export type OrderSource = 'WOOCOMMERCE' | 'POS' | 'MANUAL';

/**
 * Social channel a manual / back-office order originated from. Distinct from
 * `OrderSource` (which records the *system* the order entered through).
 */
export type OrderSocialSource = 'instagram' | 'whatsapp' | 'facebook' | 'tiktok' | 'other';

export const ORDER_SOCIAL_SOURCES: ReadonlyArray<{ value: OrderSocialSource; label: string }> = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'other', label: 'Other' },
];

export type PaymentStatus = 'UNPAID' | 'PAID' | 'PARTIAL' | 'REFUNDED';

export type OrderDiscountType = 'NONE' | 'FIXED' | 'PERCENTAGE';

export type OrderOutcome = 'NONE' | 'CONFIRMED' | 'DELAYED' | 'CANCELLED';

export type OrderContactStatus = 'NONE' | 'ANSWERED' | 'NOT_ANSWERED' | 'DELAYED';

export type OrderReturnExchangeStatus = 'NONE' | 'RETURNED' | 'EXCHANGED';

export type DeliveryStatus =
  | 'NONE'
  | 'PENDING'
  | 'QUEUED'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED'
  | 'RETURNED';

// Phase D — clean, derived top-layer status set (the single status the UI reads).
// These are computed by the backend lifecycle service and are read-only.
export type CleanOrderStatus =
  | 'new'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'delayed'
  | 'not_answered'
  | 'canceled'
  | 'preparing'
  | 'done'
  | 'returned'
  | 'exchanged';

export type CleanConfirmationStatus =
  | 'pending'
  | 'accepted'
  | 'delayed'
  | 'canceled'
  | 'no_answer';

export type CleanDeliveryMethod = 'home_delivery' | 'pos_pickup';

export type CleanStockStatus = 'in_stock' | 'partial_stock' | 'out_of_stock';

export type CleanPriorityLevel = 'high' | 'medium' | 'low';

export type CleanSyncStatus =
  | 'imported'
  | 'pending_sync'
  | 'syncing'
  | 'synced'
  | 'sync_failed';

export interface OrderLine {
  id: number;
  product: number | null;
  product_id: number | null;
  product_type?: ProductType | null;
  wc_product_id: number | null;
  external_line_id?: string;
  product_name: string;
  barcode: string;
  product_image: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
  tax: string;
  total: string;
  return_condition?: 'NONE' | 'GOOD' | 'DAMAGED' | 'MISSING' | 'EXCHANGED';
  replacement_product?: number | null;
  is_deleted?: boolean;
}

export interface OrderListItem {
  id: number;
  order_number: string;
  ticket_id: string;
  client_ticket_uuid: string;
  external_order_id: string;
  company: number;
  company_name: string;
  sales_channel: number;
  sales_channel_name: string;
  brand: number | null;
  brand_name: string | null;
  client: number | null;
  client_id: number | null;
  client_email: string | null;
  client_phone: string | null;
  client_name: string | null;
  client_points: number;
  client_is_blocked: boolean;
  client_return_count: number;
  status: OrderStatus;
  wc_status: string;
  source: OrderSource;
  /** Social channel a manual order came in on (Instagram, WhatsApp…); '' when N/A. */
  order_source: OrderSocialSource | '';
  order_source_display: string;
  payment_status: PaymentStatus;
  payment_method: string;
  contact_status: OrderContactStatus;
  return_exchange_status: OrderReturnExchangeStatus;
  return_type: 'NONE' | 'CANCELLED_REFUSED' | 'RETURNED' | 'EXCHANGED' | 'DAMAGED' | 'MISSING' | 'OTHER';
  packaging_status: 'NOT_PACKAGED' | 'PACKAGED' | 'UPDATED';
  packaged_at: string | null;
  packaged_by: number | null;
  packaged_by_name: string | null;
  final_outcome:
    | 'NONE'
    | 'SUCCESSFUL_SALE'
    | 'RETURNED'
    | 'EXCHANGED'
    | 'CANCELLED_BEFORE_DELIVERY'
    | 'CANCELLED_AFTER_DELIVERY'
    | 'FAILED_DELIVERY';
  workflow_status:
    | 'pending'
    | 'answered'
    | 'not_answered'
    | 'delayed'
    | 'sent_to_delivery'
    | 'packaging'
    | 'done'
    | 'retour'
    | 'cancelled'
    | 'changed';
  billing_phone: string;
  currency: string;
  subtotal: string;
  tax_total: string;
  shipping_total: string;
  discount_type: OrderDiscountType;
  discount_value: string;
  discount_total: string;
  total: string;
  is_deleted: boolean;
  line_count: number;
  // Outcome fields
  outcome: OrderOutcome;
  confirmed_at: string | null;
  delay_date: string | null;
  delay_reason: string;
  not_answered_at: string | null;
  not_answered_attempts: number;
  auto_cancelled_at: string | null;
  auto_cancel_reason: string;
  cancellation_reason: string;
  outcome_note: string;
  outcome_changed_at: string | null;
  delivery_status: DeliveryStatus;
  delivery_reference: string;
  delivery_code: string;
  delivery_external_reference: string;
  delivery_status_id: number | null;
  delivery_order_id: number | null;
  delivery_client_id: number | null;
  delivery_cod_amount: string | null;
  delivery_submitted_at: string | null;
  delivery_submitted_by: number | null;
  delivery_attempts: number;
  in_store_pickup: boolean;
  pos_sales_channel: number | null;
  pos_sales_channel_name: string | null;
  pos_sales_channel_code: string | null;
  sent_to_pos_at: string | null;
  sent_to_pos_by: number | null;
  pos_validated_at: string | null;
  pos_validated_by: number | null;
  returned_at: string | null;
  returned_by: number | null;
  return_reason: string;
  stock_restored_at: string | null;
  stock_restored_by: number | null;
  delete_reason: string;
  lifecycle_priority: number | null;
  edit_locked_by: number | null;
  edit_locked_by_name: string | null;
  edit_locked_at: string | null;
  edit_lock_heartbeat_at: string | null;
  edit_lock_expires_at: string | null;
  edit_lock_token: string;
  // Phase D — clean derived top-layer status set (read-only; lifecycle service
  // is the only writer). The single canonical status the UI surfaces.
  order_status: CleanOrderStatus;
  order_status_display: string;
  confirmation_status: CleanConfirmationStatus;
  confirmation_status_display: string;
  delivery_method: CleanDeliveryMethod;
  delivery_method_display: string;
  stock_status: CleanStockStatus;
  stock_status_display: string;
  priority_level: CleanPriorityLevel;
  priority_level_display: string;
  sync_status: CleanSyncStatus;
  sync_status_display: string;
  sync_error_message: string;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderStockCheckItem {
  product_id: number;
  product_name: string;
  barcode: string;
  required_quantity: number;
  line_ids: number[];
  website_quantity: number;
  website_reserved_quantity: number;
  website_available_quantity: number;
  pos_quantity: number | null;
  pos_reserved_quantity: number | null;
  pos_available_quantity: number | null;
  has_warning: boolean;
  issues: string[];
}

export interface OrderStockCheck {
  website_channel: {
    id: number;
    name: string;
    code: string | null;
    channel_type: ChannelType;
  } | null;
  pos_channel: {
    id: number;
    name: string;
    code: string | null;
    channel_type: ChannelType;
  } | null;
  can_fulfill_from_website: boolean;
  can_fulfill_from_pos: boolean | null;
  has_warnings: boolean;
  items: OrderStockCheckItem[];
  unlinked_lines: Array<{
    line_id: number;
    product_name: string;
    required_quantity: number;
    issue: string;
  }>;
}

export interface OrderChannelStockItem {
  product_id: number;
  product_name: string;
  barcode: string;
  required_quantity: number;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  is_sufficient: boolean;
  shortfall: number;
  has_inventory_row: boolean;
}

export interface OrderChannelStock {
  sales_channel: {
    id: number;
    name: string;
    code: string | null;
    channel_type: ChannelType;
    store_type: string;
    is_active: boolean;
  };
  is_order_channel: boolean;
  is_pos_channel: boolean;
  can_fulfill: boolean;
  has_unverifiable_lines: boolean;
  items: OrderChannelStockItem[];
}

export interface OrderStockByChannel {
  order_channel_id: number | null;
  pos_channel_id: number | null;
  tracked_product_count: number;
  channels: OrderChannelStock[];
  unlinked_lines: Array<{
    line_id: number;
    product_name: string;
    required_quantity: number;
    reason: string;
  }>;
}

export interface OrderDetail extends OrderListItem {
  lines: OrderLine[];
  customer_lines?: OrderLine[];
  packaging_lines?: OrderLine[];
  // Billing details
  billing_first_name: string;
  billing_last_name: string;
  billing_company: string;
  billing_email: string;
  billing_phone: string;
  billing_address_1: string;
  billing_address_2: string;
  billing_city: string;
  billing_state: string;
  billing_postcode: string;
  billing_country: string;
  billing_address: Record<string, string>;
  // Shipping details
  shipping_first_name: string;
  shipping_last_name: string;
  shipping_address_1: string;
  shipping_city: string;
  shipping_state: string;
  shipping_postcode: string;
  shipping_country: string;
  shipping_address: Record<string, string>;
  // Notes & metadata
  customer_note: string;
  internal_note: string;
  wc_status: string;
  wc_date_created: string | null;
  wc_date_modified: string | null;
  created_by: number | null;
  created_by_name: string | null;
  deleted_at: string | null;
  deleted_by: number | null;
  delivery_response?: Record<string, unknown> | null;
  stock_check?: OrderStockCheck;
  stock_by_channel?: OrderStockByChannel;
}

export interface OrderEditLineInput {
  id?: number;
  product?: number | null;
  product_name?: string;
  barcode?: string;
  quantity: number;
  unit_price: string;
}

export interface OrderEditRequest {
  lines: OrderEditLineInput[];
  discount_type?: OrderDiscountType;
  discount_value?: string;
  customer_note?: string;
  internal_note?: string;
  // Billing details (editable)
  billing_first_name?: string;
  billing_last_name?: string;
  billing_company?: string;
  billing_email?: string;
  billing_phone?: string;
  billing_address_1?: string;
  billing_address_2?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postcode?: string;
  billing_country?: string;
}

export interface OrderLogEntry {
  id: number;
  action: string;
  /** Human label from the backend `Action` enum (fallback when the UI has no mapping). */
  action_display?: string;
  user: number | null;
  user_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface POSLineItemInput {
  product_id?: number;
  local_product_id?: number;
  sku?: string;
  name?: string;
  quantity: number;
  price: string;
  subtotal?: string;
  total_tax?: string;
  total?: string;
}

export interface POSOrderCreateRequest {
  sales_channel: number;
  ticket_id?: string;
  client_ticket_uuid?: string;
  client?: number | null;
  billing?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    address_1?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
  line_items: POSLineItemInput[];
  payment_method?: string;
  payment_method_title?: string;
  customer_note?: string;
  status?: 'pending' | 'processing' | 'completed';
  /** Manual orders only — social channel the order came in on. */
  order_source?: OrderSocialSource | '';
  subtotal?: string;
  total_tax?: string;
  shipping_total?: string;
  discount_type?: 'NONE' | 'FIXED' | 'PERCENTAGE';
  discount_value?: string;
  discount_total?: string;
  total?: string;
}

// Phase D — KPI block computed from the clean ``order_status`` (genuinely
// successful sales only; returns / exchanges / cancellations excluded).
export interface OrderStatusKpis {
  total_orders: number;
  by_status: Partial<Record<CleanOrderStatus, number>>;
  successful_sales: number;
  revenue: string;
  returned: number;
  exchanged: number;
  canceled: number;
  in_confirmation: number;
  in_fulfillment: number;
}

export interface OrderSummary {
  total_orders: number;
  pending: number;
  processing: number;
  completed: number;
  cancelled: number;
  revenue: string;
  woocommerce_count: number;
  pos_count: number;
  manual_count: number;
  // Outcome counts
  confirmed_count: number;
  delayed_count: number;
  cancelled_outcome: number;
  flow_counts?: Record<string, number>;
  workflow_counts?: Record<string, number>;
  exchanged?: number;
  // Phase D — additive clean-status KPI block.
  order_status_kpis?: OrderStatusKpis;
}
