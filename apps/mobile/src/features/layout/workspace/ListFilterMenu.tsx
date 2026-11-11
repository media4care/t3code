import type { ReactNode } from "react";
import { Platform, Pressable, ScrollView } from "react-native";
import { Chip } from "../../../components/ui/Chip";
import { Menu } from "../../../components/ui/Menu";
import type { MenuProps } from "../../../components/ui/Menu.types";
import { useAppearancePreferences } from "../../settings/appearance/AppearancePreferencesProvider";

// A 12dp inset keeps 16dp chips concentric with Android's 28dp ScreenContent corner.
export const LIST_FILTER_ROW_STYLE =
  Platform.OS === "android"
    ? { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, gap: 8 }
    : { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10, gap: 8 };

/**
 * A scrolling row of filter and action chips. A row at the top of padded content passes that
 * padding as `bleed`, so it scrolls edge to edge with the list's chip inset.
 */
export function ListFilterRow(props: { readonly children: ReactNode; readonly bleed?: number }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={{ flexGrow: 0, marginHorizontal: -(props.bleed ?? 0) }}
      contentContainerStyle={props.bleed === undefined ? { gap: 8 } : LIST_FILTER_ROW_STYLE}
    >
      {props.children}
    </ScrollView>
  );
}

export function ListFilterMenu(props: {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly active?: boolean;
  readonly icon?: boolean;
  readonly actions: MenuProps["actions"];
  readonly onSelect: (id: string) => void;
}) {
  const { themeAppearance } = useAppearancePreferences();
  return (
    <Menu
      title={props.accessibilityLabel}
      actions={props.actions}
      onPressAction={({ nativeEvent }) => props.onSelect(nativeEvent.event)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel}
        accessibilityState={{ selected: Boolean(props.active) }}
        hitSlop={6}
      >
        <Chip
          label={props.label}
          selected={props.active}
          icon={props.icon ? "line.3.horizontal.decrease" : undefined}
          trailingIcon={props.icon ? undefined : "chevron.down"}
          glass
          colorScheme={themeAppearance}
        />
      </Pressable>
    </Menu>
  );
}
