import { useEffectEvent, useState } from "react";
import { Platform, Pressable, StyleSheet, View, type AccessibilityActionEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { cn } from "../../lib/cn";

const ACCESSIBILITY_RESIZE_STEP = 24;

interface WorkspacePaneDividerProps {
  readonly accessibilityLabel: string;
  /** "y" sits between stacked panes and resizes height; `currentWidth` is then the height. */
  readonly axis?: "x" | "y";
  readonly currentWidth: number;
  readonly resizeDirection: 1 | -1;
  readonly onResizeStart?: () => void;
  readonly onResizeBy: (delta: number) => void;
  readonly onResizeEnd?: () => void;
}

export function WorkspacePaneDivider(props: WorkspacePaneDividerProps) {
  const vertical = props.axis === "y";
  const [dragging, setDragging] = useState(false);
  const handleResizeStart = useEffectEvent(() => {
    setDragging(true);
    props.onResizeStart?.();
  });
  const handleResize = useEffectEvent((translation: number) => {
    props.onResizeBy(translation * props.resizeDirection);
  });
  const handleResizeEnd = useEffectEvent(() => {
    setDragging(false);
    props.onResizeEnd?.();
  });
  const [resizeGesture] = useState(() => {
    const pan = vertical
      ? Gesture.Pan().activeOffsetY([-4, 4]).failOffsetX([-24, 24])
      : Gesture.Pan().activeOffsetX([-4, 4]).failOffsetY([-24, 24]);
    return pan
      .onStart(() => {
        runOnJS(handleResizeStart)();
      })
      .onUpdate((event) => {
        runOnJS(handleResize)(vertical ? event.translationY : event.translationX);
      })
      .onFinalize(() => {
        runOnJS(handleResizeEnd)();
      });
  });

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    props.onResizeStart?.();
    if (event.nativeEvent.actionName === "increment") {
      props.onResizeBy(ACCESSIBILITY_RESIZE_STEP);
    } else if (event.nativeEvent.actionName === "decrement") {
      props.onResizeBy(-ACCESSIBILITY_RESIZE_STEP);
    }
    props.onResizeEnd?.();
  };

  return (
    <GestureDetector gesture={resizeGesture}>
      <Pressable
        className={cn(
          "relative z-[100] self-stretch justify-center",
          vertical ? "-my-[22px] h-[44px]" : "-mx-[22px] w-[44px]",
        )}
        accessibilityActions={[
          { name: "increment", label: vertical ? "Make pane taller" : "Make pane wider" },
          { name: "decrement", label: vertical ? "Make pane shorter" : "Make pane narrower" },
        ]}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityRole="adjustable"
        accessibilityValue={{
          now: Math.round(props.currentWidth),
          text: `${Math.round(props.currentWidth)} points ${vertical ? "tall" : "wide"}`,
        }}
        onAccessibilityAction={handleAccessibilityAction}
      >
        <View
          className={cn(
            "self-center bg-border opacity-70",
            dragging && "bg-primary opacity-100",
            Platform.OS === "android" && !dragging && "opacity-0",
          )}
          style={
            vertical
              ? [styles.horizontalLine, dragging && styles.activeHorizontalLine]
              : [styles.line, dragging && styles.activeLine]
          }
        />
      </Pressable>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  line: {
    alignSelf: "center",
    height: "100%",
    width: StyleSheet.hairlineWidth,
  },
  activeLine: {
    width: 2,
  },
  horizontalLine: {
    alignSelf: "stretch",
    height: StyleSheet.hairlineWidth,
  },
  activeHorizontalLine: {
    height: 2,
  },
});
