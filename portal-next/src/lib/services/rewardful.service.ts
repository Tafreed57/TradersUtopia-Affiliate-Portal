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

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
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

      // Handle both array and single object responses
      let affiliate: RewardfulAffiliate | undefined;

      if (Array.isArray(response)) {
        affiliate = response.find(
          (a) => a.email.toLowerCase() === email.toLowerCase()
        );
      } else if (response.data && Array.isArray(response.data)) {
        affiliate = response.data.find(
          (a) => a.email.toLowerCase() === email.toLowerCase()
        );
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
      const affiliate = await this.request<RewardfulAffiliate>(
        `/affiliates/${affiliateId}`
      );

      const stats = affiliate.commission_stats?.currencies;
      const cad = stats?.CAD || {};
      const usd = stats?.USD || {};

      // Prefer CAD, fall back to USD with conversion
      const conversionRate = config.currency.usdToCadRate;

      const unpaidCad = (cad.unpaid?.cents || 0) / 100;
      const unpaidUsd = ((usd.unpaid?.cents || 0) / 100) * conversionRate;

      const dueCad = (cad.due?.cents || 0) / 100;
      const dueUsd = ((usd.due?.cents || 0) / 100) * conversionRate;

      const paidCad = (cad.paid?.cents || 0) / 100;
      const paidUsd = ((usd.paid?.cents || 0) / 100) * conversionRate;

      return {
        unpaid: unpaidCad || unpaidUsd,
        dueNow: dueCad || dueUsd,
        paid: paidCad || paidUsd,
      };
    } catch (error) {
      log.error('Get commission totals error', { error, affiliateId });
      return { unpaid: 0, dueNow: 0, paid: 0 };
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
      const response = await this.request<{
        data: RewardfulReferral[];
        pagination?: { has_more: boolean };
      }>(`/affiliates/${affiliateId}/referrals?page=${page}&per_page=${perPage}`);

      const referrals = response.data || [];
      const hasMore = response.pagination?.has_more || referrals.length >= perPage;

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
        }>(`/affiliates?page=${page}&per_page=100`);

        const affiliates = response.data || [];
        const filtered = filter ? affiliates.filter(filter) : affiliates;
        allAffiliates.push(...filtered);

        hasMore =
          (response.pagination?.has_more || affiliates.length >= 100) &&
          affiliates.length > 0;
        page++;

        // Safety limit
        if (page > 100) break;
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
