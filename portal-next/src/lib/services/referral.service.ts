/**
 * Referral Service
 *
 * Handles leads and conversions tracking from Rewardful.
 */

import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/config';
import { logger } from '@/lib/utils/logger';
import { getSessionUser } from './session.service';
import { rewardfulApi } from './rewardful.service';
import type { ApiResponse, ReferralsResponse, ReferralRow, ReferralsParams } from '@/types';

const log = logger.child({ service: 'referral' });

// ============================================================================
// REFERRAL CLASSIFICATION
// ============================================================================

interface RawReferral {
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

/**
 * Check if referral is a visitor (no meaningful engagement)
 */
function isVisitor(ref: RawReferral): boolean {
  const state = (ref.conversion_state || '').toLowerCase();
  return state === 'visitor' || (!ref.became_lead_at && !ref.sale_occurred_at);
}

/**
 * Check if referral is a lead
 */
function isLead(ref: RawReferral): boolean {
  if (isVisitor(ref)) return false;
  if (isConversion(ref)) return false;

  const state = (ref.conversion_state || '').toLowerCase();
  return state === 'lead' || !!ref.became_lead_at;
}

/**
 * Check if referral is a conversion
 */
function isConversion(ref: RawReferral): boolean {
  const state = (ref.conversion_state || '').toLowerCase();
  return (
    state === 'conversion' ||
    !!ref.sale_occurred_at ||
    !!ref.became_conversion_at
  );
}

/**
 * Prepare referral row for display
 */
function prepareReferralRow(ref: RawReferral): ReferralRow {
  const conv = isConversion(ref);
  const lead = isLead(ref);
  const convertedAt = ref.became_conversion_at || ref.sale_occurred_at || null;

  return {
    id: ref.id.toString().slice(-6),
    state: conv ? 'conversion' : 'lead',
    createdAt: ref.created_at || '',
    firstClickAt: ref.first_click_at || ref.created_at || '',
    becameLeadAt: ref.became_lead_at || ref.created_at || '',
    becameConversionAt: convertedAt,
    convertedAt,
    isConversion: conv,
    isLead: lead,
  };
}

// ============================================================================
// REFERRAL DATA
// ============================================================================

/**
 * Get referral data (basic)
 * Legacy: getReferralData(email, forceRefresh)
 */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getReferralData(
  email: string,
  forceRefresh?: boolean
): Promise<ApiResponse & {
  totalLeads?: number;
  previousCount?: number;
  deltaSinceLastFetch?: number;
  leads?: ReferralRow[];
}> {
  const normalizedEmail = normalizeEmail(email);

  // Lift cached outside try so it's available in catch
  let cached: Awaited<ReturnType<typeof prisma.referralCache.findUnique>> = null;

  try {
    cached = await prisma.referralCache.findUnique({
      where: { email: normalizedEmail },
    });

    // Return cached data if fresh enough and not forcing refresh
    if (!forceRefresh && cached?.cachedAt && cached.cachedReferralData) {
      const age = Date.now() - cached.cachedAt.getTime();
      if (age < CACHE_TTL_MS) {
        try {
          const leads: ReferralRow[] = JSON.parse(cached.cachedReferralData);
          return {
            success: true,
            totalLeads: cached.lastKnownLeadCount,
            previousCount: cached.previousLeadCount,
            deltaSinceLastFetch: 0,
            leads,
          };
        } catch { /* parse failed, refetch */ }
      }
    }

    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    const emailCandidates = [
      user?.internalEmail || '',
      normalizedEmail,
      user?.aliasEmail || '',
    ].filter(Boolean);

    const affiliateResult = await rewardfulApi.findAffiliateByEmails(emailCandidates);
    if (!affiliateResult.success || !affiliateResult.affiliate) {
      return {
        success: true,
        totalLeads: 0,
        previousCount: 0,
        deltaSinceLastFetch: 0,
        leads: [],
      };
    }

    const referrals = await rewardfulApi.getAllReferrals(affiliateResult.affiliate.id);
    const validReferrals = referrals.filter((r) => !isVisitor(r as RawReferral));

    const leadsCount = validReferrals.filter((r) => isLead(r as RawReferral)).length;
    const conversionsCount = validReferrals.filter((r) =>
      isConversion(r as RawReferral)
    ).length;

    const totalCount = leadsCount + conversionsCount;
    const previousCount = cached?.lastKnownLeadCount || 0;
    const delta = totalCount - previousCount;

    const leads = validReferrals.map((r) => prepareReferralRow(r as RawReferral));

    // Cache the full result for fast subsequent loads
    await prisma.referralCache.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        affiliateId: affiliateResult.affiliate.id,
        lastKnownLeadCount: leadsCount,
        lastKnownConversionCount: conversionsCount,
        previousLeadCount: previousCount,
        lastSuccessfulFetchAt: new Date(),
        lastFetchedAt: new Date(),
        cachedReferralData: JSON.stringify(leads),
        cachedAt: new Date(),
      },
      update: {
        affiliateId: affiliateResult.affiliate.id,
        lastKnownLeadCount: leadsCount,
        lastKnownConversionCount: conversionsCount,
        previousLeadCount: previousCount,
        lastSuccessfulFetchAt: new Date(),
        lastFetchedAt: new Date(),
        cachedReferralData: JSON.stringify(leads),
        cachedAt: new Date(),
      },
    });

    return {
      success: true,
      totalLeads: totalCount,
      previousCount,
      deltaSinceLastFetch: delta,
      leads,
    };
  } catch (error) {
    // On error, try returning cached data if available
    if (cached?.cachedReferralData) {
      try {
        const leads: ReferralRow[] = JSON.parse(cached.cachedReferralData);
        return {
          success: true,
          totalLeads: cached.lastKnownLeadCount,
          previousCount: cached.previousLeadCount,
          deltaSinceLastFetch: 0,
          leads,
        };
      } catch { /* fall through */ }
    }
    log.error('Get referral data error', { error, email: normalizedEmail });
    return { success: false, error: 'Failed to fetch referral data' };
  }
}

