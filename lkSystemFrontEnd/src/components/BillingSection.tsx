/**
 * BillingSection – Display & Edit customer billing information
 * 
 * Features:
 *   - View mode: Clean card layout with formatted address
 *   - Edit mode: Responsive form with validation
 *   - Editable fields: Name, company, email, phone, address
 *   - Country selector for billing_country
 *   - Professional UI/UX with proper spacing and typography
 */

import { useMemo } from 'react';
import { Pencil, X, Check, MapPin, User, Phone, Mail, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { OrderDetail, OrderEditRequest } from '@/types';

/* ═══════════════════════════════════════════════════════════════════════════ */
/* CONSTANTS                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

const COUNTRIES = [
  { code: 'TN', name: 'Tunisia' },
  { code: 'DZ', name: 'Algeria' },
  { code: 'MA', name: 'Morocco' },
  { code: 'LY', name: 'Libya' },
  { code: 'EG', name: 'Egypt' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'Other', name: 'Other' },
];

/* ═══════════════════════════════════════════════════════════════════════════ */
/* VIEW MODE – Display Billing Information                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function BillingViewMode({
  order,
  onEdit,
}: Readonly<{
  order: OrderDetail;
  onEdit: () => void;
}>) {
  const fullName = `${order.billing_first_name} ${order.billing_last_name}`.trim() || 'Not provided';
  const countryName = COUNTRIES.find(c => c.code === order.billing_country)?.name || order.billing_country || 'Not specified';

  return (
    <Card className="overflow-hidden border-gray-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-blue-100 flex items-center justify-center border border-blue-200">
            <MapPin className="size-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Billing Information</h3>
            <p className="text-xs text-gray-500 mt-0.5">Customer details and shipping address</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onEdit}
          className="gap-1.5 h-8 text-blue-600 border-blue-200 hover:bg-blue-50"
        >
          <Pencil className="size-3.5" /> Edit
        </Button>
      </div>

      <CardContent className="p-6 space-y-6">
        {/* Contact Information */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Full Name</p>
            <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
              <User className="size-4 text-gray-400" /> {fullName}
            </p>
          </div>
          {order.billing_company && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Company</p>
              <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
                <Building2 className="size-4 text-gray-400" /> {order.billing_company}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Email</p>
            <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
              <Mail className="size-4 text-gray-400" /> {order.billing_email || 'Not provided'}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Phone</p>
            <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
              <Phone className="size-4 text-gray-400" /> {order.billing_phone || 'Not provided'}
            </p>
          </div>
        </div>

        <Separator />

        {/* Address */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Billing Address</h4>
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-2 text-sm">
            <p className="text-gray-900 font-medium">
              {order.billing_address_1}
              {order.billing_address_2 && <>, {order.billing_address_2}</>}
            </p>
            <p className="text-gray-600">
              {order.billing_city}
              {order.billing_state && <>, {order.billing_state}</>}
              {order.billing_postcode && <> {order.billing_postcode}</>}
            </p>
            <p className="text-gray-600">
              {countryName}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* EDIT MODE – Editable Billing Form                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function BillingEditMode({
  order,
  editForm,
  onUpdate,
  onCancel,
  onSave,
  isSaving,
}: Readonly<{
  order: OrderDetail;
  editForm: OrderEditRequest;
  onUpdate: (field: keyof OrderEditRequest, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  isSaving?: boolean;
}>) {
  // Form values – use editForm if available, otherwise use order values
  const formData = useMemo(() => ({
    billing_first_name: (editForm.billing_first_name ?? order.billing_first_name) || '',
    billing_last_name: (editForm.billing_last_name ?? order.billing_last_name) || '',
    billing_company: (editForm.billing_company ?? order.billing_company) || '',
    billing_email: (editForm.billing_email ?? order.billing_email) || '',
    billing_phone: (editForm.billing_phone ?? order.billing_phone) || '',
    billing_address_1: (editForm.billing_address_1 ?? order.billing_address_1) || '',
    billing_address_2: (editForm.billing_address_2 ?? order.billing_address_2) || '',
    billing_city: (editForm.billing_city ?? order.billing_city) || '',
    billing_state: (editForm.billing_state ?? order.billing_state) || '',
    billing_postcode: (editForm.billing_postcode ?? order.billing_postcode) || '',
    billing_country: (editForm.billing_country ?? order.billing_country) || 'TN',
  }), [editForm, order]);

  const isValid = formData.billing_first_name.trim() && formData.billing_address_1.trim() && formData.billing_city.trim();

  return (
    <Card className="overflow-hidden border-amber-200 bg-amber-50/30 shadow-sm">
      <div className="bg-gradient-to-r from-amber-100 to-yellow-50 border-b border-amber-200 px-6 py-4 flex items-center gap-3">
        <div className="size-9 rounded-lg bg-amber-100 flex items-center justify-center border border-amber-300">
          <Pencil className="size-5 text-amber-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Edit Billing Information</h3>
          <p className="text-xs text-gray-600 mt-0.5">Update customer details and address</p>
        </div>
      </div>

      <CardContent className="p-6 space-y-6">
        {/* Contact Section */}
        <div className="space-y-4">
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Contact Information</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">First Name</Label>
              <Input
                value={formData.billing_first_name}
                onChange={e => onUpdate('billing_first_name', e.target.value)}
                placeholder="First name"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Last Name</Label>
              <Input
                value={formData.billing_last_name}
                onChange={e => onUpdate('billing_last_name', e.target.value)}
                placeholder="Last name"
                className="h-9 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Company (Optional)</Label>
              <Input
                value={formData.billing_company}
                onChange={e => onUpdate('billing_company', e.target.value)}
                placeholder="Company name"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Email</Label>
              <Input
                type="email"
                value={formData.billing_email}
                onChange={e => onUpdate('billing_email', e.target.value)}
                placeholder="example@email.com"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Phone</Label>
              <Input
                value={formData.billing_phone}
                onChange={e => onUpdate('billing_phone', e.target.value)}
                placeholder="+216 71 234 567"
                className="h-9 text-sm"
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Address Section */}
        <div className="space-y-4">
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Billing Address</h4>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Street Address</Label>
              <Input
                value={formData.billing_address_1}
                onChange={e => onUpdate('billing_address_1', e.target.value)}
                placeholder="123 Main Street"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Address Line 2 (Optional)</Label>
              <Input
                value={formData.billing_address_2}
                onChange={e => onUpdate('billing_address_2', e.target.value)}
                placeholder="Apartment, suite, etc."
                className="h-9 text-sm"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">City</Label>
                <Input
                  value={formData.billing_city}
                  onChange={e => onUpdate('billing_city', e.target.value)}
                  placeholder="Tunis"
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">State/Province (Optional)</Label>
                <Input
                  value={formData.billing_state}
                  onChange={e => onUpdate('billing_state', e.target.value)}
                  placeholder="State"
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Postal Code</Label>
                <Input
                  value={formData.billing_postcode}
                  onChange={e => onUpdate('billing_postcode', e.target.value)}
                  placeholder="2000"
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Country</Label>
                <Select value={formData.billing_country} onValueChange={v => onUpdate('billing_country', v)}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map(c => (
                      <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 justify-end pt-4 border-t border-gray-200">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isSaving}
            className="gap-1.5 h-9"
          >
            <X className="size-4" /> Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={isSaving || !isValid}
            className="gap-1.5 h-9 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Check className="size-4" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* MAIN COMPONENT – Toggles between view and edit modes                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function BillingSection({
  order,
  editForm,
  isEditMode,
  onEditModeChange,
  onUpdateBilling,
  onSaveEdit,
  isSaving,
}: Readonly<{
  order: OrderDetail;
  editForm: OrderEditRequest;
  isEditMode: boolean;
  onEditModeChange: (isEdit: boolean) => void;
  onUpdateBilling: (field: keyof OrderEditRequest, value: string) => void;
  onSaveEdit: () => void;
  isSaving?: boolean;
}>) {
  if (isEditMode) {
    return (
      <BillingEditMode
        order={order}
        editForm={editForm}
        onUpdate={onUpdateBilling}
        onCancel={() => onEditModeChange(false)}
        onSave={onSaveEdit}
        isSaving={isSaving}
      />
    );
  }

  return <BillingViewMode order={order} onEdit={() => onEditModeChange(true)} />;
}
