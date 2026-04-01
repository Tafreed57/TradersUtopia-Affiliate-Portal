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

// ============================================================================
// PROGRESSIVE CACHE BUILDER
// ============================================================================

/**
 * Resolve affiliate ID for an email (with multi-email lookup).
 * Caches the affiliateId for future calls.
 */
async function resolveAffiliateId(normalizedEmail: string): Promise<string | null> {
  // Check if we already have it cached
  const cached = await prisma.referralCache.findUnique({ where: { email: normalizedEmail } });
  if (cached?.affiliateId) return cached.affiliateId;

  const user = await prisma.user.findUnique({ where: { aliasEmail: normalizedEmail } });
  const emailCandidates = [user?.internalEmail || '', normalizedEmail, user?.aliasEmail || ''].filter(Boolean);
  const result = await rewardfulApi.findAffiliateByEmails(emailCandidates);

  if (!result.success || !result.affiliate) return null;

  // Store affiliateId for fast future lookups
  await prisma.referralCache.upsert({
    where: { email: normalizedEmail },
    create: { email: normalizedEmail, affiliateId: result.affiliate.id },
    update: { affiliateId: result.affiliate.id },
  });

  return result.affiliate.id;
}

/**
 * Build ONE page of referral cache. Called repeatedly by the frontend.
 * Each call fetches a single page from Rewardful (~1-2s, never rate-limited).
 * Returns current totals and completeness status.
 */
export async function buildReferralCachePage(
  email: string
): Promise<ApiResponse & {
  leadsCount?: number; conversionsCount?: number;
  totalFetched?: number; complete?: boolean; page?: number;
}> {
  const normalizedEmail = normalizeEmail(email);

  try {
    const affiliateId = await resolveAffiliateId(normalizedEmail);
    if (!affiliateId) {
      return { success: true, leadsCount: 0, conversionsCount: 0, totalFetched: 0, complete: true, page: 0 };
    }

    const cached = await prisma.referralCache.findUnique({ where: { email: normalizedEmail } });

    // Already complete? Return current state.
    if (cached?.cacheComplete) {
      const existing: ReferralRow[] = cached.cachedReferralData ? JSON.parse(cached.cachedReferralData) : [];
      return {
        success: true,
        leadsCount: cached.lastKnownLeadCount,
        conversionsCount: cached.lastKnownConversionCount,
        totalFetched: existing.length,
        complete: true,
        page: cached.lastFetchedPage,
      };
    }

    const nextPage = (cached?.lastFetchedPage || 0) + 1;

    // Fetch just ONE page
    const pageResult = await rewardfulApi.getReferralPage(affiliateId, nextPage);

    if (pageResult.rateLimited) {
      // Rate limited - return what we have, don't advance page
      const existing: ReferralRow[] = cached?.cachedReferralData ? JSON.parse(cached.cachedReferralData) : [];
      return {
        success: true,
        leadsCount: cached?.lastKnownLeadCount || 0,
        conversionsCount: cached?.lastKnownConversionCount || 0,
        totalFetched: existing.length,
        complete: false,
        page: cached?.lastFetchedPage || 0,
      };
    }

    // Process new referrals
    const validNew = pageResult.referrals.filter((r) => !isVisitor(r as RawReferral));
    const newRows = validNew.map((r) => prepareReferralRow(r as RawReferral));

    // Merge with existing cached data
    const existingRows: ReferralRow[] = cached?.cachedReferralData ? JSON.parse(cached.cachedReferralData) : [];
    const allRows = [...existingRows, ...newRows];

    const leadsCount = allRows.filter((r) => r.isLead).length;
    const conversionsCount = allRows.filter((r) => r.isConversion).length;
    const isComplete = !pageResult.hasMore || pageResult.referrals.length === 0;

    await prisma.referralCache.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        affiliateId,
        lastKnownLeadCount: leadsCount,
        lastKnownConversionCount: conversionsCount,
        cachedReferralData: JSON.stringify(allRows),
        cachedAt: new Date(),
        lastFetchedPage: nextPage,
        cacheComplete: isComplete,
        lastSuccessfulFetchAt: new Date(),
        lastFetchedAt: new Date(),
      },
      update: {
        lastKnownLeadCount: leadsCount,
        lastKnownConversionCount: conversionsCount,
        cachedReferralData: JSON.stringify(allRows),
        cachedAt: new Date(),
        lastFetchedPage: nextPage,
        cacheComplete: isComplete,
        lastSuccessfulFetchAt: new Date(),
        lastFetchedAt: new Date(),
      },
    });

    return {
      success: true,
      leadsCount,
      conversionsCount,
      totalFetched: allRows.length,
      complete: isComplete,
      page: nextPage,
    };
  } catch (error) {
    log.error('Build referral cache page error', { error, email: normalizedEmail });
    return { success: false, error: 'Failed to fetch referral page' };
  }
}

