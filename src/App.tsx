import React, { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Navbar } from './components/layout/Navbar';
import { Footer } from './components/layout/Footer';
import { HomePage } from './views/HomePage';
import { DashboardPage } from './views/DashboardPage';
import { SdlcPage } from './views/SdlcPage';
import { ApiDemoPage } from './views/ApiDemoPage';
import { ComponentsGalleryPage } from './views/ComponentsGalleryPage';
import { SettingsPage } from './views/SettingsPage';
import KnowledgeBase from './components/KnowledgeBase';
import ChatStudio from './components/ChatStudio';
import RetrievalPlayground from './components/RetrievalPlayground';
import McpGateway from './components/McpGateway';
import SecurityCenter from './components/SecurityCenter';
import AnalyticsView from './components/AnalyticsView';
import MainApp from './components/MainApp';
import { Language } from './types';

export default function App() {
  const [lang, setLang] = useState<Language>('ar');
  const [tenantId] = useState<string>('tenant-acme-01');

  return (
    <BrowserRouter>
      <div className={`min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans ${lang === 'ar' ? 'dir-rtl' : 'dir-ltr'}`}>
        
        {/* Navigation Bar */}
        <Navbar lang={lang} setLang={setLang} />

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Routes>
            <Route path="/" element={<KnowledgeBase tenantId={tenantId} lang={lang} />} />
            <Route path="/knowledge" element={<KnowledgeBase tenantId={tenantId} lang={lang} />} />
            <Route path="/chat" element={<ChatStudio tenantId={tenantId} lang={lang} />} />
            <Route path="/search" element={<RetrievalPlayground tenantId={tenantId} lang={lang} />} />
            <Route path="/mcp" element={<McpGateway tenantId={tenantId} lang={lang} />} />
            <Route path="/security" element={<SecurityCenter tenantId={tenantId} lang={lang} />} />
            <Route path="/analytics" element={<AnalyticsView tenantId={tenantId} lang={lang} />} />
            <Route path="/platform" element={<MainApp />} />
            <Route path="/home" element={<HomePage lang={lang} />} />
            <Route path="/dashboard" element={<DashboardPage lang={lang} />} />
            <Route path="/sdlc" element={<SdlcPage lang={lang} />} />
            <Route path="/api-demo" element={<ApiDemoPage lang={lang} />} />
            <Route path="/components-gallery" element={<ComponentsGalleryPage lang={lang} />} />
            <Route path="/settings" element={<SettingsPage lang={lang} />} />
          </Routes>
        </main>

        {/* Footer */}
        <Footer lang={lang} />

      </div>
    </BrowserRouter>
  );
}
