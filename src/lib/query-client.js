import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: 2 * 60 * 1000,   // Data fresh for 2 minutes
			gcTime: 30 * 60 * 1000,      // Keep in cache for 30 minutes
		},
	},
});