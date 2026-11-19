import { requestCurrentSite } from '@/features/layout/api';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

export function useCurrentSite() {
  const { data, isError } = useQuery({
    queryKey: ['sites', 'current'],
    queryFn: ({ signal }) => requestCurrentSite(api, signal),
    staleTime: 60_000,
  });
  return isError ? undefined : data;
}
