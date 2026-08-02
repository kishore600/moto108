// context/BookingUIContext.tsx
//
// ---------------------------------------------------------------------------
// Small shared piece of state that lets the customer screen
// (app/(tabs)/customer.tsx) tell the Tabs layout (app/(tabs)/_layout.tsx)
// "the person has picked a location, a service, and a vehicle — show the
// Book Now bar instead of the normal Home / Bookings / Profile tabs".
//
// These two files are siblings under the same Tabs navigator, so a React
// Context provided just above <Tabs> (see the layout file) is visible to
// every screen inside it — no prop drilling, no global store needed.
// ---------------------------------------------------------------------------
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  ReactNode,
} from "react";

type BookingUIState = {
  // True once a location, a service, and a vehicle are all selected —
  // mirrors `canBookNow` in customer.tsx.
  canBookNow: boolean;
  // Price to show on the Book Now bar (already resolved from dynamic
  // pricing / base price by the customer screen).
  price: number | null;
  // True while a booking request is in flight — disables the button and
  // shows a spinner instead of the label.
  loading: boolean;
  // Fires the actual booking creation. Null whenever there's nothing to
  // book yet (kept in sync with `canBookNow`/`chosenService`).
  onBookNow: (() => void) | null;
};

type BookingUIContextValue = BookingUIState & {
  setBookingUI: (partial: Partial<BookingUIState>) => void;
};

const DEFAULT_STATE: BookingUIState = {
  canBookNow: false,
  price: null,
  loading: false,
  onBookNow: null,
};

const BookingUIContext = createContext<BookingUIContextValue>({
  ...DEFAULT_STATE,
  setBookingUI: () => {},
});

export function BookingUIProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BookingUIState>(DEFAULT_STATE);

  const setBookingUI = useCallback((partial: Partial<BookingUIState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  const value = useMemo(
    () => ({ ...state, setBookingUI }),
    [state, setBookingUI],
  );

  return (
    <BookingUIContext.Provider value={value}>
      {children}
    </BookingUIContext.Provider>
  );
}

export function useBookingUI() {
  return useContext(BookingUIContext);
}