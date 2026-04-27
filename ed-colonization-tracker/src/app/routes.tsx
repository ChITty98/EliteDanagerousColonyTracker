import { createBrowserRouter } from 'react-router-dom';
import { Layout } from './Layout';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ProjectListPage } from '@/features/projects/ProjectListPage';
import { ProjectDetailPage } from '@/features/projects/ProjectDetailPage';
import { ProjectCreatePage } from '@/features/projects/ProjectCreatePage';
import { SystemDetailPage } from '@/features/systems/SystemDetailPage';
import { SourcesPage } from '@/features/sources/SourcesPage';
import { SessionsPage } from '@/features/sessions/SessionsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { FaqPage } from '@/features/faq/FaqPage';
import { WikiPage } from '@/features/wiki/WikiPage';
import { FleetCarrierPage } from '@/features/carrier/FleetCarrierPage';
import { ScoutingPage } from '@/features/scouting/ScoutingPage';
import { ChainPlannerPage } from '@/features/planner/ChainPlannerPage';
import { JournalStatsPage } from '@/features/journal-stats/JournalStatsPage';
import { CompanionPage } from '@/features/companion/CompanionPage';
import { ArchitectDomainPage } from '@/features/domain/ArchitectDomainPage';
import { ColonyMapPage } from '@/features/map/ColonyMapPage';
import { SystemViewPage } from '@/features/system-view/SystemViewPage';
import { WarPeacePage } from '@/features/war-peace/WarPeacePage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'projects', element: <ProjectListPage /> },
      { path: 'projects/new', element: <ProjectCreatePage /> },
      { path: 'projects/:id', element: <ProjectDetailPage /> },
      { path: 'systems/:systemName', element: <SystemDetailPage /> },
      { path: 'fleet-carrier', element: <FleetCarrierPage /> },
      { path: 'scouting', element: <ScoutingPage /> },
      { path: 'planner', element: <ChainPlannerPage /> },
      { path: 'sources', element: <SourcesPage /> },
      { path: 'sessions', element: <SessionsPage /> },
      { path: 'domain', element: <ArchitectDomainPage /> },
      { path: 'map', element: <ColonyMapPage /> },
      { path: 'system-view', element: <SystemViewPage /> },
      { path: 'companion', element: <CompanionPage /> },
      { path: 'war-peace', element: <WarPeacePage /> },
      { path: 'journal-stats', element: <JournalStatsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'wiki', element: <WikiPage /> },
      { path: 'faq', element: <FaqPage /> },
    ],
  },
]);
