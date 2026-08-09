'use client';

import React from 'react';
import { SourcesDashboard } from './sources/SourcesDashboard';

interface KnowledgeBaseProps {
  tenantId: string;
  lang: 'ar' | 'en';
}

export default function KnowledgeBase({ tenantId, lang }: KnowledgeBaseProps) {
  return <SourcesDashboard tenantId={tenantId} lang={lang} />;
}
