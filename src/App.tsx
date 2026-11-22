import { useEffect } from 'react';
import { takeSharedFile } from './lib/device';
import { Help, Home, PickWeek, SettingsScreen } from './screens/Home';
import { LocationForm, Locations, ToolsScreen } from './screens/Locations';
import { WeekFlow } from './screens/WeekFlow';
import { useStore } from './store';

export function App() {
  const { ready, screen, setSharedFile } = useStore();

  useEffect(() => {
    void takeSharedFile().then((file) => {
      if (file) setSharedFile(file);
    });
  }, [setSharedFile]);

  if (!ready) return <p className="p-6 text-lg text-gray-600">Laden…</p>;

  switch (screen.name) {
    case 'home':
      return <Home />;
    case 'pick-week':
      return <PickWeek />;
    case 'week':
      return <WeekFlow key={`${screen.weekId}-${screen.step}`} weekId={screen.weekId} step={screen.step} />;
    case 'locations':
      return <Locations />;
    case 'location':
      return <LocationForm id={screen.id} preset={screen.preset} />;
    case 'tools':
      return <ToolsScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'help':
      return <Help />;
  }
}
