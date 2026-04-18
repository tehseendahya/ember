"use client";

import { createContext, useContext } from "react";

/**
 * Command bar context: any client component can call `openCapture()` to open
 * the global quick-capture sheet and pre-fill it with a contact. Implementation
 * (cmdk command palette + capture form) lives in `CommandBar.tsx`, which wraps
 * its children with this provider.
 */
export type OpenCaptureOptions = {
  contactId?: string;
  prefillText?: string;
};

type CommandBarContextValue = {
  openCommand: () => void;
  openCapture: (options?: OpenCaptureOptions) => void;
};

const noop: CommandBarContextValue = {
  openCommand: () => {},
  openCapture: () => {},
};

export const CommandBarContext = createContext<CommandBarContextValue>(noop);

export function useCommandBar(): CommandBarContextValue {
  return useContext(CommandBarContext);
}
