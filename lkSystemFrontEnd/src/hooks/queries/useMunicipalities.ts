/**
 * useMunicipalities – fetches Tunisian governorates and their delegations
 * from the public municipality API. Data is treated as static (never expires).
 *
 * API: https://tn-municipality-api.vercel.app/api/municipalities
 * Shape: Array<{ Name, Value, Delegations: Array<{ Name, Value, PostalCode }> }>
 */

import { useQuery } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Delegation {
  name: string;
  value: string;
  postalCode: string;
}

export interface Governorate {
  name: string;
  value: string;
  delegations: Delegation[];
}

interface RawDelegation {
  Name: string;
  Value: string;
  PostalCode?: string;
}

interface RawGovernorate {
  Name: string;
  Value: string;
  Delegations: RawDelegation[];
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

const MUNICIPALITIES_URL = 'https://tn-municipality-api.vercel.app/api/municipalities';

async function fetchMunicipalities(): Promise<Governorate[]> {
  const res = await fetch(MUNICIPALITIES_URL);
  if (!res.ok) throw new Error('Failed to fetch municipalities');

  const raw: RawGovernorate[] = await res.json();

  // Deduplicate delegation values within each governorate and normalize shape
  return raw.map(gov => {
    const seen = new Set<string>();
    const delegations: Delegation[] = [];

    for (const d of gov.Delegations) {
      if (!seen.has(d.Value)) {
        seen.add(d.Value);
        delegations.push({
          name: d.Name,
          value: d.Value,
          postalCode: d.PostalCode ?? '',
        });
      }
    }

    // Sort delegations alphabetically
    delegations.sort((a, b) => a.value.localeCompare(b.value));

    return {
      name: gov.Name,
      value: gov.Value,
      delegations,
    };
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMunicipalities() {
  return useQuery<Governorate[]>({
    queryKey: ['municipalities'],
    queryFn: fetchMunicipalities,
    staleTime: Infinity,   // static external data — never re-fetch automatically
    gcTime: Infinity,
    retry: 2,
  });
}

// ---------------------------------------------------------------------------
// Derived selectors (pure functions, no hook overhead)
// ---------------------------------------------------------------------------

/** Returns all governorates as label/value pairs for a select input. */
export function getGovernorateOptions(
  governorates: Governorate[]
): { label: string; value: string }[] {
  return governorates.map(g => ({ label: g.name, value: g.value }));
}

/** Returns delegation options for a given governorate value. */
export function getDelegationOptions(
  governorates: Governorate[],
  governorateValue: string
): { label: string; value: string }[] {
  const gov = governorates.find(g => g.value === governorateValue);
  if (!gov) return [];
  return gov.delegations.map(d => ({ label: d.name, value: d.value }));
}
