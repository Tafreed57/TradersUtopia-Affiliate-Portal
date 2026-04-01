/**
 * Rewardful Webhook Endpoint
 *
 * Receives webhook events from Rewardful (configured in Rewardful dashboard).
 * Primary event: payout.paid — when Charose clicks "Mark Paid" on an affiliate.
 *
 * Flow:
 * 1. Verify webhook signature (if secret is configured)
 * 2. Log the event to RewardfulWebhookLog
 * 3. For payout.paid: match affiliate → find teachers → create ledger entries
 */

import { NextRequest, NextResponse } from 'next/server';
import { processPayoutWebhook } from '@/lib/services/teacher.service';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify Rewardful webhook signature using HMAC-SHA256.
 * Rewardful uses Standard Webhooks (Svix) format.
 */
function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return !secret; // Skip if no secret configured

  try {
    // Standard Webhooks signature format: v1,<base64-signature>
    // May also just be a plain HMAC signature
    const parts = signature.split(',');
    const sigValue = parts.length > 1 ? parts[1] : parts[0];

    const expected = createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    const sigBuffer = Buffer.from(sigValue, 'base64');
    const expectedBuffer = Buffer.from(expected, 'base64');

    if (sigBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  let rawBody: string;
  let payload: Record<string, unknown>;

  try {
    rawBody = await request.text();
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Verify webhook signature if secret is configured
  const webhookSecret = config.rewardful.webhookSecret;
  if (webhookSecret) {
    const signature = request.headers.get('webhook-signature')
      || request.headers.get('x-rewardful-signature');

    if (!verifySignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  const eventType = (payload.event as string) || 'unknown';
  const data = payload.data as Record<string, unknown> | undefined;
  const payoutId = data?.id as string | undefined;
  const affiliate = data?.affiliate as Record<string, unknown> | undefined;
  const affiliateEmail = affiliate?.email as string | undefined;

  // Log the webhook event
  let logId: string | undefined;
  try {
    const log = await prisma.rewardfulWebhookLog.create({
      data: {
        eventType,
        rewardfulPayoutId: payoutId,
        affiliateEmail,
        payload: rawBody,
        status: 'pending',
      },
    });
    logId = log.id;
  } catch (e) {
    console.error('[Webhook] Failed to create log entry:', e);
  }

  // Only process payout.paid events
  if (eventType !== 'payout.paid') {
    if (logId) {
      await prisma.rewardfulWebhookLog.update({
        where: { id: logId },
        data: { status: 'skipped', processedAt: new Date() },
      }).catch(() => {});
    }
    return NextResponse.json({ received: true, status: 'skipped' });
  }

  // Process the payout
  try {
    const result = await processPayoutWebhook({
      payoutId: payoutId!,
      affiliateEmail: affiliateEmail!,
      affiliateId: affiliate?.id as string | undefined,
      amountCents: data?.amount as number,
      currency: (data?.currency as string) || 'CAD',
      paidAt: data?.paid_at as string,
    });

    if (logId) {
      await prisma.rewardfulWebhookLog.update({
        where: { id: logId },
        data: {
          status: result.processed ? 'processed' : 'skipped',
          errorMessage: result.message,
          processedAt: new Date(),
        },
      }).catch(() => {});
    }

    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Webhook] Processing error:', errMsg);

    if (logId) {
      await prisma.rewardfulWebhookLog.update({
        where: { id: logId },
        data: { status: 'error', errorMessage: errMsg, processedAt: new Date() },
      }).catch(() => {});
    }

    return NextResponse.json({ received: true, error: errMsg }, { status: 200 });
  }
}
