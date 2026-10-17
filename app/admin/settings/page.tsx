import { getRateLimitSettings } from '@/lib/rateLimitConfig';
import RateLimitsEditor from '@/components/admin/RateLimitsEditor';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const settings = await getRateLimitSettings();
  return (
    <div className="max-w-4xl">
      <RateLimitsEditor initial={settings} />
    </div>
  );
}
