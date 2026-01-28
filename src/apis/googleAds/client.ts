// Required env vars:
// GOOGLE_ADS_DEVELOPER_TOKEN,
// GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64,
// GOOGLE_ADS_LOGIN_CUSTOMER_ID or GOOGLE_ADS_CUSTOMER_ID
//
// Optional env vars:
// GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC manager account signing requests)
// GOOGLE_ADS_LINKED_CUSTOMER_ID (execute within linked account context).

import { JWT, type JWTInput } from 'google-auth-library';

interface GoogleAdsCredentials {
	developerToken: string;

	// For Service Account authentication:
	serviceAccountJson: JWTInput;

	// OAuth2 authentication:
	// clientId: string;
	// clientSecret: string;
	// refreshToken: string;

	customerId: string;
	loginCustomerId?: string;
	linkedCustomerId?: string;
}

const MAX_RETRIES = 50;

function normalizeCustomerId(id: string): string {
	return id.replace(/-/g, '');
}

function assertEnv(name: string): string {
	const value = Deno.env.get(name);
	if (!value) {
		throw new Error(`Environment variable ${name} is required to access the Google Ads API.`);
	}
	return value;
}

function getCredentialsFromEnv(): GoogleAdsCredentials {
	const developerToken = assertEnv('GOOGLE_ADS_DEVELOPER_TOKEN');

	// For Service Account authentication:
	const serviceAccountJson: JWTInput = JSON.parse(atob(assertEnv('GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64')));

	// For OAuth2 authentication:
	// const clientId = assertEnv('GOOGLE_ADS_CLIENT_ID');
	// const clientSecret = assertEnv('GOOGLE_ADS_CLIENT_SECRET');
	// const refreshToken = assertEnv('GOOGLE_ADS_REFRESH_TOKEN');

	const loginCustomerId = Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID');
	const linkedCustomerId = Deno.env.get('GOOGLE_ADS_LINKED_CUSTOMER_ID');
	const rawCustomerId = Deno.env.get('GOOGLE_ADS_CUSTOMER_ID') ?? loginCustomerId ?? '';
	const customerId = rawCustomerId.trim();
	if (!customerId) {
		throw new Error('Environment variable GOOGLE_ADS_CUSTOMER_ID is required to access the Google Ads API.');
	}

	return {
		developerToken,
		serviceAccountJson,
		customerId: normalizeCustomerId(customerId),
		loginCustomerId: loginCustomerId ? normalizeCustomerId(loginCustomerId) : undefined,
		linkedCustomerId: linkedCustomerId ? normalizeCustomerId(linkedCustomerId) : undefined
	};
}

let cachedClient: {
	client: (apiMethod: string, params: Record<string, unknown>) => Promise<unknown>;
	expiration: number;
} | null = null;

export async function createGoogleAdsClient() {
	if (cachedClient
		&& cachedClient.expiration
		&& cachedClient.expiration > Date.now() + 60000
	) {
		return cachedClient.client;
	}

	const credentials = getCredentialsFromEnv();

	const authClient = new JWT({
		email: credentials.serviceAccountJson.client_email,
		key: credentials.serviceAccountJson.private_key,
		scopes: ['https://www.googleapis.com/auth/adwords']
	});
	const { access_token, expiry_date: expiration } = await authClient.authorize();

	const client = async (apiMethod: string, params: Record<string, any>) => {
		let retries = MAX_RETRIES;
		while (retries > 0) {
			const response = await fetch(`https://googleads.googleapis.com/v21/customers/${credentials.customerId}:${apiMethod}`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${access_token}`,
					'Content-Type': 'application/json',
					'developer-token': credentials.developerToken,
					'customer_id': credentials.customerId,
					'login-customer-id': credentials.loginCustomerId ?? ''
				},
				body: JSON.stringify(params),
				signal: (globalThis as any).abortSignal // Pass through abort signal if available
			});

			if (!response.ok) {
				if (response.status === 429) {
					// Rate limit exceeded, retry after a delay
					const delay = ((MAX_RETRIES + 1) - retries) * 500; // Exponential backoff
					console.log('Rate limit exceeded, retrying after', delay, 'ms');
					await new Promise(res => setTimeout(res, delay));
					retries--;
					continue;
				}
				throw new Error(`Google Ads API error: ${response.statusText} (response code: ${response.status})`);
			}

			try {
				return response.json();
			} catch (error) {
				throw new Error(`Failed to parse Google Ads API response: ${error}`);
			}
		}
	};

	if (expiration != null) {
		cachedClient = { client, expiration };
	}

	return client;
}
