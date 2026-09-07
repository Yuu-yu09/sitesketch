import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/_core/hooks/useAuth";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import AuthPage from "./pages/AuthPage";
import Home from "./pages/Home";

function LoadingScreen() {
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-mark">✦</div>
        <div className="auth-loading">Loading your workspace...</div>
      </div>
    </main>
  );
}

function ProtectedWorkspace() {
  const { loading, user } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user) return <AuthPage />;

  return <Home />;
}

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={AuthPage} />
      <Route path={"/dashboard"} component={ProtectedWorkspace} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
