import { MonitorIcon, SmartphoneIcon, TabletIcon, TvIcon, WatchIcon } from "lucide-react";
import type { DeviceFormFactor } from "@t3tools/contracts";

export const DEVICE_FORM_FACTOR_ICONS: Record<DeviceFormFactor, typeof SmartphoneIcon> = {
  phone: SmartphoneIcon,
  tablet: TabletIcon,
  tv: TvIcon,
  watch: WatchIcon,
  other: MonitorIcon,
};
