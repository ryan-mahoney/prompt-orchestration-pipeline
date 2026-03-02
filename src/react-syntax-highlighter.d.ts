declare module "react-syntax-highlighter" {
  import type { ComponentType, ReactNode } from "react";

  export const Prism: ComponentType<{
    language?: string;
    style?: unknown;
    customStyle?: Record<string, unknown>;
    children?: ReactNode;
  }>;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  export const oneLight: unknown;
}
