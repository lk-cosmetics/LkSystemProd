import { useState, useCallback } from 'react';

export type DialogType = 'view' | 'edit' | 'delete' | 'block' | 'success';

interface DialogState {
  view: boolean;
  edit: boolean;
  delete: boolean;
  block: boolean;
  success: boolean;
}

interface DialogData<T> {
  selectedUser: T | null;
  userToDelete: T | null;
  userToBlock: T | null;
  editFormData: T | null;
  successMessage: string;
}

interface UseDialogsReturn<T> {
  // Dialog states
  dialogs: DialogState;

  // Dialog data
  data: DialogData<T>;

  // Dialog actions
  openDialog: (type: DialogType, user?: T, message?: string) => void;
  closeDialog: (type: DialogType) => void;
  closeAllDialogs: () => void;

  // Data setters
  setEditFormData: (data: T | null) => void;
  setSuccessMessage: (message: string) => void;
}

export function useDialogs<T>(): UseDialogsReturn<T> {
  // Consolidated dialog states
  const [dialogs, setDialogs] = useState<DialogState>({
    view: false,
    edit: false,
    delete: false,
    block: false,
    success: false,
  });

  // Consolidated dialog data
  const [data, setData] = useState<DialogData<T>>({
    selectedUser: null,
    userToDelete: null,
    userToBlock: null,
    editFormData: null,
    successMessage: '',
  });

  // Open a specific dialog with optional user data
  const openDialog = useCallback(
    (type: DialogType, user?: T, message?: string) => {
      setDialogs(prev => ({ ...prev, [type]: true }));

      // Set appropriate user data based on dialog type
      switch (type) {
        case 'view':
          setData(prev => ({ ...prev, selectedUser: user || null }));
          break;
        case 'edit':
          setData(prev => ({
            ...prev,
            editFormData: user ? { ...user } : null,
          }));
          break;
        case 'delete':
          setData(prev => ({ ...prev, userToDelete: user || null }));
          break;
        case 'block':
          setData(prev => ({ ...prev, userToBlock: user || null }));
          break;
        case 'success':
          setData(prev => ({ ...prev, successMessage: message || '' }));
          break;
      }
    },
    []
  );

  // Close a specific dialog
  const closeDialog = useCallback((type: DialogType) => {
    setDialogs(prev => ({ ...prev, [type]: false }));

    // Clear associated data when closing
    switch (type) {
      case 'view':
        setData(prev => ({ ...prev, selectedUser: null }));
        break;
      case 'edit':
        setData(prev => ({ ...prev, editFormData: null }));
        break;
      case 'delete':
        setData(prev => ({ ...prev, userToDelete: null }));
        break;
      case 'block':
        setData(prev => ({ ...prev, userToBlock: null }));
        break;
      case 'success':
        setData(prev => ({ ...prev, successMessage: '' }));
        break;
    }
  }, []);

  // Close all dialogs
  const closeAllDialogs = useCallback(() => {
    setDialogs({
      view: false,
      edit: false,
      delete: false,
      block: false,
      success: false,
    });
    setData({
      selectedUser: null,
      userToDelete: null,
      userToBlock: null,
      editFormData: null,
      successMessage: '',
    });
  }, []);

  // Update edit form data
  const setEditFormData = useCallback((newData: T | null) => {
    setData(prev => ({ ...prev, editFormData: newData }));
  }, []);

  // Update success message
  const setSuccessMessage = useCallback((message: string) => {
    setData(prev => ({ ...prev, successMessage: message }));
  }, []);

  return {
    dialogs,
    data,
    openDialog,
    closeDialog,
    closeAllDialogs,
    setEditFormData,
    setSuccessMessage,
  };
}
