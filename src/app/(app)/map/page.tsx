import MapLoader from "./MapLoader";

export const metadata = { title: "Offline map · India Long-Ride Planner" };

export default function MapPage() {
  return (
    <main className="px-5 py-8">
      <h1 className="text-2xl font-bold">Map</h1>
      <p className="mt-1 text-sm text-muted">
        A free OpenStreetMap-based map of India. Save it to your device and it keeps working with no internet.
      </p>
      <div className="mt-5">
        <MapLoader />
      </div>
      <p className="mt-6 text-xs leading-relaxed text-muted">
        This map is for reference only. It does not give directions, and it does not show live road conditions,
        closures or fuel availability. Check your route and local conditions before you ride.
      </p>
    </main>
  );
}
