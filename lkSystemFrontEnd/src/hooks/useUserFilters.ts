import { useMemo, useState } from 'react';

interface FilterState {
  searchQuery: string;
  roleFilter: string;
  statusFilter: string;
}

interface UseUserFiltersProps<T> {
  users: T[];
  getSearchableFields: (user: T) => string[];
  getRoleField: (user: T) => string;
  getStatusField: (user: T) => string;
}

interface UseUserFiltersReturn<T> {
  // Filter states
  filters: FilterState;

  // Filtered data
  filteredUsers: T[];

  // Filter actions
  setSearchQuery: (query: string) => void;
  setRoleFilter: (role: string) => void;
  setStatusFilter: (status: string) => void;
  resetFilters: () => void;
}

export function useUserFilters<T>({
  users,
  getSearchableFields,
  getRoleField,
  getStatusField,
}: UseUserFiltersProps<T>): UseUserFiltersReturn<T> {
  const [filters, setFilters] = useState<FilterState>({
    searchQuery: '',
    roleFilter: 'all',
    statusFilter: 'all',
  });

  // Memoized filtered users
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      // Search filter
      const searchableText = getSearchableFields(user).join(' ').toLowerCase();
      const matchesSearch = searchableText.includes(
        filters.searchQuery.toLowerCase()
      );

      // Role filter
      const matchesRole =
        filters.roleFilter === 'all' ||
        getRoleField(user) === filters.roleFilter;

      // Status filter
      const matchesStatus =
        filters.statusFilter === 'all' ||
        getStatusField(user) === filters.statusFilter;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, filters, getSearchableFields, getRoleField, getStatusField]);

  const setSearchQuery = (query: string) => {
    setFilters(prev => ({ ...prev, searchQuery: query }));
  };

  const setRoleFilter = (role: string) => {
    setFilters(prev => ({ ...prev, roleFilter: role }));
  };

  const setStatusFilter = (status: string) => {
    setFilters(prev => ({ ...prev, statusFilter: status }));
  };

  const resetFilters = () => {
    setFilters({
      searchQuery: '',
      roleFilter: 'all',
      statusFilter: 'all',
    });
  };

  return {
    filters,
    filteredUsers,
    setSearchQuery,
    setRoleFilter,
    setStatusFilter,
    resetFilters,
  };
}
