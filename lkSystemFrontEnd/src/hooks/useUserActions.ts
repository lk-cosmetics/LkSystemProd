import { useState, useCallback } from 'react';

interface UseUserActionsProps<T> {
  initialUsers: T[];
  getUserId: (user: T) => string;
  onSuccess?: (message: string) => void;
  onError?: (error: Error) => void;
}

interface UseUserActionsReturn<T> {
  users: T[];
  isLoading: boolean;
  error: Error | null;
  updateUser: (updatedUser: T) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  toggleUserStatus: (userId: string, currentStatus: string) => Promise<void>;
  refreshUsers: () => Promise<void>;
}

export function useUserActions<T>({
  initialUsers,
  getUserId,
  onSuccess,
  onError,
}: UseUserActionsProps<T>): UseUserActionsReturn<T> {
  const [users, setUsers] = useState<T[]>(initialUsers);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Update user
  const updateUser = useCallback(
    async (updatedUser: T) => {
      setIsLoading(true);
      setError(null);

      try {
        // TODO: Replace with actual API call
        await new Promise(resolve => setTimeout(resolve, 500));

        setUsers(prev =>
          prev.map(u =>
            getUserId(u) === getUserId(updatedUser) ? updatedUser : u
          )
        );

        if (onSuccess) {
          onSuccess('User updated successfully!');
        }
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('Failed to update user');
        setError(error);
        if (onError) {
          onError(error);
        }
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [getUserId, onSuccess, onError]
  );

  // Delete user
  const deleteUser = useCallback(
    async (userId: string) => {
      setIsLoading(true);
      setError(null);

      try {
        // TODO: Replace with actual API call
        await new Promise(resolve => setTimeout(resolve, 500));

        setUsers(prev => prev.filter(u => getUserId(u) !== userId));

        if (onSuccess) {
          onSuccess('User deleted successfully!');
        }
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('Failed to delete user');
        setError(error);
        if (onError) {
          onError(error);
        }
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [getUserId, onSuccess, onError]
  );

  // Toggle user status (block/unblock)
  const toggleUserStatus = useCallback(
    async (userId: string, currentStatus: string) => {
      setIsLoading(true);
      setError(null);

      try {
        // TODO: Replace with actual API call
        await new Promise(resolve => setTimeout(resolve, 500));

        const newStatus = currentStatus === 'active' ? 'blocked' : 'active';

        setUsers(prev =>
          prev.map(u =>
            getUserId(u) === userId ? ({ ...u, status: newStatus } as T) : u
          )
        );

        if (onSuccess) {
          onSuccess(
            `User ${newStatus === 'blocked' ? 'blocked' : 'unblocked'} successfully!`
          );
        }
      } catch (err) {
        const error =
          err instanceof Error
            ? err
            : new Error('Failed to update user status');
        setError(error);
        if (onError) {
          onError(error);
        }
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [getUserId, onSuccess, onError]
  );

  // Refresh users list
  const refreshUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // TODO: Replace with actual API call to fetch users
      await new Promise(resolve => setTimeout(resolve, 500));
      // setUsers(fetchedUsers);
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error('Failed to fetch users');
      setError(error);
      if (onError) {
        onError(error);
      }
    } finally {
      setIsLoading(false);
    }
  }, [onError]);

  return {
    users,
    isLoading,
    error,
    updateUser,
    deleteUser,
    toggleUserStatus,
    refreshUsers,
  };
}
