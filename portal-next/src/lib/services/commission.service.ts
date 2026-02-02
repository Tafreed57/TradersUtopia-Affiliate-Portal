/**
 * Commission Service
 *
 * Handles affiliate commission lookup and admin overrides.
 * Integrates with the Rewardful API.
 */

import { prisma } from '@/lib/db';
import { config, normalizeEmail, isAdminEmail } from '@/lib/config';
import { logger } from '@/lib/utils/logger';
import { getSessionUser, validateAdminSession } from './session.service';
import { rewardfulApi } from './rewardful.service';
import type { ApiResponse, CommissionData } from '@/types';

const log = logger.child({ service: 'commission' });

// ============================================================================
// COMMISSION LOOKUP
// ============================================================================

/**
 * Lookup affiliate commission data
 * Legacy: lookupAffiliate(email, sessionToken)
 */
export async function lookupAffiliate(
  email: string,
  sessionToken?: string
): Promise<ApiResponse & { data?: CommissionData }> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return { success: false, error: 'Email is required' };
  }

  log.info('Looking up affiliate', { email: normalizedEmail });

  try {
    // Resolve email - check if this is an alias and get internal email
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
      select: { internalEmail: true, aliasEmail: true },
    });

    const emailForApi = user?.internalEmail || normalizedEmail;
    const displayEmail = user?.aliasEmail || normalizedEmail;

    // Fetch from Rewardful API
    const affiliateResult = await rewardfulApi.getAffiliateByEmail(emailForApi);

    if (!affiliateResult.success || !affiliateResult.affiliate) {
      return {
        success: false,
        error: 'Affiliate not found in the system',
      };
    }

    const affiliate = affiliateResult.affiliate;

    // Get commission totals
    const commissionResult = await rewardfulApi.getCommissionTotals(affiliate.id);

    // Get tracking data for incremental calculation
    let tracking = await prisma.commissionTracking.findUnique({
      where: { email: normalizedEmail },
    });

    // Get admin override if exists
    const override = await prisma.commissionOverride.findFirst({
      where: { user: { aliasEmail: normalizedEmail } },
    });

    // Calculate amounts
    const rawUnpaid = commissionResult.unpaid || 0;
    const rawDueNow = commissionResult.dueNow || 0;
    const rawPaid = commissionResult.paid || 0;

    // Apply percentage if applicable (from email pattern like user100%@)
    let percentage = 100;
    let percentageApplied = false;

    const percentMatch = emailForApi.match(/(\d+)%/);
    if (percentMatch) {
      percentage = parseInt(percentMatch[1], 10);
      percentageApplied = true;
    }

    const multiplier = percentage / 100;

    // Calculate displayed amounts (with percentage applied)
    let unpaidAmount = rawUnpaid * multiplier;
    let dueNowAmount = rawDueNow * multiplier;
    let totalPaidAmount = rawPaid * multiplier;

    // Apply override if exists
    if (override) {
      if (override.unpaidAmount !== null) unpaidAmount = override.unpaidAmount;
      if (override.dueNowAmount !== null) dueNowAmount = override.dueNowAmount;
      if (override.totalPaidAmount !== null) totalPaidAmount = override.totalPaidAmount;
    }

    // Calculate delta from last fetch
    const lastApiAmount = tracking?.lastApiAmount || 0;
    const deltaAmount = rawUnpaid - lastApiAmount;

    // Update tracking
    await prisma.commissionTracking.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        lastApiAmount: rawUnpaid,
        lastDisplayedAmount: unpaidAmount,
        lastFetchedAt: new Date(),
      },
      update: {
        lastApiAmount: rawUnpaid,
        lastDisplayedAmount: unpaidAmount,
        lastFetchedAt: new Date(),
      },
    });

    const data: CommissionData = {
      email: normalizedEmail,
      displayEmail,
      name: `${affiliate.first_name || ''} ${affiliate.last_name || ''}`.trim() || normalizedEmail,
      affiliateId: affiliate.id,

      unpaidAmount,
      dueNowAmount,
      totalPaidAmount,

      rawUnpaid,
      rawDueNow,
      rawPaid,

      percentage,
      percentageApplied,

      deltaAmount,
      lastApiAmount,
      lastDisplayedAmount: unpaidAmount,

      hasOverride: !!override,
      overrideNote: override?.note || undefined,

      currency: 'CAD',
      conversionRate: config.currency.usdToCadRate,

      lastFetchedAt: Date.now(),
      fromCache: false,
    };

    return { success: true, data };
  } catch (error) {
    log.error('Lookup affiliate error', { error, email: normalizedEmail });
    return { success: false, error: 'Failed to fetch commission data' };
  }
}

