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

  return {
    id: ref.id.toString().slice(-6),
    state: conv ? 'conversion' : 'lead',
    createdAt: ref.created_at || '',
    becameLeadAt: ref.became_lead_at || ref.created_at || '',
    becameConversionAt: ref.became_conversion_at || ref.sale_occurred_at || null,
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

  try {
    // Check cache
    const cached = await prisma.referralCache.findUnique({
      where: { email: normalizedEmail },
    });

    const cacheAge = cached?.lastSuccessfulFetchAt
      ? Date.now() - cached.lastSuccessfulFetchAt.getTime()
      : Infinity;

    const cacheTtl = 15 * 60 * 1000; // 15 minutes

    // Use cache if valid and not forcing refresh
    if (!forceRefresh && cached && cacheAge < cacheTtl) {
      return {
        success: true,
        totalLeads: cached.lastKnownLeadCount,
        previousCount: cached.previousLeadCount,
        deltaSinceLastFetch: 0,
        fromCache: true,
        leads: [],
      };
    }

    // Fetch from API
    // First get affiliate
    const user = await prisma.user.findUnique({
      where: { aliasEmail: normalizedEmail },
    });

    const emailForApi = user?.internalEmail || normalizedEmail;

    const affiliateResult = await rewardfulApi.getAffiliateByEmail(emailForApi);
    if (!affiliateResult.success || !affiliateResult.affiliate) {
      return {
        success: true,
        totalLeads: 0,
        previousCount: 0,
        deltaSinceLastFetch: 0,
        leads: [],
      };
    }

    // Fetch all referrals
    const referrals = await rewardfulApi.getAllReferrals(affiliateResult.affiliate.id);

    // Filter out visitors
    const validReferrals = referrals.filter((r) => !isVisitor(r as RawReferral));

    // Count leads and conversions
    const leadsCount = validReferrals.filter((r) => isLead(r as RawReferral)).length;
    const conversionsCount = validReferrals.filter((r) =>
      isConversion(r as RawReferral)
    ).length;

    const totalCount = leadsCount + conversionsCount;
    const previousCount = cached?.lastKnownLeadCount || 0;
    const delta = totalCount - previousCount;

    // Update cache
    await prisma.referralCache.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        affiliateId: affiliateResult.affiliate.id,
        lastKnownLeadCount: totalCount,
        previousLeadCount: previousCount,
        lastSuccessfulFetchAt: new Date(),
        lastFetchedAt: new Date(),
      },
      update: {
        lastKnownLeadCount: totalCount,
        previousLeadCount: previousCount,
        lastSuccessfulFetchAt: new Date(),
        lastFetchedAt: new Date(),
      },
    });

    // Prepare leads for display
    const leads = validReferrals.map((r) => prepareReferralRow(r as RawReferral));

    return {
      success: true,
      totalLeads: totalCount,
      previousCount,
      deltaSinceLastFetch: delta,
      fromCache: false,
      leads,
    };
  } catch (error) {
    log.error('Get referral data error', { error, email: normalizedEmail });
    return { success: false, error: 'Failed to fetch referral data' };
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
    // Get all referral data
    const data = await getReferralData(normalizedEmail, false);

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