/**
 * Reset referral cache for a user (used before a full refresh).
 */
export async function resetReferralCache(email: string): Promise<ApiResponse> {
  const normalizedEmail = normalizeEmail(email);
  try {
    await prisma.referralCache.upsert({
      where: { email: normalizedEmail },
      create: { email: normalizedEmail },
      update: {
        cachedReferralData: null,
        cachedAt: null,
        lastFetchedPage: 0,
        cacheComplete: false,
        lastKnownLeadCount: 0,
        lastKnownConversionCount: 0,
      },
    });
    return { success: true };
  } catch (error) {
    log.error('Reset referral cache error', { error });
    return { success: false, error: 'Failed to reset cache' };
  }
}

/**
 * Get referral data from cache. No API calls - just reads what's been cached.
 */
export async function getReferralData(
  email: string,
  _forceRefresh?: boolean
): Promise<ApiResponse & {
  totalLeads?: number;
  previousCount?: number;
  deltaSinceLastFetch?: number;
  leads?: ReferralRow[];
  complete?: boolean;
}> {
  const normalizedEmail = normalizeEmail(email);

  try {
    const cached = await prisma.referralCache.findUnique({ where: { email: normalizedEmail } });

    if (cached?.cachedReferralData) {
      try {
        const leads: ReferralRow[] = JSON.parse(cached.cachedReferralData);
        return {
          success: true,
          totalLeads: cached.lastKnownLeadCount + cached.lastKnownConversionCount,
          previousCount: cached.previousLeadCount,
          deltaSinceLastFetch: 0,
          leads,
          complete: cached.cacheComplete,
        };
      } catch { /* parse failed */ }
    }

    return { success: true, totalLeads: 0, previousCount: 0, deltaSinceLastFetch: 0, leads: [], complete: false };
  } catch (error) {
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
      complete: data.complete,
    };
  } catch (error) {
    log.error('Get referrals with mode error', { error });
    return { success: false, error: 'Failed to fetch referrals' };
  }
}

/**
 * Force-refresh: resets cache and returns empty. Frontend should then
 * call buildReferralCachePage repeatedly to rebuild.
 */
export async function getReferralsWithModeRefresh(
  params: ReferralsParams
): Promise<ReferralsResponse | { success: false; error: string }> {
  const { email, mode = 'leads' } = params;
  await resetReferralCache(email);
  return {
    success: true,
    rows: [],
    totalCount: 0,
    page: 1,
    pageSize: params.pageSize || 25,
    totalPages: 1,
    mode,
    leadsCount: 0,
    conversionsCount: 0,
    complete: false,
  };
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

  // Ensure cache exists — build if empty (mirrors student dashboard behavior)
  const cached = await prisma.referralCache.findUnique({ where: { email: normalizedStudent } });
  if (!cached?.cachedReferralData) {
    await buildReferralCachePage(normalizedStudent);
  }

  // Authorized - fetch referrals
  return getReferralsWithMode({
    email: normalizedStudent,
    mode,
    page,
    pageSize,
  });
}
