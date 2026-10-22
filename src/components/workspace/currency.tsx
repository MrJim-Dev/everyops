"use client";

import { createContext, type ReactNode, useContext } from "react";
import { type CurrencyCode, currencyOf } from "@/lib/format";

const CurrencyContext = createContext<CurrencyCode>("PHP");

/**
 * The currency money reads in below it: the workspace's own, or a public site's. Components read it with
 * useCurrency() and pass it to formatMoney, so two workspaces rendered at once never share one.
 */
export function CurrencyProvider({
  currency,
  children,
}: {
  currency: string | undefined;
  children: ReactNode;
}) {
  return <CurrencyContext.Provider value={currencyOf({ currency })}>{children}</CurrencyContext.Provider>;
}

export const useCurrency = () => useContext(CurrencyContext);
