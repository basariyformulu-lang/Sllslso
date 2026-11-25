import React from 'react';
import { PanelShell } from '@/components/PanelShell';

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <PanelShell>{children}</PanelShell>;
}
