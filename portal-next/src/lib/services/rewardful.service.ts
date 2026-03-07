/**
 * Rewardful API Service
 *
 * Handles all communication with the Rewardful API.
 * Implements rate limiting, retry logic, and caching.
 */

import { config } from '@/lib/config';
import { logger } from '@/lib/utils/logger';
import { sleep } from '@/lib/utils';

const log = logger.child({ service: 'rewardful' });

// ============================================================================
// TYPES
// ============================================================================

interface RewardfulAffiliate {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  state: string;
  campaign_id?: string;
  commission_stats?: {
    currencies?: {
      CAD?: {
        unpaid?: { cents: number };
        due?: { cents: number };
        paid?: { cents: number };
      };
      USD?: {
        unpaid?: { cents: number };
        due?: { cents: number };
        paid?: { cents: number };
      };
    };
  };
}

interface RewardfulReferral {
  id: string;
  conversion_state: string;
  created_at: string;
  became_lead_at?: string;
  became_conversion_at?: string;
  sale_occurred_at?: string;
  first_click_at?: string;
  customer?: {
    name?: string;
    email?: string;
  };
  link?: {
    url?: string;
  };
}

interface RewardfulCampaign {
  id: string;
  name: string;
  commission_percent?: number;
  default_commission_percent?: number;
  cookie_days?: number;
}

// ============================================================================
// API CLIENT
// ============================================================================

class RewardfulApiClient {
  private baseUrl: string;
  private apiKey: string;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor() {
    this.baseUrl = config.rewardful.baseUrl;
    this.apiKey = config.rewardful.apiKey;
    this.maxRetries = config.rewardful.maxRetries;
    this.retryDelayMs = config.rewardful.retryDelayMs;
  }

