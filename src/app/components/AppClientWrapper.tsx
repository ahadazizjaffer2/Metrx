"use client";

import dynamic from "next/dynamic";

const AppClient = dynamic(() => import("./AppClient"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
    </div>
  ),
});

export default function AppClientWrapper() {
  return <AppClient />;
}
