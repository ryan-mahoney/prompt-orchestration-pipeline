type HotspotBeaconProps = {
  className?: string;
};

export function HotspotBeacon({ className = "" }: HotspotBeaconProps) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <span className="w-3 h-3 rounded-full bg-[#6d28d9] absolute -top-1 -right-1 z-[2]" />
      <span className="absolute -inset-1 rounded-full border-2 border-[#6d28d9] opacity-40 animate-[hotspot-pulse_2s_ease-in-out_infinite]" />
    </span>
  );
}