/**
 * Get cached referral counts (fast, no API calls).
 * Used by admin dashboard for instant count display.
 */
export async function getCachedReferralCounts(
  email: string
): Promise<{ leadsCount: number; conversionsCount: number; affiliateId?: string }> {
  const normalizedEmail = normalizeEmail(email);

  try {
    // Check by alias email
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
      select: { internalEmail: true, aliasEmail: true },
    });

    // Try cache by alias email first, then internal email
    const emailsToTry = [normalizedEmail, user?.internalEmail].filter(Boolean) as string[];

    for (const e of emailsToTry) {
      const cached = await prisma.referralCache.findUnique({
        where: { email: e },
      });
      if (cached && cached.cachedAt) {
        return {
          leadsCount: cached.lastKnownLeadCount,
          conversionsCount: cached.lastKnownConversionCount,
          affiliateId: cached.affiliateId || undefined,
        };
      }
    }

    return { leadsCount: 0, conversionsCount: 0 };
  } catch {
    return { leadsCount: 0, conversionsCount: 0 };
  }
}

/**
 * Get referrals with mode filter and pagination
 * Legacy: getReferralsWithMode(params)
 */
export async function getReferralsWithMode(
  params: ReferralsParams
): Promise<ReferralsResponse | { success: false; error: string }> {
  const { email, mode = 'leads', page = 1, pageSize = 25 } = params;
  const normalizedEmail = normalizeEmail(email);

  try {
    const data = await getReferralData(normalizedEmail);

    if (!data.success) {
      return {
        success: false,
        error: data.error || 'Failed to fetch referrals',
      };
    }

    const allReferrals = data.leads || [];

    // Filter by mode
    const filteredRows =
      mode === 'conversions'
        ? allReferrals.filter((r) => r.isConversion)
        : allReferrals.filter((r) => r.isLead);

    // Count totals
    const leadsCount = allReferrals.filter((r) => r.isLead).length;
    const conversionsCount = allReferrals.filter((r) => r.isConversion).length;

    // Paginate
    const totalCount = filteredRows.length;
    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    const safePage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (safePage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalCount);
    const rows = filteredRows.slice(startIndex, endIndex);

    return {
      success: true,
      rows,
      totalCount,
      page: safePage,
      pageSize,
      totalPages,
      mode,
      leadsCount,
      conversionsCount,
    };
  } catch (error) {
    log.error('Get referrals with mode error', { error });
    return { success: false, error: 'Failed to fetch referrals' };
  }
}

/**
 * Same as getReferralsWithMode but forces a fresh API pull (bypasses cache)
 */
export async function getReferralsWithModeRefresh(
  params: ReferralsParams
): Promise<ReferralsResponse | { success: false; error: string }> {
  const { email, mode = 'leads', page = 1, pageSize = 25 } = params;
  const normalizedEmail = normalizeEmail(email);

  try {
    const data = await getReferralData(normalizedEmail, true);
    if (!data.success) {
      return { success: false, error: data.error || 'Failed to fetch referrals' };
    }

    const allReferrals = data.leads || [];
    const filteredRows = mode === 'conversions'
      ? allReferrals.filter((r) => r.isConversion)
      : allReferrals.filter((r) => r.isLead);

    const leadsCount = allReferrals.filter((r) => r.isLead).length;
    const conversionsCount = allReferrals.filter((r) => r.isConversion).length;

    const totalCount = filteredRows.length;
    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    const safePage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (safePage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalCount);
    const rows = filteredRows.slice(startIndex, endIndex);

    return { success: true, rows, totalCount, page: safePage, pageSize, totalPages, mode, leadsCount, conversionsCount };
  } catch (error) {
    log.error('Get referrals with mode (refresh) error', { error });
    return { success: false, error: 'Failed to fetch referrals' };
  }
}

/**
 * Get student referrals for teacher
 * Legacy: getStudentReferralsForTeacher(teacher, student, mode, page, pageSize)
 */
export async function getStudentReferralsForTeacher(
  teacherEmail: string,
  studentEmail: string,
  mode: 'leads' | 'conversions',
  page: number,
  pageSize: number
): Promise<ReferralsResponse | { success: false; error: string }> {
  const normalizedTeacher = normalizeEmail(teacherEmail);
  const normalizedStudent = normalizeEmail(studentEmail);

  // Verify teacher-student link
  const teacher = await prisma.user.findUnique({
    where: { aliasEmail: normalizedTeacher },
  });

  const student = await prisma.user.findUnique({
    where: { aliasEmail: normalizedStudent },
  });

  if (!teacher || !student) {
    return { success: false, error: 'Teacher or student not found' };
  }

  const link = await prisma.teacherStudentLink.findFirst({
    where: {
      teacherId: teacher.id,
      studentId: student.id,
      status: 'ACTIVE',
    },
  });

  if (!link) {
    return { success: false, error: 'You are not authorized to view this student\'s data' };
  }

  // Authorized - fetch referrals
  return getReferralsWithMode({
    email: normalizedStudent,
    mode,
    page,
    pageSize,
  });
}
