import { useState } from "react";
import Sidebar from "./Sidebar";

export default function MainLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="app-shell">
      <div className="app-body">
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((prev) => !prev)}
        />

        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}