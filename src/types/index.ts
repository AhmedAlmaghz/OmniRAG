export type Language = 'ar' | 'en';

export interface FeatureInfo {
  id: string;
  title: string;
  description: string;
  tag: string;
  iconName: string;
}

export interface ApiHealthResponse {
  status: string;
  framework: string;
  version: string;
  environment: string;
  timestamp: string;
}

export interface NextFeature {
  id: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  category: string;
  status: string;
  tags: string[];
  codeSnippet: string;
}

export interface SDLCChecklistItem {
  id: string;
  labelAr: string;
  labelEn: string;
  completed: boolean;
  importance: 'Critical' | 'High' | 'Medium' | 'Low';
}

export interface SDLCPhase {
  id: string;
  stepNumber: number;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  iconName: string;
  checklist: SDLCChecklistItem[];
  bestPracticesAr: string[];
  bestPracticesEn: string[];
}

export interface MetricCardData {
  id: string;
  titleAr: string;
  titleEn: string;
  value: string;
  change: string;
  trend: 'up' | 'down' | 'neutral';
  category: 'Build' | 'Performance' | 'Security' | 'Quality';
}

export interface ApiEndpointSpec {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  descriptionAr: string;
  descriptionEn: string;
  requestBodyExample?: string;
  responseExample: string;
}

export interface CodeAnalysisResult {
  score: number;
  securityRating: string;
  summaryAr: string;
  summaryEn?: string;
  recommendations: Array<{
    type: string;
    messageAr: string;
    messageEn?: string;
  }>;
}

