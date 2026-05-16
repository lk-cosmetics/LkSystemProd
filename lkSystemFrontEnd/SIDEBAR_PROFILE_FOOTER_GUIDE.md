# Professional Sidebar Profile Footer - Implementation Guide

## Overview

A production-ready sidebar footer component that displays the user's profile picture with their name, role, and quick action menu. Built with React, React Query, TypeScript, and Tailwind CSS using professional best practices.

## What's Included

### 1. **React Query Hook** (`useProfile.ts`)
Professional hook for user profile data management:

```typescript
// Fetch current user's profile with auto-polling
const { data: profile, isLoading, isError } = useMyProfile(enabled);

// Update profile without files
const { mutate: updateProfile } = useUpdateProfile();

// Upload avatar with form data
const { mutate: uploadAvatar } = useUploadAvatar();
```

**Features:**
- ✅ Auto-refetch every 5 minutes (configurable)
- ✅ Proper cache invalidation on mutations
- ✅ Enabled/disabled control
- ✅ Error handling built-in
- ✅ Query key organization

### 2. **Sidebar Profile Footer Component** (`sidebar-profile-footer.tsx`)

A professional, responsive component that adapts to sidebar state:

#### Expanded Sidebar View
```
┌─────────────────────┐
│ [Avatar] Name       │
│          Role  ›    │
└─────────────────────┘
```

#### Collapsed Sidebar View
```
┌───────┐
│[Avatar]│
└───────┘
```

**Features:**
- ✅ Profile picture with fallback initials
- ✅ User name and role display
- ✅ Loading skeleton state
- ✅ Error fallback to auth user data
- ✅ Responsive (expands/collapses with sidebar)
- ✅ Dropdown menu with settings & logout
- ✅ Professional styling with Tailwind
- ✅ Proper TypeScript types

### 3. **Usage Example** (`SIDEBAR_PROFILE_FOOTER_EXAMPLE.tsx`)

Complete example showing integration into your main layout.

---

## Implementation Details

### CN Utility Usage

The component uses the `cn()` utility (class-variance-authority) for conditional class merging:

```typescript
// Combines and merges classes intelligently
className={cn(
  'flex items-center gap-3 rounded-md p-1',
  'hover:bg-sidebar-accent focus:outline-none',
  isLoading && 'opacity-50',
  className  // user-provided classes override
)}
```

**Benefits:**
- ✅ No class conflicts
- ✅ Clean, readable code
- ✅ Type-safe class composition
- ✅ Proper precedence handling

### React Query Integration

Professional data fetching pattern:

```typescript
// Auto-poll profile every 5 minutes
export function useMyProfile(enabled = true) {
  return useQuery({
    queryKey: profileKeys.me(),
    queryFn: () => profileService.getMyProfile(),
    staleTime: 1 * 60 * 1000,        // 1 minute
    gcTime: 30 * 60 * 1000,          // 30 minutes cache
    refetchInterval: 5 * 60 * 1000,  // 5 min polling
    refetchIntervalInBackground: true,
    refetchOnReconnect: true,
  });
}

// In component:
const { data: profile, isLoading, isError } = useMyProfile(
  authUser?.id != null  // Only fetch if authenticated
);
```

**Key Concepts:**
1. **Query Keys**: Organized namespacing (`profileKeys.me()`)
2. **Stale Time**: How long before data is considered stale
3. **GC Time**: How long to keep cached data
4. **Polling**: Auto-refetch interval for real-time updates
5. **Conditional Fetching**: Only enabled when user is authenticated

### Loading & Error Handling

```typescript
// Loading state: Show skeleton
{isLoading && (
  <div className="flex gap-3">
    <Skeleton className="size-10 rounded-full" />
    <Skeleton className="h-3 w-24" />
  </div>
)}

// Loaded state: Show profile
{!isLoading && !isError && (
  <Avatar>
    <AvatarImage src={profile?.avatar} />
    <AvatarFallback>{initials}</AvatarFallback>
  </Avatar>
)}

// Error state: Fallback to auth user
{!isLoading && isError && (
  <Avatar>
    <AvatarFallback>{initials}</AvatarFallback>
  </Avatar>
)}
```

### Avatar Initials

Professional initials generation:

```typescript
const getInitials = (name: string): string => {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

// "John Doe" → "JD"
// "Alice" → "AL"
```

---

## API Integration

### Endpoints Used

```
GET /api/profiles/me/           → Fetch current user profile
PATCH /api/profiles/{id}/       → Update profile
PATCH /api/profiles/{id}/ [FormData] → Upload avatar
```

### Profile Data Structure

```typescript
interface UserProfileFull {
  id: number;
  avatar: string | null;        // Profile picture URL
  phone: string | null;
  birth_date: string | null;
  gender: 'M' | 'F' | 'O' | null;
  nationality: string | null;
  address: string | null;
  city: string | null;
  // ... plus education, CIN, passport docs
  completion_percentage: number;
}
```

### Auth User Data Structure

```typescript
interface User {
  id: number;
  matricule: string;
  firstName?: string;
  lastName?: string;
  email: string;
  role?: string;
  permissions: string[];
}
```

---

## Sidebar State Integration

The component responds to sidebar collapse state:

```typescript
// Get sidebar state
const { state } = useSidebar();  // 'expanded' | 'collapsed'

// Render different layouts
if (state === 'expanded') {
  // Show full profile card with name and role
} else {
  // Show icon-only avatar
}

// Smooth transition via CSS
className={cn(
  'flex items-center transition-all duration-200',
  state === 'expanded' && 'flex-row gap-3',
  state === 'collapsed' && 'flex-col justify-center'
)}
```

---

## TypeScript Types

```typescript
interface SidebarProfileFooterProps {
  className?: string;
  showActions?: boolean;
  onProfileClick?: () => void;
  onSettingsClick?: () => void;
  onLogoutClick?: () => void;
}
```

All types are properly defined and exported. The component is fully type-safe.

---

## Styling with Tailwind

### CSS Pattern: Responsive Containers

```typescript
// Expanded: flex row with gap
'flex flex-col gap-3'

// Collapsed: center content
'flex justify-center'

// Hover effects
'hover:bg-sidebar-accent'

// Focus states (accessibility)
'focus-visible:ring-2 focus-visible:ring-sidebar-ring'

// Transitions
'transition-all duration-200'
```

### Sidebar Design System

Uses sidebar CSS variables and design tokens:

```css
/* Sidebar design variables */
--sidebar-background: hsl(...)
--sidebar-accent: hsl(...)
--sidebar-border: hsl(...)
--sidebar-ring: hsl(...)
```

These variables adapt to light/dark mode automatically.

---

## Usage in Projects

### 1. Main Layout Integration

```typescript
import { SidebarProvider, Sidebar, SidebarFooter } from '@/components/ui/sidebar';
import { SidebarProfileFooter } from '@/components/ui/sidebar-profile-footer';

export function MainLayout() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          {/* Navigation items */}
        </SidebarContent>
        <SidebarFooter>
          <SidebarProfileFooter 
            onProfileClick={() => navigate('/profile')}
            onLogoutClick={() => logout()}
          />
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
  );
}
```

### 2. Hook Usage in Custom Components

```typescript
// Fetch profile anywhere
const { data: profile } = useMyProfile();

// Update profile
const { mutate: updateProfile } = useUpdateProfile();
updateProfile({ 
  id: userId, 
  data: { phone: '123456' } 
});

// Upload avatar
const { mutate: uploadAvatar } = useUploadAvatar();
uploadAvatar({ id: userId, file: avatarFile });
```

---

## Performance Optimization

### Cache Strategy

```typescript
// Profile stays fresh for 1 minute
staleTime: 1 * 60 * 1000

// Keep in cache for 30 minutes even if unused
gcTime: 30 * 60 * 1000

// But refetch in background every 5 minutes
refetchInterval: 5 * 60 * 1000
```

### Conditional Fetching

```typescript
// Only fetch profile if user is authenticated
const { data: profile } = useMyProfile(
  authUser?.id != null  // enabled prop
);
```

This prevents unnecessary API calls.

### Background Refetching

```typescript
// Refetch even when user is not looking
refetchIntervalInBackground: true

// This keeps the sidebar profile picture up-to-date
// even when user switches tabs
```

---

## Accessibility Features

- ✅ ARIA labels on all interactive elements
- ✅ Focus states with visible rings
- ✅ Keyboard navigation support
- ✅ Proper semantic HTML
- ✅ Color contrast ratios
- ✅ Tooltip descriptions
- ✅ Loading state announcements

---

## Browser Support

- ✅ Modern browsers (Chrome, Firefox, Safari, Edge)
- ✅ Mobile browsers
- ✅ Dark mode support
- ✅ Light mode support

---

## Common Customizations

### Change Polling Interval

```typescript
const { data: profile } = useMyProfile();  // 5 min polling

// Or customize in useMyProfile:
refetchInterval: 2 * 60 * 1000;  // 2 minute polling
```

### Hide Menu Actions

```typescript
<SidebarProfileFooter showActions={false} />
```

### Custom Classes

```typescript
<SidebarProfileFooter
  className="border-2 border-red-500"
/>
```

### Handle Logout

```typescript
<SidebarProfileFooter
  onLogoutClick={() => {
    // Custom logout logic
    authService.logout();
    navigate('/login');
  }}
/>
```

---

## Troubleshooting

### Profile Picture Not Loading

1. Check backend returns valid avatar URL
2. Verify image path is accessible
3. Check CORS headers
4. Ensure proper image format

### Not Refetching Profile

1. Verify network tab for API calls
2. Check React Query DevTools
3. Ensure `useMyProfile()` is called
4. Verify auth user is set

### Sidebar Not Collapsing

1. Check `useSidebar()` is in SidebarProvider
2. Verify sidebar state changes
3. Check CSS classes are applied

---

## Files Created/Modified

- ✅ `src/hooks/queries/useProfile.ts` - New React Query hook
- ✅ `src/hooks/queries/index.ts` - Export new hook
- ✅ `src/components/ui/sidebar-profile-footer.tsx` - New component
- ✅ `src/components/SIDEBAR_PROFILE_FOOTER_EXAMPLE.tsx` - Usage example

---

## Next Steps

1. Copy the `SidebarProfileFooter` component into your sidebar
2. Integrate the `useMyProfile` hook into your app
3. Customize colors and styling as needed
4. Test profile picture upload functionality
5. Monitor profile updates with React Query DevTools

---

## Support

For questions or issues:
1. Check React Query documentation: https://tanstack.com/query/latest
2. Review Tailwind CSS docs: https://tailwindcss.com
3. Check TypeScript best practices