  /**
   * Make an authenticated request to Rewardful API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    // Rewardful API uses HTTP Basic Auth with API key as username, empty password
    const basicAuth = Buffer.from(`${this.apiKey}:`).toString('base64');
    const headers = {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        log.debug('API request', { url, attempt });

        const response = await fetch(url, {
          ...options,
          headers,
        });

        // Handle rate limiting
        if (response.status === 429) {
          const delay = this.retryDelayMs * Math.pow(2, attempt);
          log.warn('Rate limited, retrying', { delay, attempt });
          await sleep(delay);
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error ${response.status}: ${errorText}`);
        }

        return await response.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        log.error('API request failed', { error: lastError.message, attempt });

        if (attempt < this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(2, attempt);
          await sleep(delay);
        }
      }
    }

    throw lastError || new Error('API request failed');
  }

  /**
   * Get affiliate by email
   */
  async getAffiliateByEmail(
    email: string
  ): Promise<{ success: boolean; affiliate?: RewardfulAffiliate; error?: string }> {
    try {
      const response = await this.request<{ data?: RewardfulAffiliate[]; id?: string }>(
        `/affiliates?email=${encodeURIComponent(email)}`
      );

      let affiliate: RewardfulAffiliate | undefined;

      if (Array.isArray(response)) {
        affiliate = response.find(
          (a) => a.email.toLowerCase() === email.toLowerCase()
        );
        if (!affiliate && response.length > 0) affiliate = response[0];
      } else if (response.data && Array.isArray(response.data)) {
        affiliate = response.data.find(
          (a) => a.email.toLowerCase() === email.toLowerCase()
        );
        if (!affiliate && response.data.length > 0) affiliate = response.data[0];
      } else if (response.id) {
        affiliate = response as unknown as RewardfulAffiliate;
      }

      if (!affiliate) {
        return { success: false, error: 'Affiliate not found' };
      }

      return { success: true, affiliate };
    } catch (error) {
      log.error('Get affiliate error', { error, email });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch affiliate',
      };
    }
  }

  /**
   * Try multiple email variants to find an affiliate.
   * Handles legacy % encoding in internal emails.
   */
  async findAffiliateByEmails(
    emails: string[]
  ): Promise<{ success: boolean; affiliate?: RewardfulAffiliate }> {
    const tried = new Set<string>();
    for (const raw of emails) {
      if (!raw) continue;
      const e = raw.toLowerCase().trim();
      if (tried.has(e)) continue;
      tried.add(e);

      const result = await this.getAffiliateByEmail(e);
      if (result.success && result.affiliate) return result;

      // If email contains %, also try with % removed (legacy encoding artifact)
      if (e.includes('%')) {
        const cleaned = e.replace(/%/g, '');
        if (!tried.has(cleaned)) {
          tried.add(cleaned);
          const r2 = await this.getAffiliateByEmail(cleaned);
          if (r2.success && r2.affiliate) return r2;
        }
      }
    }
    return { success: false };
  }

  /**
   * Get affiliate by ID
   */
  async getAffiliateById(
    id: string
  ): Promise<{ success: boolean; affiliate?: RewardfulAffiliate; error?: string }> {
    try {
      const affiliate = await this.request<RewardfulAffiliate>(`/affiliates/${id}`);
      return { success: true, affiliate };
    } catch (error) {
      log.error('Get affiliate by ID error', { error, id });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch affiliate',
      };
    }
  }

  /**
   * Get commission totals for an affiliate
   */
  async getCommissionTotals(
    affiliateId: string
  ): Promise<{ unpaid: number; dueNow: number; paid: number }> {
    try {
      // CRITICAL: Must use ?expand=true to get commission_stats in the response
      const affiliate = await this.request<RewardfulAffiliate>(
        `/affiliates/${affiliateId}?expand=true`
      );

      const stats = affiliate.commission_stats?.currencies;
      if (!stats) {
        return { unpaid: 0, dueNow: 0, paid: 0 };
      }

      const conversionRate = config.currency.usdToCadRate;

      // GAS logic: Use CAD first, fall back to USD — NEVER sum both
      // (legacy: var currData = currencies['CAD'] || currencies['USD'] || currencies[first])
      const currData = stats.CAD || stats.USD;
      const isUsd = !stats.CAD && !!stats.USD;

      if (!currData) {
        return { unpaid: 0, dueNow: 0, paid: 0 };
      }

      let unpaid = (currData.unpaid?.cents || 0) / 100;
      let dueNow = (currData.due?.cents || 0) / 100;
      let paid = (currData.paid?.cents || 0) / 100;

      // Only convert if we're using USD and target is CAD
      if (isUsd) {
        unpaid = unpaid * conversionRate;
        dueNow = dueNow * conversionRate;
        paid = paid * conversionRate;
      }

      return {
        unpaid: Math.round(unpaid * 100) / 100,
        dueNow: Math.round(dueNow * 100) / 100,
        paid: Math.round(paid * 100) / 100,
      };
    } catch (error) {
      log.error('Get commission totals error', { error, affiliateId });
      return { unpaid: 0, dueNow: 0, paid: 0 };
    }
  }

  /**
   * Get 30-day commission totals for an affiliate
   * Legacy: calculate30DaysRawByAffiliateId_(affiliateId, apiKey)
   *
   * Fetches individual commissions from /commissions endpoint,
   * filters to last 30 days, sums approved/confirmed amounts.
   */
  async getCommissions30Day(
    affiliateId: string
  ): Promise<{ unpaid: number; dueNow: number }> {
    const conversionRate = config.currency.usdToCadRate;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
      const allCommissions: Record<string, unknown>[] = [];
      let page = 1;
      const maxPages = 20;

      while (page <= maxPages) {
        const response = await this.request<unknown>(
          `/commissions?affiliate_id=${encodeURIComponent(affiliateId)}&page=${page}&limit=200`
        );

        // Handle both array and { data: [...] } response formats
        let pageItems: Record<string, unknown>[] = [];
        if (Array.isArray(response)) {
          pageItems = response;
        } else if (response && typeof response === 'object') {
          const obj = response as Record<string, unknown>;
          if (Array.isArray(obj.data)) {
            pageItems = obj.data;
          }
        }

        if (pageItems.length === 0) break;

        allCommissions.push(...pageItems);

        // If fewer than 200, we reached the end
        if (pageItems.length < 200) break;
        page++;
      }

      // Filter to last 30 days and sum approved/confirmed
      let unpaid30 = 0;
      let dueNow30 = 0;

      for (const c of allCommissions) {
        const createdAt = (c.created_at || c.date) as string | undefined;
        if (!createdAt) continue;

        const commDate = new Date(createdAt);
        if (commDate < thirtyDaysAgo) continue;

        // Only count approved/confirmed commissions (not pending)
        const status = ((c.state || c.status || '') as string).toLowerCase();
        if (status !== 'approved' && status !== 'confirmed') continue;

        let amount = Number(c.amount || c.commission_amount || 0);

        // Convert from cents if needed (large integers)
        if (Number.isInteger(amount) && Math.abs(amount) >= 100) {
          amount = amount / 100;
        }

        // Convert USD to CAD if needed
        const currIso = ((c.currency || c.currency_iso || 'USD') as string).toUpperCase();
        if (currIso === 'USD') {
          amount = amount * conversionRate;
        }

        unpaid30 += amount;
        dueNow30 += amount; // Approved/confirmed are both unpaid AND due now
      }

      return {
        unpaid: Math.round(unpaid30 * 100) / 100,
        dueNow: Math.round(dueNow30 * 100) / 100,
      };
    } catch (error) {
      log.error('Get 30-day commissions error', { error, affiliateId });
      return { unpaid: 0, dueNow: 0 };
    }
  }

  /**
   * Get all referrals for an affiliate
   */
  async getReferrals(
    affiliateId: string,
    page: number = 1,
    perPage: number = 100
  ): Promise<{ success: boolean; referrals: RewardfulReferral[]; hasMore: boolean }> {
    try {
      // CRITICAL: Rewardful uses 'limit', not 'per_page'
      // (legacy code comment: "Rewardful uses 'limit', not 'per_page'")
      const response = await this.request<unknown>(
        `/referrals?affiliate_id=${affiliateId}&page=${page}&limit=${perPage}`
      );

      // Rewardful may return array directly OR wrapped in { data: [...] }
      let referrals: RewardfulReferral[] = [];
      if (Array.isArray(response)) {
        referrals = response;
      } else if (response && typeof response === 'object') {
        const obj = response as Record<string, unknown>;
        if (Array.isArray(obj.data)) {
          referrals = obj.data;
        } else if (Array.isArray(obj.referrals)) {
          referrals = obj.referrals as RewardfulReferral[];
        }
      }

      // If we got a full page, there might be more
      const hasMore = referrals.length >= perPage;

      return { success: true, referrals, hasMore };
    } catch (error) {
      log.error('Get referrals error', { error, affiliateId });
      return { success: false, referrals: [], hasMore: false };
    }
  }

  /**
   * Get all referrals with pagination
   */
  async getAllReferrals(affiliateId: string): Promise<RewardfulReferral[]> {
    const allReferrals: RewardfulReferral[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const result = await this.getReferrals(affiliateId, page);
      allReferrals.push(...result.referrals);
      hasMore = result.hasMore && result.referrals.length > 0;
      page++;

      // Safety limit
      if (page > 50) break;
    }

    return allReferrals;
  }

  /**
   * Get all campaigns
   */
  async getCampaigns(): Promise<{ success: boolean; campaigns: RewardfulCampaign[] }> {
    try {
      const response = await this.request<{ data?: RewardfulCampaign[] }>(
        '/campaigns?per_page=100'
      );

      const campaigns = response.data || [];
      return { success: true, campaigns };
    } catch (error) {
      log.error('Get campaigns error', { error });
      return { success: false, campaigns: [] };
    }
  }

  /**
   * Get all affiliates with pagination (for teacher list)
   */
  async getAllAffiliates(
    filter?: (affiliate: RewardfulAffiliate) => boolean
  ): Promise<RewardfulAffiliate[]> {
    const allAffiliates: RewardfulAffiliate[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const response = await this.request<{
          data?: RewardfulAffiliate[];
          pagination?: { has_more: boolean };
        }>(`/affiliates?page=${page}&limit=200&state[]=active&state[]=pending&state[]=inactive`);

        // Handle both { data: [...] } and direct array response formats
        const affiliates = Array.isArray(response)
          ? (response as unknown as RewardfulAffiliate[])
          : response.data || [];
        const filtered = filter ? affiliates.filter(filter) : affiliates;
        allAffiliates.push(...filtered);

        hasMore = affiliates.length > 0;
        page++;

        // Safety limit (20 pages * 200 = 4000 affiliates max, matching GAS)
        if (page > 20) break;
      } catch (error) {
        log.error('Get all affiliates error', { error, page });
        break;
      }
    }

    return allAffiliates;
  }

  /**
   * Create new affiliate
   */
  async createAffiliate(data: {
    email: string;
    first_name: string;
    last_name: string;
    campaign_id?: string;
    paypal_email?: string;
    state?: string;
  }): Promise<{ success: boolean; affiliate?: RewardfulAffiliate; error?: string }> {
    try {
      const affiliate = await this.request<RewardfulAffiliate>('/affiliates', {
        method: 'POST',
        body: JSON.stringify(data),
      });

      return { success: true, affiliate };
    } catch (error) {
      log.error('Create affiliate error', { error, email: data.email });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create affiliate',
      };
    }
  }
}

// Export singleton instance
export const rewardfulApi = new RewardfulApiClient();
