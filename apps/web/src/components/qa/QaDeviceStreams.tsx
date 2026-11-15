import { useState, useSyncExternalStore } from "react";
import type { EnvironmentId, QaRunDevice } from "@t3tools/contracts";
import { useDeviceState } from "~/state/device";
import { DeviceStreamView } from "../device/DeviceStreamView";

const subscribeToPageVisibility = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};
const pageVisible = () => document.visibilityState === "visible";

/** True while the element is on screen in a visible page, so a stream runs only while seen. */
function useSeen() {
  const [onScreen, setOnScreen] = useState(false);
  const page = useSyncExternalStore(subscribeToPageVisibility, pageVisible);
  const ref = (element: HTMLElement | null) => {
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(!!entry?.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  };
  return [ref, page && onScreen] as const;
}

function QaDeviceStream({
  environmentId,
  device,
  hostId,
  serveSimOnly,
}: {
  environmentId: EnvironmentId;
  device: QaRunDevice;
  hostId: string;
  serveSimOnly: boolean;
}) {
  const [ref, seen] = useSeen();
  return (
    // Inert: a stray tap or key would change what the suite is testing.
    <div ref={ref} inert className="h-80 overflow-hidden rounded-lg">
      <DeviceStreamView
        environmentId={environmentId}
        platform={device.platform}
        deviceId={device.deviceId}
        hostId={hostId}
        deviceName={device.name}
        deviceDescription={device.version}
        visible={seen}
        serveSimOnly={serveSimOnly}
      />
    </div>
  );
}

/** What the devices of a running suite show, for those a device host can stream. */
export default function QaDeviceStreams({
  environmentId,
  devices,
}: {
  environmentId: EnvironmentId;
  devices: ReadonlyArray<QaRunDevice>;
}) {
  const { state } = useDeviceState(environmentId);
  const watchable = devices.flatMap((device) =>
    device.hostId ? [{ device, hostId: device.hostId }] : [],
  );
  return (
    <div
      aria-label="Devices under test"
      className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2"
    >
      {watchable.map(({ device, hostId }) => (
        <QaDeviceStream
          key={`${hostId}:${device.deviceId}`}
          environmentId={environmentId}
          device={device}
          hostId={hostId}
          serveSimOnly={state.hosts.find((host) => host.id === hostId)?.kind === "simlock"}
        />
      ))}
    </div>
  );
}
