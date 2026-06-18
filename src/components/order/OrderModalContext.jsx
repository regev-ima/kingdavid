import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import OrderDetailsModal from './OrderDetailsModal';

const OrderModalContext = createContext(null);

export function useOrderModal() {
  const ctx = useContext(OrderModalContext);
  if (!ctx) {
    // Rendered outside the provider (e.g. an isolated test). Degrade to
    // no-ops so callers never crash on a missing provider.
    return { openOrder: () => {}, closeOrder: () => {}, openOrderId: null, lastOpenedOrderId: null };
  }
  return ctx;
}

export function OrderModalProvider({ children }) {
  const location = useLocation();
  // openOrderId drives the overlay; lastOpenedOrderId persists AFTER close so
  // the originating list keeps the row highlighted ("you were here").
  const [openOrderId, setOpenOrderId] = useState(null);
  const [lastOpenedOrderId, setLastOpenedOrderId] = useState(null);

  const openOrder = useCallback((orderId) => {
    if (!orderId) return;
    setOpenOrderId(orderId);
    setLastOpenedOrderId(orderId);
  }, []);

  const closeOrder = useCallback(() => setOpenOrderId(null), []);

  // The overlay is rendered ABOVE the router, so a link fired from inside the
  // order (customer profile, shipment, return request) would otherwise leave
  // the popup floating over the new page. Dismiss it whenever the underlying
  // route actually changes. Opening an order never touches the URL, so this
  // never fires on open — the list underneath stays mounted with its scroll,
  // filters and pagination.
  useEffect(() => {
    setOpenOrderId(null);
  }, [location.pathname]);

  return (
    <OrderModalContext.Provider value={{ openOrder, closeOrder, openOrderId, lastOpenedOrderId }}>
      {children}
      {openOrderId && <OrderDetailsModal orderId={openOrderId} onClose={closeOrder} />}
    </OrderModalContext.Provider>
  );
}