// ============================================================================
// ADMIN OVERRIDES
// ============================================================================

/**
 * Get existing override for an affiliate
 * Legacy: getExistingOverride(email)
 */
export async function getExistingOverride(
  email: string
): Promise<{ hasOverride: boolean; override?: object }> {
  const normalizedEmail = normalizeEmail(email);

  const override = await prisma.commissionOverride.findFirst({
    where: { user: { aliasEmail: normalizedEmail } },
  });

  if (!override) {
    return { hasOverride: false };
  }

  return {
    hasOverride: true,
    override: {
      unpaidAmount: override.unpaidAmount,
      dueNowAmount: override.dueNowAmount,
      totalPaidAmount: override.totalPaidAmount,
      note: override.note,
      reason: override.reason,
      setBy: override.setBy,
      setAt: override.setAt?.toISOString(),
    },
  };
}

/**
 * Get raw API data (admin debug)
 * Legacy: getRawApiData(email)
 */
export async function getRawApiData(email: string): Promise<ApiResponse> {
  const normalizedEmail = normalizeEmail(email);

  try {
    const result = await rewardfulApi.getAffiliateByEmail(normalizedEmail);
    return { success: true, rawData: result };
  } catch (error) {
    return { success: false, error: 'Failed to fetch raw data' };
  }
}

/**
 * Save admin override
 * Legacy: saveAdminOverride(email, data, token)
 */
export async function saveAdminOverride(
  email: string,
  data: {
    unpaidAmount?: number;
    dueNowAmount?: number;
    totalPaidAmount?: number;
    note?: string;
    reason?: string;
  },
  token: string
): Promise<ApiResponse> {
  // Validate admin
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized - admin only' };
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    // Find user
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Get admin email
    const { user: adminUser } = await getSessionUser(token);

    // Upsert override
    await prisma.commissionOverride.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        unpaidAmount: data.unpaidAmount,
        dueNowAmount: data.dueNowAmount,
        totalPaidAmount: data.totalPaidAmount,
        note: data.note,
        reason: data.reason,
        setBy: adminUser?.aliasEmail,
        setAt: new Date(),
      },
      update: {
        unpaidAmount: data.unpaidAmount,
        dueNowAmount: data.dueNowAmount,
        totalPaidAmount: data.totalPaidAmount,
        note: data.note,
        reason: data.reason,
        setBy: adminUser?.aliasEmail,
        setAt: new Date(),
      },
    });

    log.info('Admin override saved', { email: normalizedEmail, admin: adminUser?.aliasEmail });

    return { success: true, message: 'Override saved' };
  } catch (error) {
    log.error('Save override error', { error });
    return { success: false, error: 'Failed to save override' };
  }
}

/**
 * Remove admin override
 * Legacy: removeAdminOverride(email, token)
 */
export async function removeAdminOverride(
  email: string,
  token: string
): Promise<ApiResponse> {
  // Validate admin
  const isAdmin = await validateAdminSession(token);
  if (!isAdmin) {
    return { success: false, error: 'Unauthorized - admin only' };
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    await prisma.commissionOverride.deleteMany({
      where: { userId: user.id },
    });

    log.info('Admin override removed', { email: normalizedEmail });

    return { success: true, message: 'Override removed' };
  } catch (error) {
    log.error('Remove override error', { error });
    return { success: false, error: 'Failed to remove override' };
  }
}
