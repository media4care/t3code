import { useIsFocused } from "@react-navigation/native";
import type { EnvironmentId, QaRunDevice } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { useAppForeground } from "../../lib/appState";
import { uuidv4 } from "../../lib/uuid";
import { deviceEnvironment, useDeviceHubAccess } from "../../state/device";
import { useEnvironmentQuery } from "../../state/query";
import { DeviceStreamWebView, useDeviceStreamColors } from "../devices/DeviceStreamWebView";

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
  const colors = useDeviceStreamColors();
  const [viewer] = useState(uuidv4);
  const { access, error, refresh } = useDeviceHubAccess(environmentId, hostId, viewer);
  return (
    // No touches reach the device: a stray tap would change what the suite is testing.
    <View
      pointerEvents="none"
      accessibilityLabel={`${device.name} screen`}
      className="h-72 flex-1 overflow-hidden rounded-lg"
    >
      {access ? (
        <DeviceStreamWebView
          access={access}
          platform={device.platform}
          deviceId={device.deviceId}
          serveSimOnly={serveSimOnly}
          colors={colors}
          onUnauthorized={async () => refresh()}
          onInputConnected={async () => undefined}
        />
      ) : (
        <View
          className="flex-1 items-center justify-center px-3"
          style={{ backgroundColor: colors.background }}
        >
          {error ? (
            <Text className="text-center text-xs text-foreground-muted">{error}</Text>
          ) : (
            <AppActivityIndicator colorClassName="accent-icon" />
          )}
        </View>
      )}
    </View>
  );
}

/**
 * What the devices of a running suite show, for those a device host can stream. Streams run only
 * while the QA screen is in front and the app is in the foreground.
 */
export function QaDeviceStreams({
  environmentId,
  devices,
}: {
  environmentId: EnvironmentId;
  devices: ReadonlyArray<QaRunDevice>;
}) {
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const seen = focused && foreground;
  const state = useEnvironmentQuery(
    seen ? deviceEnvironment.state({ environmentId, input: {} }) : null,
  ).data;
  // Waits for the hosts, since a Simlock host's stream starts differently.
  if (!seen || state === null) return null;
  return (
    <View accessibilityLabel="Devices under test" className="flex-row gap-2">
      {devices.flatMap((device) =>
        device.hostId
          ? [
              <QaDeviceStream
                key={`${device.hostId}:${device.deviceId}`}
                environmentId={environmentId}
                device={device}
                hostId={device.hostId}
                serveSimOnly={
                  state.hosts.find((host) => host.id === device.hostId)?.kind === "simlock"
                }
              />,
            ]
          : [],
      )}
    </View>
  );
}
