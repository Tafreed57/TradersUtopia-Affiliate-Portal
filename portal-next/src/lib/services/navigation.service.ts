/**
 * Navigation Service
 *
 * Simple utility functions for navigation and URLs.
 */

import { config } from '@/lib/config';

/**
 * Get the web app URL
 * Legacy: getWebAppUrl()
 */
export function getWebAppUrl(): string {
  return config.app.url;
}
