export * from './types/index';

export type RenderMode = 'server' | 'client';

export interface RouteInfo {
  path: string;
  title: string;
  description: string;
  mode: RenderMode;
  iconName: string;
  badge?: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  description?: string;
  codeSnippet?: string;
  isClientComponent?: boolean;
}

export interface ApiTestResult {
  endpoint: string;
  method: string;
  status: number;
  timeMs: number;
  response: Record<string, unknown>;
  timestamp: string;
}

export interface FrameworkFeature {
  title: string;
  description: string;
  category: 'Core' | 'Routing' | 'Styling' | 'Performance';
  version: string;
  icon: string;
  codeExample: string;
}

