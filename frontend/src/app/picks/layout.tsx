// app/picks/layout.tsx
import type { ReactNode } from "react";
import Sidebar from "@/components/Sidebar";

export const metadata = {
  title: "Picks",
  description: "My picks",
};

export default function PicksLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}