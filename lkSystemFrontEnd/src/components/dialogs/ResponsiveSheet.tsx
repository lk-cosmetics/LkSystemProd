'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

interface ResponsiveSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}

export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide = false,
}: ResponsiveSheetProps) {
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const checkIsDesktop = () => {
      setIsDesktop(window.innerWidth >= 768);
    };

    checkIsDesktop();
    const timer = setTimeout(checkIsDesktop, 0);
    window.addEventListener('resize', checkIsDesktop);

    return () => {
      window.removeEventListener('resize', checkIsDesktop);
      clearTimeout(timer);
    };
  }, []);

  if (isDesktop) {
    const maxWidthClass = wide ? 'sm:max-w-5xl xl:max-w-6xl' : 'sm:max-w-3xl';

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={`grid max-h-[92vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 ${maxWidthClass}`}
          showCloseButton
        >
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-5 py-4">
            {children}
          </div>
          {footer && <DialogFooter className="border-t bg-background px-5 py-4">{footer}</DialogFooter>}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[92dvh] max-h-[92dvh] overflow-hidden">
        <DrawerHeader className="border-b px-4 pb-3 text-left">
          <DrawerTitle className="text-base leading-tight">{title}</DrawerTitle>
          {description && <DrawerDescription>{description}</DrawerDescription>}
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {children}
        </div>
        {footer && <DrawerFooter className="border-t bg-background px-4 py-3">{footer}</DrawerFooter>}
      </DrawerContent>
    </Drawer>
  );
}
