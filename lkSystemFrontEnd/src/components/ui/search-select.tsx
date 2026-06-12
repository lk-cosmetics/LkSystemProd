/**
 * SearchSelect – a lightweight, dependency-free combobox (type-to-filter).
 *
 * Built on a plain <Input> + a filtered list so we avoid pulling in
 * @radix-ui/react-popover or cmdk. Good for short canonical lists where the
 * user wants to *type a few letters and pick fast* (e.g. Tunisian
 * governorates). Closes on outside click or selection.
 *
 * Extracted from SalesChannelsPage so the order/client forms can reuse the
 * exact same behaviour.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

export interface SearchSelectOption {
  label: string;
  value: string;
}

interface SearchSelectProps {
  value: string;
  onChange: (v: string) => void;
  options: SearchSelectOption[];
  placeholder: string;
  disabled?: boolean;
  /** Extra classes for the text input (height, etc.). */
  className?: string;
}

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const selected = options.find(o => o.value === value);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (!open) setOpen(true);
  };

  const handleInputFocus = () => {
    setQuery('');
    setOpen(true);
  };

  const handleSelect = (opt: SearchSelectOption) => {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onChange('');
    setQuery('');
    setOpen(false);
  };

  const displayValue = open ? query : (selected?.label ?? '');

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          disabled={disabled}
          className={`pr-14 ${className ?? ''}`}
          autoComplete="off"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {value && !disabled && (
            <button
              type="button"
              onMouseDown={handleClear}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              <X className="size-3.5" />
            </button>
          )}
          <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {open && (
        <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No results found</p>
          ) : (
            filtered.map(opt => (
              <div
                key={opt.value}
                onMouseDown={e => { e.preventDefault(); handleSelect(opt); }}
                className={`px-3 py-2 text-sm cursor-pointer select-none transition-colors hover:bg-accent hover:text-accent-foreground ${
                  opt.value === value ? 'bg-accent/60 font-medium' : ''
                }`}
              >
                {opt.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
