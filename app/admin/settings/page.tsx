import { getRateLimitSettings } from '@/lib/rateLimitConfig';
import { getStrategySettings } from '@/lib/strategySettings';
import RateLimitsEditor from '@/components/admin/RateLimitsEditor';
import StrategySettingsEditor from '@/components/admin/StrategySettingsEditor';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const [settings, strategies] = await Promise.all([getRateLimitSettings(), getStrategySettings()]);
  return (
    <div className="max-w-4xl">
      <RateLimitsEditor initial={settings} />
      <StrategySettingsEditor initial={strategies} />
    </div>
  );
}
