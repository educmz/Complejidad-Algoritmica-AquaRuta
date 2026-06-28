import AppHeader from "./AppHeader";

export default function MainLayout({ children }) {
  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-body">
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
