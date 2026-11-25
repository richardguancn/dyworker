import "react";

/** Authored Data content uses theme variables on ordinary HTML/SVG elements. */
declare module "react" {
  interface CSSProperties {
    [customProperty: `--${string}`]: string | number | undefined;
  }
}
