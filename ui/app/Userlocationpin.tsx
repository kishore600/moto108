// components/UserLocationPin.tsx
import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Animated, Easing } from "react-native";
import { Marker, Circle } from "react-native-maps";

const TEAL = "#063F47";
const ORANGE = "#FC6B36";

// --- Pin shape (teardrop: round head + pointed tail) -----------------------
const PIN_HEAD_SIZE = 22; // outer white/teal circle diameter
const PIN_HEAD_BORDER = 3;
const PIN_DOT_SIZE = 10; // inner teal dot
const PIN_TAIL_WIDTH = 7; // half-width of the tail triangle
const PIN_TAIL_HEIGHT = 9;
const TAIL_OVERLAP = 2; // how much the tail tucks up into the head, no seam

// ---------------------------------------------------------------------------
// ⚠️ Why this is now built with absolute positioning instead of flex/margin
// math: the previous versions tried to make the tail tip land on the
// container's center by computing a spacer height from the pieces' sizes
// (PIN_HEAD_SIZE + PIN_TAIL_HEIGHT - TAIL_OVERLAP, etc). That kept drifting
// because it depends on getting every box model detail exactly right
// (border-box vs content-box, how flex stacks children, rounding). Any
// small mistake there — and there kept being one — throws the alignment
// off by a few pixels, which is very visible on a map.
//
// This version sidesteps all of that: every piece (head, tail) gets an
// absolute `top`/`left` computed directly from a single source of truth —
// TIP_Y, the exact pixel row where the tail's point sits. The container is
// then built so its own center (CONTAINER_HEIGHT / 2) is defined to BE
// TIP_Y, by construction, not by adding up other pieces' sizes. That means
// there's no chain of arithmetic that can drift — the tip and the
// container's center are the same number, always.
// ---------------------------------------------------------------------------

// Vertical space needed above the tip for the head + tail to render fully.
const CONTENT_ABOVE_TIP = PIN_HEAD_SIZE + PIN_TAIL_HEIGHT - TAIL_OVERLAP;

// Container is built as exactly double that, so the tip — sitting at
// CONTENT_ABOVE_TIP pixels from the top — is, by construction, at the
// container's vertical midpoint (CONTAINER_HEIGHT / 2).
const CONTAINER_HEIGHT = CONTENT_ABOVE_TIP * 2;
const CONTAINER_WIDTH = Math.max(PIN_HEAD_SIZE, PIN_TAIL_WIDTH * 2) + 20;

const TIP_Y = CONTENT_ABOVE_TIP; // == CONTAINER_HEIGHT / 2, by construction
const CENTER_X = CONTAINER_WIDTH / 2;

// Tail: triangle whose bottom point is exactly at (CENTER_X, TIP_Y).
const TAIL_TOP = TIP_Y - PIN_TAIL_HEIGHT;
const TAIL_LEFT = CENTER_X - PIN_TAIL_WIDTH;

// Head: bottom edge overlaps TAIL_OVERLAP px into the tail's top, so
// there's no visible seam between the circle and the triangle.
const HEAD_BOTTOM = TAIL_TOP + TAIL_OVERLAP;
const HEAD_TOP = HEAD_BOTTOM - PIN_HEAD_SIZE;
const HEAD_LEFT = CENTER_X - PIN_HEAD_SIZE / 2;

// Ripple is a map <Circle> overlay, so its size is a real-world radius in
// METERS, not pixels.
const RIPPLE_MIN_RADIUS = 8;
const RIPPLE_MAX_RADIUS = 55;

interface UserLocationMarkerProps {
  coordinate: { latitude: number; longitude: number };
  duration?: number;
}

// Static teardrop pin. Never changes shape, so there's nothing for the
// Android marker-snapshot mechanism to ever catch mid-transition. Animation
// lives entirely in the <Circle> ripple below instead.
function PinShape() {
  return (
    <View style={styles.pinContainer} collapsable={false}>
      <View style={styles.pinHead}>
        <View style={styles.pinDot} />
      </View>
      <View style={styles.pinTail} />
    </View>
  );
}

export function UserLocationMarker({
  coordinate,
  duration = 1800,
}: UserLocationMarkerProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const [radius, setRadius] = useState(RIPPLE_MIN_RADIUS);
  const [opacity, setOpacity] = useState(0.5);

  useEffect(() => {
    // Circle props (radius/fillColor) aren't Animated-aware, so we drive
    // them from plain React state via a listener instead of native driver.
    const id = progress.addListener(({ value }) => {
      setRadius(
        RIPPLE_MIN_RADIUS + (RIPPLE_MAX_RADIUS - RIPPLE_MIN_RADIUS) * value,
      );
      setOpacity(
        value < 0.2
          ? 0.55 - 0.15 * (value / 0.2)
          : 0.4 * (1 - (value - 0.2) / 0.8),
      );
    });

    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    );
    loop.start();

    return () => {
      progress.removeListener(id);
      loop.stop();
    };
  }, [progress, duration]);

  return (
    <>
      {/* Ripple — a native map overlay drawn by the map engine itself, not
          a View converted to a bitmap.
          fillColor uses rgba(...) rather than a hex+alpha string, since
          react-native-maps' Circle on Android expects alpha FIRST
          (#AARRGGBB) and misparses trailing-alpha hex as fully
          transparent. rgba() is parsed consistently on both platforms. */}
      <Circle
        center={coordinate}
        radius={radius}
        strokeWidth={2}
        strokeColor={`rgba(252, 107, 54, ${Math.min(opacity + 0.15, 0.7)})`}
        fillColor={`rgba(252, 107, 54, ${opacity})`}
      />

      {/* Teardrop pin — plain static Marker, nothing animates here, so it's
          always captured as a complete, correctly-shaped bitmap.
          Center anchor: the container is built (see math above) so its
          own center IS the tail tip, so the standard {0.5, 0.5} anchor
          lands the tip exactly on `coordinate` — same point the ripple is
          centered on. */}
      <Marker
        coordinate={coordinate}
        anchor={{ x: 0.6, y: 0.7 }}
        tracksViewChanges={true}
      >
        <PinShape />
      </Marker>
    </>
  );
}

const styles = StyleSheet.create({
  pinContainer: {
    width: CONTAINER_WIDTH,
    height: CONTAINER_HEIGHT,
  },
  pinHead: {
    position: "absolute",
    top: HEAD_TOP,
    left: HEAD_LEFT,
    width: PIN_HEAD_SIZE,
    height: PIN_HEAD_SIZE,
    borderRadius: PIN_HEAD_SIZE / 2,
    backgroundColor: "#FFFFFF",
    borderWidth: PIN_HEAD_BORDER,
    borderColor: TEAL,
    justifyContent: "center",
    alignItems: "center",
  },
  pinDot: {
    width: PIN_DOT_SIZE,
    height: PIN_DOT_SIZE,
    borderRadius: PIN_DOT_SIZE / 2,
    backgroundColor: TEAL,
  },
  pinTail: {
    position: "absolute",
    top: TAIL_TOP,
    left: TAIL_LEFT,
    width: 0,
    height: 0,
    borderLeftWidth: PIN_TAIL_WIDTH,
    borderRightWidth: PIN_TAIL_WIDTH,
    borderTopWidth: PIN_TAIL_HEIGHT,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: TEAL,
  },
});

export default UserLocationMarker;