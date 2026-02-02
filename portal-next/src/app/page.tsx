import { redirect } from 'next/navigation';

/**
 * Root page - redirects to login
 *
 * In the legacy system, doGet(e) routed based on ?page= parameter.
 * In Next.js, we use file-based routing with redirects in next.config.js
 * to handle legacy URLs.
 */
export default function Home() {
  // Redirect to login page
  redirect('/login');
}
