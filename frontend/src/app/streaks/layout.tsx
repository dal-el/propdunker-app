// app/streaks/layout.tsx

export const metadata = {
  title: "Streaks",
  description: "Player streak statistics",
};

export default function StreaksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}