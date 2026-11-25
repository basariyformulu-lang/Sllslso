import { NextResponse } from 'next/server';
import { getPublicSiteData } from '@/lib/public-data';

export async function GET() {
  const data = await getPublicSiteData();
  return NextResponse.json(data);
}
