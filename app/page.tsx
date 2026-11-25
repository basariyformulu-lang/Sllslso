import React from 'react';
import { getPublicSiteData } from '@/lib/public-data';
import { LandingClient } from '@/components/LandingClient';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { settings, plan } = await getPublicSiteData();
  return <LandingClient settings={settings} plan={plan} />;
}
