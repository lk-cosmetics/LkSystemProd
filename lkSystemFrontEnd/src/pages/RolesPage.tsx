/**
 * RBAC Roles Management Page
 *
 * Fully responsive role, permission, and assignment management UI.
 * Decomposed into focused sub-components for clarity and reusability.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldPlus,
  Plus,
  Pencil,
  Trash2,
  Search,
  Users,
  Loader2,
  Lock,
  UserPlus,
  X,
  ChevronDown,
  ChevronRight,
  Eye,
  KeyRound,
  MoreHorizontal,
  CheckCircle2,
  Info,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useDebounce, useCurrentUser } from '@/hooks';
import { useCompanies } from '@/hooks/queries';
import {
  rbacService,
  type RBACRole,
  type PermissionGroup,
  type UserRoleAssignment,
  type RoleCreateRequest,
} from '@/services/rbac.service';
import { userService } from '@/services/user.service';
import { salesChannelService } from '@/services/salesChannel.service';
import { brandService } from '@/services/brand.service';

/* ═══════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════ */

interface UserOption {
  id: number;
  matricule: string;
  full_name: string;
}
interface BrandOption {
  id: number;
  name: string;
}
interface ChannelOption {
  id: number;
  name: string;
}

const SCOPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  platform: {
    label: 'Platform',
    color: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800',
    icon: '🌐',
  },
  company: {
    label: 'Company',
    color: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
    icon: '🏢',
  },
  brand: {
    label: 'Brand',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
    icon: '🏷️',
  },
  channel: {
    label: 'Channel',
    color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
    icon: '📡',
  },
};

const CATEGORY_ICONS: Record<string, string> = {
  dashboard: '📊',
  company: '🏢',
  brands: '🏷️',
  sales_channels: '📡',
  products: '📦',
  categories: '📂',
  inventory: '📋',
  orders: '🛒',
  pos: '💳',
  clients: '👥',
  promotions: '🎯',
  users: '👤',
  roles: '🔐',
  reports: '📈',
  settings: '⚙️',
};

/* ═══════════════════════════════════════════════════════════════════════
   STAT CARD
   ═══════════════════════════════════════════════════════════════════════ */

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Card className="relative overflow-hidden p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </p>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        </div>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SCOPE BADGE
   ═══════════════════════════════════════════════════════════════════════ */

function ScopeBadge({ scopeType }: { scopeType: string }) {
  const config = SCOPE_CONFIG[scopeType];
  if (!config) return <Badge variant="outline">{scopeType}</Badge>;

  return (
    <Badge
      variant="outline"
      className={`text-xs font-medium border ${config.color} gap-1`}
    >
      <span className="text-xs">{config.icon}</span>
      {config.label}
    </Badge>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EMPTY STATE
   ═══════════════════════════════════════════════════════════════════════ */

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted mb-4">
        <Shield className="size-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   TABLE SKELETON
   ═══════════════════════════════════════════════════════════════════════ */

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell>
            <div className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          </TableCell>
          <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
          <TableCell className="text-center"><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
          <TableCell className="text-center"><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
          <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
          <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto rounded-md" /></TableCell>
        </TableRow>
      ))}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MOBILE ROLE CARD (responsive alternative to table row)
   ═══════════════════════════════════════════════════════════════════════ */

