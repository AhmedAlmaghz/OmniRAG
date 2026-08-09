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
