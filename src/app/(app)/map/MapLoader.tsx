"use client";

import dynamic from "next/dynamic";

// MapLibre needs the browser (WebGL), so it is never rendered on the server.
const OfflineMap = dynamic(() => import("@/components/OfflineMap"), {
  ssr: false,
  loading: () => <div className="h-[60vh] min-h-[320px] animate-pulse rounded-xl bg-sunken" />,
});

export default function MapLoader() {
  return <OfflineMap />;
}
