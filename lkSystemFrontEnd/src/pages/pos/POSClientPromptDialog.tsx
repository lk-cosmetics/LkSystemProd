/**
 * POSClientPromptDialog – Fallback modal when user clicks "Place Order"
 * without selecting or skipping a customer.
 * Options: Select Client, Add Client, Skip (proceed without customer).
 */
import { Search, UserPlus, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface POSClientPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectClient: () => void;
  onAddClient: () => void;
  onSkip: () => void;
}

export function POSClientPromptDialog({
  open,
  onOpenChange,
  onSelectClient,
  onAddClient,
  onSkip,
}: POSClientPromptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Customer Required</DialogTitle>
          <DialogDescription>
            No customer has been selected for this order. Would you like to
            assign a customer or proceed without one?
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-2">
          <Button
            variant="outline"
            className="h-11 justify-start gap-3 text-sm"
            onClick={() => {
              onOpenChange(false);
              onSelectClient();
            }}
          >
            <Search className="size-4 text-primary" />
            <div className="text-left">
              <p className="font-medium">Select Existing Client</p>
              <p className="text-xs text-muted-foreground">
                Search from your client list
              </p>
            </div>
          </Button>

          <Button
            variant="outline"
            className="h-11 justify-start gap-3 text-sm"
            onClick={() => {
              onOpenChange(false);
              onAddClient();
            }}
          >
            <UserPlus className="size-4 text-primary" />
            <div className="text-left">
              <p className="font-medium">Add New Client</p>
              <p className="text-xs text-muted-foreground">
                Quick client registration
              </p>
            </div>
          </Button>

          <Button
            variant="ghost"
            className="h-11 justify-start gap-3 text-sm text-muted-foreground"
            onClick={() => {
              onOpenChange(false);
              onSkip();
            }}
          >
            <UserX className="size-4" />
            <div className="text-left">
              <p className="font-medium">Skip — No Customer</p>
              <p className="text-xs">Proceed without assigning a client</p>
            </div>
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