function MobileRoleCard({
  role,
  onView,
  onEdit,
  onClone,
  onAssign,
  onDelete,
}: {
  role: RBACRole;
  onView: () => void;
  onEdit: () => void;
  onClone: () => void;
  onAssign: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Shield className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm">{role.name}</h3>
              {role.is_system && (
                <Badge variant="secondary" className="text-[10px] gap-0.5 px-1.5 py-0">
                  <Lock className="size-2.5" /> System
                </Badge>
              )}
            </div>
            {role.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {role.description}
              </p>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onView}>
              <Eye className="size-4 mr-2" /> View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4 mr-2" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onClone}>
              <Copy className="size-4 mr-2" /> Clone
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onAssign}>
              <UserPlus className="size-4 mr-2" /> Assign User
            </DropdownMenuItem>
            {!role.is_system && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                  <Trash2 className="size-4 mr-2" /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <ScopeBadge scopeType={role.scope_type} />
        <Badge variant="outline" className="text-xs gap-1">
          <KeyRound className="size-3" />
          {role.permissions_count ?? 0}
        </Badge>
        <Badge variant="outline" className="text-xs gap-1">
          <Users className="size-3" />
          {role.assignments_count ?? 0}
        </Badge>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PERMISSION PICKER (redesigned for create/edit dialog)
   ═══════════════════════════════════════════════════════════════════════ */

function PermissionPicker({
  permissionGroups,
  selected,
  onToggle,
  onToggleCategory,
  onSelectAll,
  onClearAll,
}: {
  permissionGroups: PermissionGroup[];
  selected: Set<string>;
  onToggle: (codename: string) => void;
  onToggleCategory: (codes: string[]) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState('');

  const allCodes = useMemo(
    () => permissionGroups.flatMap(g => g.permissions.map(p => p.codename)),
    [permissionGroups],
  );

  const toggleCollapse = (cat: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const expandAll = () => setCollapsedCats(new Set());
  const collapseAll = () =>
    setCollapsedCats(new Set(permissionGroups.map(g => g.category)));

  const filteredGroups = useMemo(() => {
    if (!filterText.trim()) return permissionGroups;
    const q = filterText.toLowerCase();
    return permissionGroups
      .map(g => ({
        ...g,
        permissions: g.permissions.filter(
          p =>
            p.name.toLowerCase().includes(q) ||
            p.codename.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q),
        ),
      }))
      .filter(g => g.permissions.length > 0);
  }, [permissionGroups, filterText]);

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Top toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 rounded-lg">
            <CheckCircle2 className="size-3.5 text-primary" />
            <span className="text-sm font-semibold text-primary tabular-nums">
              {selected.size}
            </span>
            <span className="text-xs text-muted-foreground">/ {allCodes.length}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onSelectAll}>
            Select All
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onClearAll}>
            Clear
          </Button>
          <Separator orientation="vertical" className="h-4 mx-0.5" />
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={expandAll}>
            Expand
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={collapseAll}>
            Collapse
          </Button>
        </div>
      </div>

      {/* Search filter */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          placeholder="Filter permissions..."
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      {/* Permission groups */}
      <ScrollArea className="flex-1 min-h-[280px] max-h-[380px]">
        <div className="space-y-1 pr-3">
          {filteredGroups.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No permissions match your filter.
            </p>
          )}
          {filteredGroups.map(group => {
            const codes = group.permissions.map(p => p.codename);
            const checkedCount = codes.filter(c => selected.has(c)).length;
            const allChecked = checkedCount === codes.length;
            const someChecked = checkedCount > 0 && !allChecked;
            const collapsed = collapsedCats.has(group.category) && !filterText;
            const emoji = CATEGORY_ICONS[group.category] ?? '📎';

            return (
              <div key={group.category} className="rounded-lg border bg-card overflow-hidden">
                {/* Category header */}
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-3 py-2.5 hover:bg-accent/50 transition-colors"
                  onClick={() => toggleCollapse(group.category)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {collapsed ? (
                      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                    )}
                    <Checkbox
                      checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                      onCheckedChange={() => onToggleCategory(codes)}
                      onClick={e => e.stopPropagation()}
                      className="shrink-0"
                    />
                    <span className="text-sm shrink-0">{emoji}</span>
                    <span className="text-sm font-semibold capitalize truncate">
                      {group.category.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <Badge
                    variant={allChecked ? 'default' : 'secondary'}
                    className="text-[10px] px-1.5 py-0 h-5 shrink-0 tabular-nums"
                  >
                    {checkedCount}/{codes.length}
                  </Badge>
                </button>

                {/* Permission items */}
                {!collapsed && (
                  <div className="border-t bg-muted/20">
                    {group.permissions.map((p, idx) => {
                      const isChecked = selected.has(p.codename);
                      return (
                        <label
                          key={p.codename}
                          className={`
                            flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors
                            hover:bg-accent/40
                            ${idx > 0 ? 'border-t border-dashed border-border/50' : ''}
                            ${isChecked ? 'bg-primary/[0.03]' : ''}
                          `}
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => onToggle(p.codename)}
                            className="mt-0.5 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm ${isChecked ? 'font-medium' : ''}`}>
                                {p.name}
                              </span>
                              <code className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                                {p.codename}
                              </code>
                            </div>
                            {p.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                                {p.description}
                              </p>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   ROLE DETAIL SHEET (view mode)
   ═══════════════════════════════════════════════════════════════════════ */

function RoleDetailSheet({
  open,
  onOpenChange,
  role,
  assignments,
  permissionGroups,
  onRevoke,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  role: RBACRole | null;
  assignments: UserRoleAssignment[];
  permissionGroups: PermissionGroup[];
  onRevoke: (id: number) => void;
}) {
  // Group role's permissions by category
  const groupedPerms = useMemo(() => {
    if (!role?.permissions) return [];
    const groups: { category: string; emoji: string; items: { codename: string; name: string }[] }[] = [];
    const permSet = new Set(role.permissions);

    permissionGroups.forEach(g => {
      const matched = g.permissions.filter(p => permSet.has(p.codename));
      if (matched.length > 0) {
        groups.push({
          category: g.category,
          emoji: CATEGORY_ICONS[g.category] ?? '📎',
          items: matched.map(p => ({ codename: p.codename, name: p.name })),
        });
      }
    });
    return groups;
  }, [role, permissionGroups]);

  if (!role) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
              <Shield className="size-5 text-primary" />
            </div>
            <div>
              <SheetTitle className="text-lg">{role.name}</SheetTitle>
              <SheetDescription className="text-xs">
                {role.description || 'No description provided'}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <Separator />

        <ScrollArea className="flex-1">
          <div className="px-6 py-5 space-y-6">
            {/* Meta info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Scope
                </p>
                <ScopeBadge scopeType={role.scope_type} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Type
                </p>
                <div className="flex items-center gap-1.5">
                  {role.is_system ? (
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <Lock className="size-3" /> System
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">Custom</Badge>
                  )}
                </div>
              </div>
            </div>

            <Separator />

            {/* Permissions grouped by category */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <KeyRound className="size-4 text-primary" />
                  Permissions
                  <Badge variant="secondary" className="text-[10px] px-1.5 h-5 tabular-nums">
                    {role.permissions?.length ?? 0}
                  </Badge>
                </h4>
              </div>

              <div className="space-y-3">
                {groupedPerms.map(group => (
                  <div key={group.category}>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <span>{group.emoji}</span>
                      {group.category.replace(/_/g, ' ')}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.items.map(p => (
                        <TooltipProvider key={p.codename} delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className="text-xs cursor-default hover:bg-accent transition-colors"
                              >
                                {p.name}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <code className="text-xs">{p.codename}</code>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ))}
                    </div>
                  </div>
                ))}

                {groupedPerms.length === 0 && (
                  <p className="text-sm text-muted-foreground">No permissions assigned.</p>
                )}
              </div>
            </div>

            <Separator />

            {/* Assigned users */}
            <div>
              <h4 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Users className="size-4 text-primary" />
                Assigned Users
                <Badge variant="secondary" className="text-[10px] px-1.5 h-5 tabular-nums">
                  {assignments.length}
                </Badge>
              </h4>

              {assignments.length === 0 ? (
                <div className="text-center py-6 border rounded-lg bg-muted/30">
                  <Users className="size-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No users assigned yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {assignments.map(a => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between px-3 py-2.5 rounded-lg border bg-card hover:bg-accent/30 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          U{a.user}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">User #{a.user}</p>
                          <p className="text-xs text-muted-foreground truncate">{a.scope}</p>
                        </div>
                      </div>
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => onRevoke(a.id)}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Revoke assignment</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */

export default function RolesPage() {
  // ── Data ──
  const [roles, setRoles] = useState<RBACRole[]>([]);
  const [permissionGroups, setPermissionGroups] = useState<PermissionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActioning, setIsActioning] = useState(false);

  // ── Search ──
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);

  // ── Dialog / sheet state ──
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  // ── Selected items ──
  const [editingRole, setEditingRole] = useState<RBACRole | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<RBACRole | null>(null);
  const [viewingRole, setViewingRole] = useState<RBACRole | null>(null);
  const [roleAssignments, setRoleAssignments] = useState<UserRoleAssignment[]>([]);

  // ── Role form ──
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formScopeType, setFormScopeType] = useState<string>('company');
  const [formPermissions, setFormPermissions] = useState<Set<string>>(new Set());
  // Super-Admin only: global default role (all companies) vs specific company.
  const [formIsGlobal, setFormIsGlobal] = useState(true);
  const [formCompanyId, setFormCompanyId] = useState<string>('');
  const { data: companies = [] } = useCompanies();

  // ── Assign form ──
  const [assignRoleId, setAssignRoleId] = useState<number | null>(null);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignScopeType, setAssignScopeType] = useState('');
  const [assignBrandId, setAssignBrandId] = useState('');
  const [assignChannelId, setAssignChannelId] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [channels, setChannels] = useState<ChannelOption[]>([]);

  /* ── Data fetching ─────────────────────────────────────────────────── */

  const fetchRoles = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await rbacService.getRoles({
        search: debouncedSearch || undefined,
      });
      const list = Array.isArray(data) ? data : (data as any).results ?? [];
      setRoles(list);
    } catch {
      toast.error('Failed to load roles');
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    rbacService.getPermissions().then(setPermissionGroups).catch(() => {});
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  /* ── Derived data ──────────────────────────────────────────────────── */

  const filteredRoles = useMemo(() => {
    if (!debouncedSearch) return roles;
    const q = debouncedSearch.toLowerCase();
    return roles.filter(
      r => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
    );
  }, [roles, debouncedSearch]);

  const allPermissionCodes = useMemo(
    () => permissionGroups.flatMap(g => g.permissions.map(p => p.codename)),
    [permissionGroups],
  );

  // ── Privilege ceiling (mirrors the backend) ──
  // The Django superuser (platform owner) has no ceiling. Every other user
  // can only grant permissions they themselves hold, so the picker never
  // offers a permission the API would reject.
  const currentUser = useCurrentUser();
  const grantableCodes = useMemo<Set<string> | null>(
    () =>
      currentUser?.is_superuser
        ? null
        : new Set(currentUser?.permissions ?? []),
    [currentUser],
  );
  const isPlatformAdmin = grantableCodes === null;

  // Permissions shown in the picker: limited to grantable for non-root users,
  // but always keep codes already on the edited role visible so existing
  // grants are never silently hidden.
  const visiblePermissionGroups = useMemo<PermissionGroup[]>(() => {
    if (grantableCodes === null) return permissionGroups;
    return permissionGroups
      .map(g => ({
        ...g,
        permissions: g.permissions.filter(
          p => grantableCodes.has(p.codename) || formPermissions.has(p.codename),
        ),
      }))
      .filter(g => g.permissions.length > 0);
  }, [permissionGroups, grantableCodes, formPermissions]);

  const stats = useMemo(
    () => ({
      total: roles.length,
      system: roles.filter(r => r.is_system).length,
      custom: roles.filter(r => !r.is_system).length,
      permissions: permissionGroups.reduce((s, g) => s + g.permissions.length, 0),
    }),
    [roles, permissionGroups],
  );

  /* ── Permission toggle helpers ─────────────────────────────────────── */

  const togglePermission = useCallback((codename: string) => {
    setFormPermissions(prev => {
      const next = new Set(prev);
      next.has(codename) ? next.delete(codename) : next.add(codename);
      return next;
    });
  }, []);

  const toggleCategory = useCallback((codes: string[]) => {
    setFormPermissions(prev => {
      const next = new Set(prev);
      const allChecked = codes.every(c => next.has(c));
      codes.forEach(c => (allChecked ? next.delete(c) : next.add(c)));
      return next;
    });
  }, []);

  const selectAllPermissions = useCallback(() => {
    if (grantableCodes === null) {
      setFormPermissions(new Set(allPermissionCodes));
      return;
    }
    // Non-root: only select the permissions the actor is allowed to grant,
    // keeping any already-selected codes intact.
    setFormPermissions(prev => {
      const next = new Set(prev);
      allPermissionCodes.forEach(c => {
        if (grantableCodes.has(c)) next.add(c);
      });
      return next;
    });
  }, [allPermissionCodes, grantableCodes]);

  const deselectAllPermissions = useCallback(
    () => setFormPermissions(new Set()),
    [],
  );

  /* ── Form helpers ──────────────────────────────────────────────────── */

  const resetRoleForm = useCallback(() => {
    setFormName('');
    setFormDescription('');
    setFormScopeType('company');
    setFormPermissions(new Set());
    setFormIsGlobal(true);
    setFormCompanyId('');
    setEditingRole(null);
  }, []);

  const openCreateDialog = () => {
    resetRoleForm();
    setRoleDialogOpen(true);
  };

  const openEditDialog = async (role: RBACRole) => {
    try {
      const detail = await rbacService.getRole(role.id);
      setEditingRole(detail);
      setFormName(detail.name);
      setFormDescription(detail.description);
      setFormScopeType(detail.scope_type);
      setFormPermissions(new Set(detail.permissions));
      setFormIsGlobal(detail.company == null);
      setFormCompanyId(detail.company != null ? String(detail.company) : '');
      setRoleDialogOpen(true);
    } catch {
      toast.error('Failed to load role details');
    }
  };

  const openCloneDialog = async (role: RBACRole) => {
    try {
      const detail = await rbacService.getRole(role.id);
      // Clone = create a NEW role pre-filled from the source. editingRole stays
      // null so handleSaveRole() POSTs a new role; the backend still enforces
      // the privilege ceiling (you can only grant permissions you hold).
      setEditingRole(null);
      setFormName(`Copy of ${detail.name}`);
      setFormDescription(detail.description);
      setFormScopeType(detail.scope_type);
      setFormPermissions(new Set(detail.permissions));
      setRoleDialogOpen(true);
    } catch {
      toast.error('Failed to load role to clone');
    }
  };

  const openDetailSheet = async (role: RBACRole) => {
    try {
      const [detail, allAssignments] = await Promise.all([
        rbacService.getRole(role.id),
        rbacService.getAssignments(),
      ]);
      setViewingRole(detail);
      setRoleAssignments(allAssignments.filter(a => a.role === role.id));
      setDetailSheetOpen(true);
    } catch {
      toast.error('Failed to load role details');
    }
  };

  /* ── CRUD handlers ─────────────────────────────────────────────────── */

  const handleSaveRole = async () => {
    if (!formName.trim()) {
      toast.error('Role name is required');
      return;
    }
    if (formPermissions.size === 0) {
      toast.error('Select at least one permission');
      return;
    }

    setIsActioning(true);
    try {
      const payload: RoleCreateRequest = {
        name: formName.trim(),
        description: formDescription.trim(),
        scope_type: formScopeType as RoleCreateRequest['scope_type'],
        permissions: Array.from(formPermissions),
      };
      // Super Admin chooses the role's visibility; company users always create
      // company-specific roles (the backend forces their company regardless).
      if (isPlatformAdmin) {
        payload.is_global = formIsGlobal;
        if (!formIsGlobal && formCompanyId) {
          payload.company = Number(formCompanyId);
        }
      }

      if (editingRole) {
        await rbacService.updateRole(editingRole.id, payload);
        toast.success('Role updated successfully');
      } else {
        await rbacService.createRole(payload);
        toast.success('Role created successfully');
      }
      setRoleDialogOpen(false);
      resetRoleForm();
      fetchRoles();
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.name?.[0] ||
        'Failed to save role';
      toast.error(msg);
    } finally {
      setIsActioning(false);
    }
  };

  const confirmDelete = async () => {
    if (!roleToDelete) return;
    setIsActioning(true);
    try {
      await rbacService.deleteRole(roleToDelete.id);
      toast.success('Role deleted');
      setDeleteDialogOpen(false);
      setRoleToDelete(null);
      fetchRoles();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to delete role');
    } finally {
      setIsActioning(false);
    }
  };

  /* ── Assign handlers ───────────────────────────────────────────────── */

  const openAssignDialog = async (role: RBACRole) => {
    setAssignRoleId(role.id);
    setAssignUserId('');
    setAssignScopeType(role.scope_type);
    setAssignBrandId('');
    setAssignChannelId('');

    try {
      const [usersRes, brandsRes, channelsRes] = await Promise.all([
        userService.getUsers().then((r: any) => r.results ?? r),
        brandService.getAllBrands().then((r: any) => (Array.isArray(r) ? r : r.results ?? [])),
        salesChannelService
          .getAllChannels()
          .then((r: any) => (Array.isArray(r) ? r : r.results ?? [])),
      ]);
      setUsers(
        usersRes.map((u: any) => ({
          id: u.id,
          matricule: u.matricule,
          full_name: u.full_name || `${u.first_name} ${u.last_name}`,
        })),
      );
      setBrands(brandsRes.map((b: any) => ({ id: b.id, name: b.name })));
      setChannels(channelsRes.map((c: any) => ({ id: c.id, name: c.name })));
      setAssignDialogOpen(true);
    } catch {
      toast.error('Failed to load data for assignment');
    }
  };

  const handleAssignRole = async () => {
    if (!assignRoleId || !assignUserId) {
      toast.error('Select a user');
      return;
    }
    setIsActioning(true);
    try {
      await rbacService.assignRole({
        user_id: Number(assignUserId),
        role_id: assignRoleId,
        brand_id:
          assignScopeType === 'brand' && assignBrandId
            ? Number(assignBrandId)
            : undefined,
        sales_channel_id:
          assignScopeType === 'channel' && assignChannelId
            ? Number(assignChannelId)
            : undefined,
      });
      toast.success('Role assigned successfully');
      setAssignDialogOpen(false);
      fetchRoles();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to assign role');
    } finally {
      setIsActioning(false);
    }
  };

  const handleRevoke = async (assignmentId: number) => {
    try {
      await rbacService.revokeRole(assignmentId);
      toast.success('Assignment revoked');
      if (viewingRole) openDetailSheet(viewingRole);
    } catch {
      toast.error('Failed to revoke assignment');
    }
  };

  /* ═══════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════ */

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
        {/* ── Page header ──────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 sm:size-10">
                <ShieldCheck className="size-5 text-primary sm:size-6" />
              </div>
              Roles & Permissions
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5 ml-[46px] sm:ml-[50px]">
              Manage roles, permissions, and user assignments
            </p>
          </div>
          <Button onClick={openCreateDialog} className="gap-2 w-full sm:w-auto">
            <Plus className="size-4" />
            New Role
          </Button>
        </div>

        {/* ── Stats ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <StatCard
            icon={<Shield className="size-5 text-blue-600 dark:text-blue-400" />}
            label="Total Roles"
            value={stats.total}
            color="bg-blue-100 dark:bg-blue-900/50"
          />
          <StatCard
            icon={<Lock className="size-5 text-purple-600 dark:text-purple-400" />}
            label="System"
            value={stats.system}
            color="bg-purple-100 dark:bg-purple-900/50"
          />
          <StatCard
            icon={<ShieldPlus className="size-5 text-emerald-600 dark:text-emerald-400" />}
            label="Custom"
            value={stats.custom}
            color="bg-emerald-100 dark:bg-emerald-900/50"
          />
          <StatCard
            icon={<KeyRound className="size-5 text-amber-600 dark:text-amber-400" />}
            label="Permissions"
            value={stats.permissions}
            color="bg-amber-100 dark:bg-amber-900/50"
          />
        </div>

        {/* ── Search ───────────────────────────────────────────────── */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search roles..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* ── Desktop table ────────────────────────────────────────── */}
        <Card className="hidden md:block overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[35%]">Role</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="text-center">Permissions</TableHead>
                <TableHead className="text-center">Users</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableSkeleton />}
              {!isLoading && filteredRoles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState
                      title="No roles found"
                      description={
                        debouncedSearch
                          ? 'Try a different search term.'
                          : 'Create your first role to get started.'
                      }
                      action={
                        !debouncedSearch ? (
                          <Button size="sm" onClick={openCreateDialog} className="gap-2">
                            <Plus className="size-4" /> Create Role
                          </Button>
                        ) : undefined
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                filteredRoles.map(role => (
                  <TableRow key={role.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/15 transition-colors">
                          <Shield className="size-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm">{role.name}</p>
                          {role.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1 max-w-[280px]">
                              {role.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ScopeBadge scopeType={role.scope_type} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="tabular-nums gap-1">
                        <KeyRound className="size-3" />
                        {role.permissions_count ?? 0}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                        <Users className="size-3.5" />
                        <span className="text-sm tabular-nums">{role.assignments_count ?? 0}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {role.is_system ? (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <Lock className="size-3" /> System
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Custom
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => openDetailSheet(role)}>
                            <Eye className="size-4 mr-2" /> View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditDialog(role)}>
                            <Pencil className="size-4 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openCloneDialog(role)}>
                            <Copy className="size-4 mr-2" /> Clone
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openAssignDialog(role)}>
                            <UserPlus className="size-4 mr-2" /> Assign User
                          </DropdownMenuItem>
                          {!role.is_system && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => {
                                  setRoleToDelete(role);
                                  setDeleteDialogOpen(true);
                                }}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="size-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </Card>

        {/* ── Mobile card list ─────────────────────────────────────── */}
        <div className="flex flex-col gap-3 md:hidden">
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="p-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="size-9 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-full" />
                    <div className="flex gap-2 pt-1">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-12 rounded-full" />
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          {!isLoading && filteredRoles.length === 0 && (
            <EmptyState
              title="No roles found"
              description={
                debouncedSearch
                  ? 'Try a different search term.'
                  : 'Create your first role to get started.'
              }
              action={
                !debouncedSearch ? (
                  <Button size="sm" onClick={openCreateDialog} className="gap-2">
                    <Plus className="size-4" /> Create Role
                  </Button>
                ) : undefined
              }
            />
          )}
          {!isLoading &&
            filteredRoles.map(role => (
              <MobileRoleCard
                key={role.id}
                role={role}
                onView={() => openDetailSheet(role)}
                onEdit={() => openEditDialog(role)}
                onClone={() => openCloneDialog(role)}
                onAssign={() => openAssignDialog(role)}
                onDelete={() => {
                  setRoleToDelete(role);
                  setDeleteDialogOpen(true);
                }}
              />
            ))}
        </div>

        {/* ════════════════════════════════════════════════════════════
            CREATE / EDIT ROLE DIALOG
            ════════════════════════════════════════════════════════════ */}
        <Dialog
          open={roleDialogOpen}
          onOpenChange={v => {
            if (!v) resetRoleForm();
            setRoleDialogOpen(v);
          }}
        >
          <DialogContent className="max-w-2xl h-[90vh] !flex !flex-col p-0 gap-0 overflow-hidden">
            <DialogHeader className="px-6 pt-6 pb-4">
              <DialogTitle className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
                  {editingRole ? (
                    <Pencil className="size-4 text-primary" />
                  ) : (
                    <ShieldPlus className="size-4 text-primary" />
                  )}
                </div>
                {editingRole ? 'Edit Role' : 'Create New Role'}
              </DialogTitle>
              <DialogDescription className="ml-[46px]">
                {editingRole
                  ? 'Update the role settings and permissions.'
                  : 'Define a new role with specific permissions.'}
              </DialogDescription>
            </DialogHeader>

            <Separator />

            <Tabs defaultValue="general" className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <TabsList className="mx-6 mt-4 w-auto self-start">
                <TabsTrigger value="general" className="gap-1.5">
                  <Info className="size-3.5" />
                  General
                </TabsTrigger>
                <TabsTrigger value="permissions" className="gap-1.5">
                  <KeyRound className="size-3.5" />
                  Permissions
                  {formPermissions.size > 0 && (
                    <Badge
                      variant="default"
                      className="text-[10px] px-1.5 py-0 h-4 ml-0.5 tabular-nums"
                    >
                      {formPermissions.size}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ── General tab ── */}
              <TabsContent value="general" className="px-6 py-4 space-y-5 flex-1 overflow-y-auto">
                <div className="space-y-2">
                  <Label htmlFor="role-name" className="text-sm font-medium">
                    Role Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="role-name"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="e.g. Regional Manager"
                    disabled={editingRole?.is_system}
                    className="max-w-md"
                  />
                  {editingRole?.is_system && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Lock className="size-3" />
                      System role names cannot be changed
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="role-desc" className="text-sm font-medium">
                    Description
                  </Label>
                  <Textarea
                    id="role-desc"
                    value={formDescription}
                    onChange={e => setFormDescription(e.target.value)}
                    placeholder="Describe what this role is responsible for..."
                    rows={3}
                    className="max-w-md resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Scope Level</Label>
                  <Select
                    value={formScopeType}
                    onValueChange={setFormScopeType}
                    disabled={editingRole?.is_system}
                  >
                    <SelectTrigger className="max-w-md">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SCOPE_CONFIG)
                        .filter(([key]) => isPlatformAdmin || key !== 'platform')
                        .map(([key, config]) => (
                          <SelectItem key={key} value={key}>
                            <span className="flex items-center gap-2">
                              <span>{config.icon}</span>
                              {config.label}
                            </span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground max-w-md">
                    {editingRole?.is_system ? (
                      <span className="flex items-center gap-1.5">
                        <Lock className="size-3" />
                        A built-in role&apos;s scope is fixed — only its permissions can be changed.
                      </span>
                    ) : (
                      <>
                        Determines at which organizational level this role can be assigned.
                        Higher scopes cascade to lower levels.
                      </>
                    )}
                  </p>
                </div>

                {isPlatformAdmin && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Visibility</Label>
                    <Select
                      value={formIsGlobal ? 'global' : 'company'}
                      onValueChange={v => setFormIsGlobal(v === 'global')}
                    >
                      <SelectTrigger className="max-w-md">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="global">🌐 Global Default Role (all companies)</SelectItem>
                        <SelectItem value="company">🏢 Specific Company Role</SelectItem>
                      </SelectContent>
                    </Select>
                    {!formIsGlobal && (
                      <Select value={formCompanyId} onValueChange={setFormCompanyId}>
                        <SelectTrigger className="max-w-md">
                          <SelectValue placeholder="Select a company" />
                        </SelectTrigger>
                        <SelectContent>
                          {companies.map(c => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <p className="text-xs text-muted-foreground max-w-md">
                      A global default role is visible and assignable in every company.
                      A specific company role appears only inside the selected company.
                    </p>
                  </div>
                )}
              </TabsContent>

              {/* ── Permissions tab ── */}
              <TabsContent
                value="permissions"
                className="flex-1 min-h-0 flex flex-col px-6 py-4 overflow-hidden"
              >
                {!isPlatformAdmin && (
                  <div className="flex items-start gap-2 mb-3 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <Info className="size-3.5 mt-0.5 shrink-0" />
                    <span>
                      You can only grant permissions included in your own access
                      level. Roles you create or edit apply to your company only.
                    </span>
                  </div>
                )}
                <PermissionPicker
                  permissionGroups={visiblePermissionGroups}
                  selected={formPermissions}
                  onToggle={togglePermission}
                  onToggleCategory={toggleCategory}
                  onSelectAll={selectAllPermissions}
                  onClearAll={deselectAllPermissions}
                />
              </TabsContent>
            </Tabs>

            <Separator />

            <DialogFooter className="px-6 py-4">
              <Button
                variant="outline"
                onClick={() => {
                  setRoleDialogOpen(false);
                  resetRoleForm();
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveRole} disabled={isActioning} className="gap-2">
                {isActioning && <Loader2 className="size-4 animate-spin" />}
                {editingRole ? 'Save Changes' : 'Create Role'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ════════════════════════════════════════════════════════════
            ASSIGN ROLE DIALOG
            ════════════════════════════════════════════════════════════ */}
        <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
                  <UserPlus className="size-4 text-primary" />
                </div>
                Assign Role
              </DialogTitle>
              <DialogDescription className="ml-[46px]">
                Select a user and optionally a scope entity.
              </DialogDescription>
            </DialogHeader>

            <Separator />

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  User <span className="text-destructive">*</span>
                </Label>
                <Select value={assignUserId} onValueChange={setAssignUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a user..." />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {u.matricule}
                          </span>
                          <span>{u.full_name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {assignScopeType === 'brand' && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Brand</Label>
                  <Select value={assignBrandId} onValueChange={setAssignBrandId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a brand..." />
                    </SelectTrigger>
                    <SelectContent>
                      {brands.map(b => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {assignScopeType === 'channel' && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Sales Channel</Label>
                  <Select value={assignChannelId} onValueChange={setAssignChannelId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a channel..." />
                    </SelectTrigger>
                    <SelectContent>
                      {channels.map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <Separator />

            <DialogFooter>
              <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAssignRole}
                disabled={isActioning || !assignUserId}
                className="gap-2"
              >
                {isActioning && <Loader2 className="size-4 animate-spin" />}
                Assign Role
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ════════════════════════════════════════════════════════════
            ROLE DETAIL SHEET
            ════════════════════════════════════════════════════════════ */}
        <RoleDetailSheet
          open={detailSheetOpen}
          onOpenChange={setDetailSheetOpen}
          role={viewingRole}
          assignments={roleAssignments}
          permissionGroups={permissionGroups}
          onRevoke={handleRevoke}
        />

        {/* ════════════════════════════════════════════════════════════
            DELETE CONFIRMATION
            ════════════════════════════════════════════════════════════ */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Trash2 className="size-5 text-destructive" />
                Delete Role
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div>
                  <p>
                    Are you sure you want to delete{' '}
                    <strong>{roleToDelete?.name}</strong>? This action cannot be
                    undone.
                  </p>
                  {(roleToDelete?.assignments_count ?? 0) > 0 && (
                    <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                      <Info className="size-4 shrink-0 mt-0.5" />
                      <span>
                        This role has{' '}
                        <strong>{roleToDelete?.assignments_count} active assignment(s)</strong>.
                        They will be removed.
                      </span>
                    </div>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isActioning}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                disabled={isActioning}
                className="bg-destructive hover:bg-destructive/90 gap-2"
              >
                {isActioning && <Loader2 className="size-4 animate-spin" />}
                Delete Role
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
